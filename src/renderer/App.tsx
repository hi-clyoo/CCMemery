import { useEffect, useState, useCallback, useRef } from 'react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { getTrafficLightPaddingForZoom } from '@shared/constants'
import type { MemoryIndex } from '@shared/types/api'
import type { Project, Session } from '@shared/types'
import { isElectronMode } from './api'
import { CustomTitleBar } from './components/layout/CustomTitleBar'
import { useZoomFactor } from './hooks/useZoomFactor'

// ============================================================
// Types & Constants
// ============================================================
interface MemFile { path: string; type: string; tokens: number; content?: string }

interface FileGroup {
  type: string
  label: string
  icon: string
  color: string
  desc: string
  path: string
  priority: string
  files: MemFile[]
  expanded: boolean
}

const GLOBAL_GROUP_DEFS = [
  {
    type: 'Managed', label: 'Managed', icon: '🛡️', color: '#A855F7',
    desc: 'System-level mandatory rules from Claude Code installation. Automatically loaded for every session — always in effect.',
    path: '<install>/CLAUDE.md  (e.g., C:\\Program Files\\ClaudeCode\\CLAUDE.md)',
    priority: 'Always loaded — applies to all projects',
  },
  {
    type: 'User', label: 'User', icon: '👤', color: '#3B82F6',
    desc: 'Your personal global instructions (via /config). Loaded for ALL projects. Merged with project-specific rules below.',
    path: '~/.claude/CLAUDE.md',
    priority: 'Always loaded — applies globally',
  },
]

const PROJECT_GROUP_DEFS = [
  {
    type: 'Project', label: 'Project', icon: '📄', color: '#F97316',
    desc: 'Project-level instructions, checked into git — shared with your team. Also loaded from .claude/ subdirectories.',
    path: './CLAUDE.md  /  .claude/CLAUDE.md',
    priority: 'Loaded per-project — adds to User rules',
  },
  {
    type: 'Local', label: 'Local', icon: '🔒', color: '#22C55E',
    desc: 'Local-only additions, NEVER checked into git. Use for personal project tweaks. Takes precedence on conflicts.',
    path: './CLAUDE.local.md',
    priority: 'Loaded per-project — takes precedence on conflicts',
  },
  {
    type: 'AutoMem', label: 'Memory', icon: '🧠', color: '#EC4899',
    desc: 'Auto-generated memory from conversations. Managed by Claude via MEMORY.md index. Project-scoped.',
    path: '~/.claude/projects/<proj>/memory/',
    priority: 'Loaded alongside rules (separate channel)',
  },
]

const GROUP_DEFS = [...GLOBAL_GROUP_DEFS, ...PROJECT_GROUP_DEFS]

function formatTokens(tokens: number): string {
  if (!tokens) return ''
  if (tokens < 1000) return `${tokens} tok`
  return `${(tokens / 1000).toFixed(1)}K tok`
}

function shortenPath(p: string): string {
  const m = p.match(/^([A-Za-z]:\\[Uu]sers\\[^\\]+)/)
  return m ? '~' + p.slice(m[0].length) : p
}

/**
 * Build a display-friendly project title.
 * Worktrees (paths containing .claude/worktrees/) show as "repo [worktree: name]".
 */
function projectTitle(proj: Project): string {
  const p = (proj.path || proj.name).replace(/\\/g, '/')
  const wtMatch = p.match(/\.claude\/worktrees\/(.+)$/)
  if (wtMatch) {
    const repoPath = p.slice(0, p.indexOf('/.claude/worktrees/'))
    const repoName = repoPath.split('/').pop() || repoPath
    const wtName = wtMatch[1].replace(/-[a-f0-9]{6,}$/, '')
    return `${repoName} [wt: ${wtName}]`
  }
  // Use proj.path (resolved correctly) rather than proj.name (may be broken by lossy decode)
  return p.split('/').pop() || proj.name
}

// ============================================================
// App
// ============================================================
export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedProjectPath, setSelectedProjectPath] = useState('')
  const [groups, setGroups] = useState<FileGroup[]>([])
  const [selectedFile, setSelectedFile] = useState<MemFile | null>(null)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [jsonlContent, setJsonlContent] = useState('')
  const [loadingJsonl, setLoadingJsonl] = useState(false)
  const [editingContent, setEditingContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [diskUpdated, setDiskUpdated] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const originalContentRef = useRef('')
  const [showAbout, setShowAbout] = useState(false)
  const [rulesExpanded, setRulesExpanded] = useState(true)
  const [globalSelected, setGlobalSelected] = useState(false)
  const [globalGroups, setGlobalGroups] = useState<FileGroup[]>([])
  const [col1Width, setCol1Width] = useState(240)
  const [col2Width, setCol2Width] = useState(300)
  const col1Ref = useRef(240)
  const col2Ref = useRef(300)
  const draggingRef = useRef<'col1' | 'col2' | null>(null)
  const columnsRef = useRef<HTMLDivElement>(null)

  // macOS hidden title bar: reserve space for the native traffic lights.
  // Windows/Linux use CustomTitleBar instead, so no left padding needed there.
  const zoomFactor = useZoomFactor()
  const isMac = /Mac/i.test(navigator.userAgent)
  const trafficLightPadding = isElectronMode() && isMac ? getTrafficLightPaddingForZoom(zoomFactor) : 0

  // Dismiss splash
  useEffect(() => {
    const splash = document.getElementById('splash')
    if (splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 300) }
  }, [])

  useEffect(() => {
    window.electronAPI.getProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  // Load global CLAUDE.md files (Managed + User) once on mount
  useEffect(() => {
    void (async () => {
      const fileMap = new Map<string, MemFile[]>()
      for (const g of GLOBAL_GROUP_DEFS) fileMap.set(g.type, [])
      const homeDir = await window.electronAPI.getHomeDir().catch(() => '')
      try {
        const managedPath = await window.electronAPI.getManagedClaudePath()
        if (managedPath) {
          const r = await window.electronAPI.readFileByPath(managedPath)
          if (r.success && r.content) fileMap.get('Managed')!.push({ path: managedPath, type: 'Managed', tokens: Math.ceil(r.content.length / 4), content: r.content })
        }
      } catch { /* */ }
      if (homeDir) {
        try {
          const p = homeDir.replace(/\\/g, '/') + '/.claude/CLAUDE.md'
          const r = await window.electronAPI.readFileByPath(p)
          if (r.success && r.content) fileMap.get('User')!.push({ path: p, type: 'User', tokens: Math.ceil(r.content.length / 4), content: r.content })
        } catch { /* */ }
      }
      setGlobalGroups(GLOBAL_GROUP_DEFS.map(g => ({ ...g, files: fileMap.get(g.type) || [], expanded: (fileMap.get(g.type) || []).length > 0 })))
    })()
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.memory.onChanged(({ projectId }) => {
      if (projectId === selectedProjectId) loadAllFiles(selectedProjectId, selectedProjectPath)
    })
    return unsub
  }, [selectedProjectId, selectedProjectPath])

  // Detect disk changes when window regains focus
  useEffect(() => {
    const onFocus = async () => {
      if (!selectedFile) return
      try {
        let r: { success: boolean; content?: string; error?: string } = { success: false }
        if (selectedFile.type === 'AutoMem') {
          r = await window.electronAPI.memory.readFile(selectedProjectId!, selectedFile.path.split(/[\\/]/).pop()!)
        } else {
          r = await window.electronAPI.readFileByPath(selectedFile.path)
        }
        if (r.success && r.content !== undefined && r.content !== editingContent) {
          setDiskUpdated(true)
        }
      } catch { /* */ }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [selectedFile, editingContent, selectedProjectId])

  // Column resize handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !columnsRef.current) return
      const rect = columnsRef.current.getBoundingClientRect()
      if (draggingRef.current === 'col1') {
        const w = Math.max(160, Math.min(rect.width - 340, e.clientX - rect.left))
        col1Ref.current = w; setCol1Width(w)
      } else {
        const dx = e.clientX - rect.left - col1Ref.current
        const w = Math.max(160, Math.min(rect.width - col1Ref.current - 160, dx))
        col2Ref.current = w; setCol2Width(w)
      }
    }
    const onUp = () => {
      draggingRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const loadSessions = useCallback(async (projectId: string) => {
    try { const s = await window.electronAPI.getSessions(projectId); setSessions(s || []) }
    catch { setSessions([]) }
  }, [])

  const loadAllFiles = useCallback(async (projectId: string, projectPath: string) => {
    setLoadingFiles(true)

    const fileMap = new Map<string, MemFile[]>()
    for (const g of PROJECT_GROUP_DEFS) fileMap.set(g.type, [])

    // 1. Project CLAUDE.md files
    const np = projectPath.replace(/\\/g, '/')
    const candidates: Array<{ path: string; type: string }> = [
      { path: np + '/CLAUDE.md', type: 'Project' },
      { path: np + '/.claude/CLAUDE.md', type: 'Project' },
      { path: np + '/CLAUDE.local.md', type: 'Local' },
    ]
    for (const c of candidates) {
      try {
        const r = await window.electronAPI.readFileByPath(c.path)
        if (r.success && r.content) {
          fileMap.get(c.type)!.push({ path: c.path, type: c.type, tokens: Math.ceil(r.content.length / 4), content: r.content })
        }
      } catch { /* */ }
    }

    // 2. Memory files from ~/.claude/projects/
    try {
      const has = await window.electronAPI.memory.hasMemory(projectId)
      if (has) {
        const idx = await window.electronAPI.memory.getIndex(projectId)
        if (idx) {
          const allKeys = [...new Set([...idx.entries.map(e => e.file), ...idx.orphanFiles])]
          for (const fileName of allKeys) {
            try {
              const r = await window.electronAPI.memory.readFile(projectId, fileName)
              if (r.success && r.content) {
                fileMap.get('AutoMem')!.push({ path: r.path || fileName, type: 'AutoMem', tokens: Math.ceil((r.content || '').length / 4), content: r.content })
              }
            } catch { /* */ }
          }
        }
      }
    } catch { /* */ }

    const groups: FileGroup[] = PROJECT_GROUP_DEFS.map(g => ({
      ...g,
      files: fileMap.get(g.type) || [],
      expanded: (fileMap.get(g.type) || []).length > 0,
    }))

    setGroups(groups)
    setLoadingFiles(false)
  }, [])

  const handleArrowClick = useCallback((e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (expandedProject === projectId) {
      setExpandedProject(null)
    } else {
      setExpandedProject(projectId)
      loadSessions(projectId)
    }
  }, [expandedProject, loadSessions])

  const handleProjectClick = useCallback((proj: Project) => {
    setGlobalSelected(false)
    setSelectedProjectId(proj.id)
    setSelectedProjectPath(proj.path || proj.name)
    setSelectedFile(null)
    setEditingContent('')
    setIsDirty(false)
    setSelectedSession(null)
    setJsonlContent('')
    loadAllFiles(proj.id, proj.path || proj.name)
  }, [loadAllFiles])

  const handleSessionClick = useCallback(async (session: Session, projectId: string) => {
    setSelectedSession(session)
    setSelectedFile(null)
    setEditingContent('')
    setIsDirty(false)
    setJsonlContent('')
    setLoadingJsonl(true)
    try {
      const homeDir = await window.electronAPI.getHomeDir()
      const jsonlPath = `${homeDir.replace(/\\/g, '/')}/.claude/projects/${projectId}/${session.id}.jsonl`
      const r = await window.electronAPI.readFileByPath(jsonlPath)
      if (r.success && r.content) {
        setJsonlContent(r.content)
      }
    } catch { /* */ }
    finally { setLoadingJsonl(false) }
  }, [])

  const handleSelectFile = useCallback((f: MemFile) => {
    const content = f.content || ''
    originalContentRef.current = content
    setSelectedFile(f)
    setEditingContent(content)
    setIsDirty(false)
    setDiskUpdated(false)
  }, [])

  const handleSave = useCallback(async () => {
    if (!selectedFile) return
    if (diskUpdated && !confirm('磁盘文件已被外部修改，覆盖保存？')) return
    setIsSaving(true)
    try {
      if (selectedFile.type === 'AutoMem') {
        const fileName = selectedFile.path.split(/[\\/]/).pop() || selectedFile.path
        await window.electronAPI.memory.saveFile(selectedProjectId!, fileName, editingContent)
      } else {
        await window.electronAPI.writeFileByPath(selectedFile.path, editingContent)
      }
      originalContentRef.current = editingContent
      setIsDirty(false)
      setDiskUpdated(false)
      if (selectedProjectId) loadAllFiles(selectedProjectId, selectedProjectPath)
    } catch { /* */ }
    finally { setIsSaving(false) }
  }, [selectedFile, editingContent, selectedProjectId, selectedProjectPath, loadAllFiles, diskUpdated])

  const handleDelete = useCallback(async () => {
    if (!selectedFile || !selectedProjectId) return
    if (!confirm(`Delete "${selectedFile.path.split(/[\\/]/).pop()}"?`)) return
    if (selectedFile.type === 'AutoMem') {
      const fileName = selectedFile.path.split(/[\\/]/).pop() || selectedFile.path
      await window.electronAPI.memory.deleteFile(selectedProjectId, fileName)
    }
    setSelectedFile(null); setEditingContent(''); setIsDirty(false)
    loadAllFiles(selectedProjectId, selectedProjectPath)
  }, [selectedFile, selectedProjectId, selectedProjectPath, loadAllFiles])

  const toggleGroup = useCallback((type: string) => {
    setGroups(prev => prev.map(g => g.type === type ? { ...g, expanded: !g.expanded } : g))
  }, [])

  const startResize = (col: 'col1' | 'col2') => (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = col
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="flex flex-col h-screen bg-surface text-text">
      <CustomTitleBar />
      <div ref={columnsRef} className="flex flex-1 min-h-0">
        {/* Column 1: Project Tree + Sessions */}
        <div style={{ width: col1Width, minWidth: 160 }} className="shrink-0 bg-surface-sidebar border-border flex flex-col">
          <div className="p-3 border-b border-border" style={{ WebkitAppRegion: 'drag', paddingLeft: trafficLightPadding } as React.CSSProperties}>
            <h1 className="text-sm font-semibold text-text-secondary">Claude Code Sessions</h1>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Global CLAUDE.md — special folder at top */}
            {globalGroups.some(g => g.files.length > 0) && (
              <>
                <div
                  onClick={() => { setGlobalSelected(!globalSelected); setSelectedProjectId(null); setSelectedFile(null); setSelectedSession(null) }}
                  className={`px-3 py-2 text-sm flex items-center gap-2 cursor-pointer transition-colors hover:bg-surface-raised ${
                    globalSelected ? 'bg-blue-600/10' : ''
                  }`}
                >
                  <span className="text-xs text-text-muted">{globalSelected ? '▼' : '▶'}</span>
                  <span className="text-xs">🌐</span>
                  <span className="text-text-secondary font-medium truncate flex-1">Global</span>
                  <span className="text-xs text-text-muted">{globalGroups.reduce((n, g) => n + g.files.length, 0)}</span>
                </div>
                <div className="mx-3 border-t border-border" />
              </>
            )}

            {/* Project list */}
            {projects.map((proj) => (
              <div key={proj.id}>
                <div
                  className={`px-3 py-2 text-sm flex items-center gap-2 transition-colors hover:bg-surface-raised ${
                    selectedProjectId === proj.id ? 'bg-blue-600/10' : ''}`}>
                  <span
                    onClick={(e) => handleArrowClick(e, proj.id)}
                    className="text-xs text-text-muted cursor-pointer hover:text-text-secondary px-0.5"
                  >{expandedProject === proj.id ? '▼' : '▶'}</span>
                  <span className="text-xs">📁</span>
                  <span
                    onClick={() => handleProjectClick(proj)}
                    className="text-text-secondary font-medium truncate cursor-pointer flex-1" title={proj.path || proj.name}>{projectTitle(proj)}</span>
                  <span className="text-xs text-text-muted">{proj.sessions.length}</span>
                </div>
                {expandedProject === proj.id && (
                  <div className="ml-6 border-l border-border">
                    {sessions.map((s) => (
                      <div key={s.id} onClick={() => handleSessionClick(s, proj.id)}
                        className={`px-3 py-1.5 cursor-pointer text-xs transition-colors hover:bg-surface-raised truncate ${
                          selectedSession?.id === s.id ? 'text-blue-400 bg-blue-600/10' : 'text-text-muted'
                        }`}>
                        {s.firstMessage?.slice(0, 40) || s.id.slice(0, 8)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-border px-3 py-2">
            <button
              onClick={() => { setShowAbout(!showAbout); setSelectedFile(null); setSelectedSession(null) }}
              className={`w-full text-xs py-1.5 rounded transition-colors ${
                showAbout ? 'bg-blue-600/20 text-blue-400' : 'text-text-muted hover:text-text hover:bg-surface-raised'
              }`}
            >
              {showAbout ? '✕ Close' : 'ℹ About — Loading Rules'}
            </button>
          </div>
        </div>

        {/* Resize handle 1 */}
        <div
          onMouseDown={startResize('col1')}
          className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/50 transition-colors bg-transparent"
        />

        {/* Column 2: File Tree */}
        <div style={{ width: col2Width, minWidth: 160 }} className="shrink-0 bg-surface-sidebar/50 border-r border-border flex flex-col">
          <div className="p-3 border-b border-border" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
            <h2 className="text-sm font-medium text-text-secondary">
              {selectedProjectPath ? selectedProjectPath.split(/[\\/]/).pop() : 'Files'}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Global folder content */}
            {globalSelected && (
              <div className="py-1 border-b border-border">
                {globalGroups.map((group) => {
                  const hasFiles = group.files.length > 0
                  return (
                    <div key={group.type}>
                      <div
                        onClick={() => hasFiles && setGlobalGroups(prev => prev.map(g => g.type === group.type ? { ...g, expanded: !g.expanded } : g))}
                        className={`px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer transition-colors hover:bg-surface-raised ${!hasFiles ? 'opacity-40' : ''}`}
                      >
                        <span className="text-text-muted text-[10px]">{hasFiles ? (group.expanded ? '▼' : '▶') : '  '}</span>
                        <span>{group.icon}</span>
                        <span style={{ color: group.color }} className="font-semibold uppercase tracking-wide">{group.label}</span>
                        <span className="text-text-muted ml-auto">{group.files.length}</span>
                      </div>
                      {group.expanded && group.files.map((f) => (
                        <div key={f.path} onClick={() => handleSelectFile(f)}
                          className={`pl-10 pr-3 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2 ${
                            selectedFile?.path === f.path ? 'text-blue-400 bg-blue-600/10 border-r-2 border-blue-500'
                              : 'text-text-secondary hover:bg-surface-raised hover:text-text'
                          }`}
                        >
                          <span className="text-text-muted shrink-0">📄</span>
                          <span className="font-mono truncate">{f.path.split(/[\\/]/).pop()}</span>
                          {f.tokens > 0 && <span className="text-text-muted shrink-0 ml-auto">{formatTokens(f.tokens)}</span>}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Project-specific files */}
            {!selectedProjectId && !globalSelected ? (
              <div className="p-4 text-sm text-text-muted">Select a project or Global</div>
            ) : !selectedProjectId ? null : loadingFiles ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="py-1">
                {groups.map((group) => {
                  const hasFiles = group.files.length > 0
                  return (
                    <div key={group.type}>
                      <div
                        onClick={() => hasFiles && toggleGroup(group.type)}
                        className={`px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer transition-colors hover:bg-surface-raised/50 ${
                          !hasFiles ? 'opacity-40' : ''
                        }`}
                      >
                        <span className="text-text-muted text-[10px]">
                          {hasFiles ? (group.expanded ? '▼' : '▶') : '  '}
                        </span>
                        <span>{group.icon}</span>
                        <span style={{ color: group.color }} className="font-semibold uppercase tracking-wide">
                          {group.label}
                        </span>
                        <span className="text-text-muted ml-auto">{group.files.length}</span>
                      </div>
                      {group.expanded && group.files.map((f) => (
                        <div
                          key={f.path}
                          onClick={() => handleSelectFile(f)}
                          className={`pl-10 pr-3 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2 ${
                            selectedFile?.path === f.path
                              ? 'text-blue-400 bg-blue-600/10 border-r-2 border-blue-500'
                              : 'text-text-secondary hover:bg-surface-raised/70 hover:text-text'
                          }`}
                        >
                          <span className="text-text-muted shrink-0">📄</span>
                          <span className="font-mono truncate">{f.path.split(/[\\/]/).pop()}</span>
                          {f.tokens > 0 && (
                            <span className="text-text-muted shrink-0 ml-auto">{formatTokens(f.tokens)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Resize handle 2 */}
        <div
          onMouseDown={startResize('col2')}
          className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/50 transition-colors bg-transparent"
        />

        {/* Column 3: Content Viewer */}
        <div className="flex-1 flex flex-col bg-surface min-w-[160px]">
          {showAbout ? (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-xl mx-auto space-y-5">
                <h2 className="text-sm font-semibold text-text">Loading Rules</h2>
                <p className="text-xs text-text-secondary leading-relaxed">
                  All CLAUDE.md files are <span className="text-text">merged together</span> when Claude starts.
                  No file "overrides" another — all content is visible in context.
                  When instructions conflict, more specific files (Local &gt; Project &gt; User) take precedence.
                </p>
                {GROUP_DEFS.map((g) => (
                  <div key={g.type} className="bg-surface-sidebar rounded border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">{g.icon}</span>
                      <span style={{ color: g.color }} className="text-sm font-semibold uppercase tracking-wide">{g.label}</span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed mb-1">{g.desc}</p>
                    <p className="text-[10px] text-text-muted font-mono mb-0.5">{g.path}</p>
                    <p className="text-[10px] text-text-muted">{g.priority}</p>
                  </div>
                ))}
                <div className="text-[10px] text-text-muted pt-2 border-t border-border">
                  <p>CC Memory — Claude Code memory file manager</p>
                </div>
              </div>
            </div>
          ) : selectedFile ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Collapsible loading rules for this memory type */}
              {(() => {
                const def = GROUP_DEFS.find(g => g.type === selectedFile.type)
                if (!def) return null
                return (
                  <div className="border-b border-border">
                    <div
                      onClick={() => setRulesExpanded(!rulesExpanded)}
                      className="px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-surface-raised/50 transition-colors select-none"
                    >
                      <span className="text-[10px] text-text-muted">{rulesExpanded ? '▼' : '▶'}</span>
                      <span>{def.icon}</span>
                      <span style={{ color: def.color }} className="text-[10px] font-semibold uppercase tracking-wide">{def.label}</span>
                      <span className="text-[10px] text-text-muted">— {def.desc.slice(0, 60)}…</span>
                    </div>
                    {rulesExpanded && (
                      <div className="px-4 pb-2 space-y-1">
                        <p className="text-[10px] text-text-secondary leading-relaxed">{def.desc}</p>
                        <p className="text-[10px] text-text-muted font-mono">{def.path}</p>
                        <p className="text-[10px] text-text-muted">{def.priority}</p>
                      </div>
                    )}
                  </div>
                )
              })()}
              {/* File path + actions + info */}
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-surface-sidebar/30"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="font-mono text-text-secondary truncate">{selectedFile.path.split(/[\\/]/).pop()}</span>
                  <span className="text-text-muted text-[10px]">{shortenPath(selectedFile.path)}</span>
                  {isDirty && <span className="text-yellow-500 text-[10px]">● 未保存</span>}
                  {diskUpdated && <span className="text-yellow-500 text-[10px]">⚠ 磁盘已更新</span>}
                  <span className="text-text-muted text-[10px]">| {editingContent.split('\n').length} lines · {new Blob([editingContent]).size.toLocaleString()} bytes · {formatTokens(Math.ceil(editingContent.length / 4))}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                  <button onClick={handleSave} disabled={isSaving || !isDirty}
                    className={`text-xs px-3 py-1 rounded ${
                      isDirty ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-surface-raised text-text-muted'
                    }`}>
                    {isSaving ? '保存中...' : '保存'}
                  </button>
                  {selectedFile.type === 'AutoMem' && (
                    <button onClick={handleDelete}
                      className="text-xs px-3 py-1 bg-surface-raised hover:bg-red-900 text-text-secondary hover:text-red-400 rounded">
                      删除
                    </button>
                  )}
                </div>
              </div>
              <CodeMirrorEditor value={editingContent} onChange={(v) => { setEditingContent(v); setIsDirty(v !== originalContentRef.current) }} />
            </div>
          ) : selectedSession ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center px-4 py-2 border-b border-border bg-surface-sidebar"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
                <div className="flex min-w-0 items-center gap-3 text-xs">
                  <span className="text-text-muted">📋</span>
                  <span className="truncate font-mono text-text-secondary">{selectedSession.id}.jsonl</span>
                  <span className="text-text-muted">{selectedSession.firstMessage?.slice(0, 50)}</span>
                </div>
              </div>
              {loadingJsonl ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              ) : jsonlContent ? (
                <CodeMirrorEditor value={jsonlContent} onChange={() => {}} readOnly />
              ) : (
                <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Failed to load session data</div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
              {selectedProjectId ? 'Select a file or session to view' : 'Select a project to browse files'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// CodeMirror 6 Editor
// ============================================================
function CodeMirrorEditor({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const externalUpdateRef = useRef(false)
  const isLightRef = useRef(document.documentElement.classList.contains('light'))
  onChangeRef.current = onChange

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Recreate when theme changes (detected via DOM observer on <html> class)
    const observer = new MutationObserver(() => {
      const nowLight = document.documentElement.classList.contains('light')
      if (nowLight !== isLightRef.current) {
        isLightRef.current = nowLight
        viewRef.current?.destroy()
        viewRef.current = null
        createView(container)
      }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    createView(container)
    return () => { observer.disconnect(); viewRef.current?.destroy(); viewRef.current = null }
  }, [])

  function createView(container: HTMLDivElement) {
    const isLight = isLightRef.current
    // Constrain the editor to its container height; without this, .cm-editor
    // grows to the full document height and the page becomes unscrollable.
    const fillTheme = EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflowY: 'auto' },
    })
    const state = EditorState.create({
      doc: value,
      extensions: [
        fillTheme,
        markdown(),
        ...(isLight ? [] : [oneDark]),
        lineNumbers(),
        EditorView.lineWrapping,
        ...(isLight ? [syntaxHighlighting(defaultHighlightStyle), EditorView.theme({
          '&': { backgroundColor: 'var(--color-surface)' },
          '.cm-gutters': { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text-muted)', borderRight: '1px solid var(--color-border)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--color-surface-raised)' },
          '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.04)' },
          '.cm-cursor': { borderLeftColor: 'var(--color-text)' },
          '.cm-selectionBackground': { backgroundColor: 'rgba(0,0,0,0.1)' },
          '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(0,0,0,0.15)' },
        }, { dark: false })] : []),
        ...(readOnly ? [EditorView.editable.of(false)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdateRef.current) onChangeRef.current(update.state.doc.toString())
          externalUpdateRef.current = false
        }),
      ],
    })
    const view = new EditorView({ state, parent: container })
    viewRef.current = view
  }

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      externalUpdateRef.current = true
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden" />
}
