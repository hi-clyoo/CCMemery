import { useCallback, useEffect, useRef,useState } from 'react'

import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle,syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, lineNumbers } from '@codemirror/view'
import { getTrafficLightPaddingForZoom } from '@shared/constants'
import { Moon,Sun } from 'lucide-react'

import { GitStatusIcon } from './components/GitStatusIcon'
import { CustomTitleBar } from './components/layout/CustomTitleBar'
import { useTheme } from './hooks/useTheme'
import { useZoomFactor } from './hooks/useZoomFactor'
import { isElectronMode } from './api'

import type { GitFileStatus, IndexSourceRef, LinkIndexResult, Project, Session } from '@shared/types'

// ============================================================
// Types & Constants
// ============================================================
interface MemFile { path: string; type: string; tokens: number; content?: string; dir?: string; sources?: IndexSourceRef[] }

interface FileGroup {
  type: string
  label: string
  icon: string
  color: string
  desc: string
  path: string
  priority: string
  labelZh: string
  descZh: string
  pathZh: string
  priorityZh: string
  files: MemFile[]
  expanded: boolean
}

const GLOBAL_GROUP_DEFS = [
  {
    type: 'Managed', label: 'Managed', icon: '🛡️', color: '#A855F7',
    desc: 'System-level mandatory rules from Claude Code installation. Automatically loaded for every session — always in effect.',
    path: '<install>/CLAUDE.md  (e.g., C:\\Program Files\\ClaudeCode\\CLAUDE.md)',
    priority: 'Always loaded — applies to all projects',
    labelZh: '系统管理',
    descZh: '来自 Claude Code 安装的系统级强制规则。每个会话都会自动加载——始终生效。',
    pathZh: '<install>/CLAUDE.md  （例如 C:\\Program Files\\ClaudeCode\\CLAUDE.md）',
    priorityZh: '始终加载——适用于所有项目',
  },
  {
    type: 'User', label: 'User', icon: '👤', color: '#3B82F6',
    desc: 'Your personal global instructions (via /config). Loaded for ALL projects. Merged with project-specific rules below.',
    path: '~/.claude/CLAUDE.md',
    priority: 'Always loaded — applies globally',
    labelZh: '用户',
    descZh: '你的个人全局指令（通过 /config 配置）。对所有项目加载，并与下面的项目级规则合并。',
    pathZh: '~/.claude/CLAUDE.md',
    priorityZh: '始终加载——全局生效',
  },
]

const PROJECT_GROUP_DEFS = [
  {
    type: 'Project', label: 'Project', icon: '📄', color: '#F97316',
    desc: 'Project-level instructions, checked into git — shared with your team. Also loaded from .claude/ subdirectories.',
    path: './CLAUDE.md  /  .claude/CLAUDE.md',
    priority: 'Loaded per-project — adds to User rules',
    labelZh: '项目',
    descZh: '项目级指令，已纳入 git 版本控制——与团队共享。也会从 .claude/ 子目录加载。',
    pathZh: './CLAUDE.md  /  .claude/CLAUDE.md',
    priorityZh: '按项目加载——叠加在用户规则之上',
  },
  {
    type: 'Local', label: 'Local', icon: '🔒', color: '#22C55E',
    desc: 'Local-only additions, NEVER checked into git. Use for personal project tweaks. Takes precedence on conflicts.',
    path: './CLAUDE.local.md',
    priority: 'Loaded per-project — takes precedence on conflicts',
    labelZh: '本地',
    descZh: '仅本地的补充，绝不会纳入 git 版本控制。用于个人项目调整，冲突时优先。',
    pathZh: './CLAUDE.local.md',
    priorityZh: '按项目加载——冲突时优先',
  },
  {
    type: 'AutoMem', label: 'Memory', icon: '🧠', color: '#EC4899',
    desc: 'Auto-generated memory from conversations. Managed by Claude via MEMORY.md index. Project-scoped.',
    path: '~/.claude/projects/<proj>/memory/',
    priority: 'Loaded alongside rules (separate channel)',
    labelZh: '记忆',
    descZh: '从对话中自动生成的记忆，由 Claude 通过 MEMORY.md 索引管理，作用于项目范围。',
    pathZh: '~/.claude/projects/<proj>/memory/',
    priorityZh: '与规则同时加载（独立通道）',
  },
  {
    type: 'Index', label: 'Index', icon: '🔗', color: '#06B6D4',
    desc: 'Markdown files linked from CLAUDE.md files, grouped by directory. The backlink ("indexed by") is shown at the top of each file.',
    path: 'files linked from CLAUDE.md',
    priority: 'Reverse index — grouped by directory',
    labelZh: '索引',
    descZh: '被 CLAUDE.md 链接引用的 Markdown 文件，按目录分组。每个文件顶部会显示它的索引来源。',
    pathZh: '由 CLAUDE.md 链接引用的文件',
    priorityZh: '反向索引——按目录分组',
  },
]

const GROUP_DEFS = [...GLOBAL_GROUP_DEFS, ...PROJECT_GROUP_DEFS]

// ------------------------------------------------------------
// Lightweight i18n (en / zh)
// ------------------------------------------------------------
type Lang = 'en' | 'zh'
const LANG_KEY = 'cc-memory-lang'
function loadLang(): Lang {
  try { return localStorage.getItem(LANG_KEY) === 'zh' ? 'zh' : 'en' } catch { return 'en' }
}
function saveLang(l: Lang): void {
  try { localStorage.setItem(LANG_KEY, l) } catch { /* */ }
}
/** Localize a group definition's display fields. */
function localizeGroup(
  g: { label: string; desc: string; path: string; priority: string; labelZh: string; descZh: string; pathZh: string; priorityZh: string },
  lang: Lang
): { label: string; desc: string; path: string; priority: string } {
  return lang === 'zh'
    ? { label: g.labelZh, desc: g.descZh, path: g.pathZh, priority: g.priorityZh }
    : { label: g.label, desc: g.desc, path: g.path, priority: g.priority }
}
/** Localize a plain UI string. */
function t(lang: Lang, en: string, zh: string): string {
  return lang === 'zh' ? zh : en
}

function formatTokens(tokens: number): string {
  if (!tokens) return ''
  if (tokens < 1000) return `${tokens} tok`
  return `${(tokens / 1000).toFixed(1)}K tok`
}

function shortenPath(p: string): string {
  const m = /^([A-Za-z]:\\[Uu]sers\\[^\\]+)/.exec(p)
  return m ? '~' + p.slice(m[0].length) : p
}

/** Directory display: relative to the project path when inside it, else ~-shortened. */
function shortenDir(dir: string, projectPath: string): string {
  const np = projectPath.replace(/\\/g, '/')
  const d = dir.replace(/\\/g, '/')
  if (d.startsWith(np)) return d.slice(np.length).replace(/^\/+/, '') || '/'
  return shortenPath(d)
}

/**
 * Build a display-friendly project title.
 * Worktrees (paths containing .claude/worktrees/) show as "repo [worktree: name]".
 */
function projectTitle(proj: Project): string {
  const p = (proj.path || proj.name).replace(/\\/g, '/')
  const wtMatch = /\.claude\/worktrees\/(.+)$/.exec(p)
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
const App: React.FC = () => {
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
  const [linkIndex, setLinkIndex] = useState<LinkIndexResult | null>(null)
  const [gitStatus, setGitStatus] = useState<Record<string, GitFileStatus>>({})
  const [col1Width, setCol1Width] = useState(240)
  const [col2Width, setCol2Width] = useState(300)
  const col1Ref = useRef(240)
  const col2Ref = useRef(300)
  const draggingRef = useRef<'col1' | 'col2' | null>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const globalFilesRef = useRef<MemFile[]>([])

  // Language preference (persisted to localStorage)
  const [lang, setLang] = useState<Lang>(() => loadLang())
  const toggleLang = useCallback(() => {
    setLang(prev => {
      const next: Lang = prev === 'zh' ? 'en' : 'zh'
      saveLang(next)
      return next
    })
  }, [])
  const [appVersion, setAppVersion] = useState('')

  // macOS hidden title bar: reserve space for the native traffic lights.
  // Windows/Linux use CustomTitleBar instead, so no left padding needed there.
  const zoomFactor = useZoomFactor()
  const isMac = /Mac/i.test(navigator.userAgent)
  const trafficLightPadding = isElectronMode() && isMac ? getTrafficLightPaddingForZoom(zoomFactor) : 0
  const { isLight, toggleTheme } = useTheme()

  // Dismiss splash
  useEffect(() => {
    const splash = document.getElementById('splash')
    if (splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 300) }
  }, [])

  useEffect(() => {
    window.electronAPI.getProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion).catch(() => {})
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

  // Keep a ref of global file paths so loadAllFiles can include them in the git-status query.
  useEffect(() => {
    globalFilesRef.current = globalGroups.flatMap(g => g.files)
  }, [globalGroups])

  // Detect disk changes when window regains focus
  useEffect(() => {
    const onFocus = async () => {
      if (!selectedFile) return
      try {
        const r = selectedFile.type === 'AutoMem'
          ? await window.electronAPI.memory.readFile(selectedProjectId!, selectedFile.path.split(/[\\/]/).pop()!)
          : await window.electronAPI.readFileByPath(selectedFile.path)
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
    const candidates: { path: string; type: string }[] = [
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

    // 3. Reverse index (files linked from CLAUDE.md / MEMORY.md) + git status
    const allPaths = globalFilesRef.current.map(f => f.path)
    for (const [, arr] of fileMap) for (const f of arr) allPaths.push(f.path)
    let linkResult: LinkIndexResult | null = null
    try {
      linkResult = await window.electronAPI.memory.getLinkIndex(projectId, projectPath, allPaths)
    } catch { /* */ }
    setGitStatus(linkResult?.git ?? {})
    setLinkIndex(linkResult)

    if (linkResult && linkResult.files.length > 0) {
      const indexedFiles: MemFile[] = []
      for (const f of linkResult.files) {
        let content: string | undefined
        try {
          const r = await window.electronAPI.readFileByPath(f.path)
          if (r.success) content = r.content
        } catch { /* */ }
        indexedFiles.push({
          path: f.path,
          type: 'Index',
          tokens: content ? Math.ceil(content.length / 4) : 0,
          content,
          dir: f.dir,
          sources: f.sources,
        })
      }
      fileMap.set('Index', indexedFiles)
    }

    const nextGroups: FileGroup[] = PROJECT_GROUP_DEFS.map(g => ({
      ...g,
      files: fileMap.get(g.type) || [],
      expanded: (fileMap.get(g.type) || []).length > 0,
    }))

    setGroups(nextGroups)
    setLoadingFiles(false)
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.memory.onChanged(({ projectId }) => {
      if (projectId === selectedProjectId) void loadAllFiles(selectedProjectId, selectedProjectPath)
    })
    return unsub
  }, [selectedProjectId, selectedProjectPath, loadAllFiles])

  const handleArrowClick = useCallback((e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (expandedProject === projectId) {
      setExpandedProject(null)
    } else {
      setExpandedProject(projectId)
      void loadSessions(projectId)
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
    setLinkIndex(null)
    setGitStatus({})
    void loadAllFiles(proj.id, proj.path || proj.name)
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

  const handleSelectFile = useCallback(async (f: MemFile) => {
    let content = f.content
    if (content === undefined) {
      try {
        const r = await window.electronAPI.readFileByPath(f.path)
        if (r.success) content = r.content
      } catch { /* */ }
    }
    const resolved = content ?? ''
    originalContentRef.current = resolved
    setSelectedFile(f)
    setEditingContent(resolved)
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
      if (selectedProjectId) void loadAllFiles(selectedProjectId, selectedProjectPath)
    } catch { /* */ }
    finally { setIsSaving(false) }
  }, [selectedFile, editingContent, selectedProjectId, selectedProjectPath, loadAllFiles, diskUpdated])

  const handleDelete = useCallback(async () => {
    if (!selectedFile || !selectedProjectId) return
    const fname = selectedFile.path.split(/[\\/]/).pop() ?? selectedFile.path
    if (!confirm(lang === 'zh' ? `删除 "${fname}"？` : `Delete "${fname}"?`)) return
    if (selectedFile.type === 'AutoMem') {
      const fileName = selectedFile.path.split(/[\\/]/).pop() || selectedFile.path
      await window.electronAPI.memory.deleteFile(selectedProjectId, fileName)
    }
    setSelectedFile(null); setEditingContent(''); setIsDirty(false)
    void loadAllFiles(selectedProjectId, selectedProjectPath)
  }, [selectedFile, selectedProjectId, selectedProjectPath, loadAllFiles, lang])

  /** Opens a file by absolute path (used by backlink chips) — finds it in the loaded groups, else fetches content. */
  const openFile = useCallback(async (filePath: string) => {
    const allGroups = [...globalGroups, ...groups]
    for (const g of allGroups) {
      const found = g.files.find(x => x.path === filePath)
      if (found) {
        await handleSelectFile(found)
        return
      }
    }
    try {
      const r = await window.electronAPI.readFileByPath(filePath)
      if (r.success) {
        await handleSelectFile({
          path: filePath,
          type: 'Index',
          tokens: r.content ? Math.ceil(r.content.length / 4) : 0,
          content: r.content,
        })
      }
    } catch { /* */ }
  }, [globalGroups, groups, handleSelectFile])

  /** Renders file rows for a group. The Index group is additionally grouped by directory. */
  const renderGroupFiles = (group: FileGroup) => {
    const row = (f: MemFile) => (
      <div
        key={f.path}
        onClick={() => void handleSelectFile(f)}
        className={`pl-10 pr-3 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2 ${
          selectedFile?.path === f.path
            ? 'text-blue-400 bg-blue-600/10 border-r-2 border-blue-500'
            : 'text-text-secondary hover:bg-surface-raised/70 hover:text-text'
        }`}
      >
        <span className="text-text-muted shrink-0">📄</span>
        <GitStatusIcon status={gitStatus[f.path]} lang={lang} />
        <span className="font-mono truncate">{f.path.split(/[\\/]/).pop()}</span>
        {f.tokens > 0 && (
          <span className="text-text-muted shrink-0 ml-auto">{formatTokens(f.tokens)}</span>
        )}
      </div>
    )
    if (group.type !== 'Index') return group.files.map(row)
    const byDir = new Map<string, MemFile[]>()
    for (const f of group.files) {
      const dir = f.dir || ''
      const arr = byDir.get(dir) ?? []
      arr.push(f)
      byDir.set(dir, arr)
    }
    const dirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b))
    return dirs.map(dir => (
      <div key={dir}>
        <div className="pl-8 pr-3 py-1 text-[10px] text-text-muted font-mono truncate">
          {shortenDir(dir, selectedProjectPath)}
        </div>
        {(byDir.get(dir) ?? []).map(row)}
      </div>
    ))
  }

  const toggleGroup = useCallback((type: string) => {
    setGroups(prev => prev.map(g => g.type === type ? { ...g, expanded: !g.expanded } : g))
  }, [])

  const toggleGlobalGroup = useCallback((type: string) => {
    setGlobalGroups(prev => prev.map(g => g.type === type ? { ...g, expanded: !g.expanded } : g))
  }, [])

  const startResize = (col: 'col1' | 'col2') => (e: React.MouseEvent) => {
    e.preventDefault()
    // eslint-disable-next-line react-hooks/refs -- event handler writes ref on mousedown, not during render
    draggingRef.current = col
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Files that index the currently open file (backlinks), for the "索引来源" row.
  const selectedFileSources = selectedFile
    ? (linkIndex?.files.find(f => f.path === selectedFile.path)?.sources ?? [])
    : []

  return (
    <div className="flex flex-col h-screen bg-surface text-text">
      <CustomTitleBar />
      <div ref={columnsRef} className="flex flex-1 min-h-0">
        {/* Column 1: Project Tree + Sessions */}
        <div style={{ width: col1Width, minWidth: 160 }} className="shrink-0 bg-surface-sidebar border-border flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-end gap-2" style={{ WebkitAppRegion: 'drag', paddingLeft: trafficLightPadding } as React.CSSProperties}>
            <div className="flex items-center gap-1.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <button
                onClick={toggleTheme}
                title={isLight ? 'Switch to dark' : 'Switch to light'}
                aria-label="Toggle theme"
                className="flex items-center justify-center size-6 rounded border border-border text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
              >
                {isLight ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
              </button>
              <button
                onClick={toggleLang}
                title={lang === 'zh' ? 'Switch to English' : '切换为中文'}
                className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
              >
                {lang === 'zh' ? 'EN' : '中文'}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Global CLAUDE.md — special folder at top */}
            {globalGroups.some(g => g.files.length > 0) && (
              <>
                <div
                  onClick={() => { setGlobalSelected(!globalSelected); setSelectedProjectId(null); setSelectedFile(null); setSelectedSession(null); setLinkIndex(null); setGitStatus({}) }}
                  className={`px-3 py-2 text-sm flex items-center gap-2 cursor-pointer transition-colors hover:bg-surface-raised ${
                    globalSelected ? 'bg-blue-600/10' : ''
                  }`}
                >
                  <span className="text-xs text-text-muted">{globalSelected ? '▼' : '▶'}</span>
                  <span className="text-xs">🌐</span>
                  <span className="text-text-secondary font-medium truncate flex-1">{t(lang, 'Global', '全局')}</span>
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
              {showAbout ? t(lang, '✕ Close', '✕ 关闭') : t(lang, 'ℹ About — Loading Rules', 'ℹ 关于 — 加载规则')}
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
              {selectedProjectPath ? selectedProjectPath.split(/[\\/]/).pop() : t(lang, 'Files', '文件')}
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
                        onClick={() => hasFiles && toggleGlobalGroup(group.type)}
                        className={`px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer transition-colors hover:bg-surface-raised ${!hasFiles ? 'opacity-40' : ''}`}
                      >
                        <span className="text-text-muted text-[10px]">{hasFiles ? (group.expanded ? '▼' : '▶') : '  '}</span>
                        <span>{group.icon}</span>
                        <span style={{ color: group.color }} className="font-semibold uppercase tracking-wide">{localizeGroup(group, lang).label}</span>
                        <span className="text-text-muted ml-auto">{group.files.length}</span>
                      </div>
                      {group.expanded && group.files.map((f) => (
                        <div key={f.path} onClick={() => void handleSelectFile(f)}
                          className={`pl-10 pr-3 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2 ${
                            selectedFile?.path === f.path ? 'text-blue-400 bg-blue-600/10 border-r-2 border-blue-500'
                              : 'text-text-secondary hover:bg-surface-raised hover:text-text'
                          }`}
                        >
                          <span className="text-text-muted shrink-0">📄</span>
                          <GitStatusIcon status={gitStatus[f.path]} lang={lang} />
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
              <div className="p-4 text-sm text-text-muted">{t(lang, 'Select a project or Global', '选择一个项目或全局')}</div>
            ) : !selectedProjectId ? null : loadingFiles ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin size-4 border-2 border-blue-500 border-t-transparent rounded-full" />
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
                          {localizeGroup(group, lang).label}
                        </span>
                        <span className="text-text-muted ml-auto">{group.files.length}</span>
                      </div>
                      {group.expanded && renderGroupFiles(group)}
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
                <h2 className="text-sm font-semibold text-text">{t(lang, 'Loading Rules', '加载规则')}</h2>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {lang === 'zh' ? (
                    <>所有 CLAUDE.md 文件在 Claude 启动时都会<span className="text-text">合并在一起</span>加载。
                    没有哪个文件会“覆盖”另一个文件——所有内容都会进入上下文。
                    当指令冲突时，更具体的文件（本地 &gt; 项目 &gt; 用户）优先。</>
                  ) : (
                    <>All CLAUDE.md files are <span className="text-text">merged together</span> when Claude starts.
                    No file &quot;overrides&quot; another — all content is visible in context.
                    When instructions conflict, more specific files (Local &gt; Project &gt; User) take precedence.</>
                  )}
                </p>
                {GROUP_DEFS.map((g) => {
                  const loc = localizeGroup(g, lang)
                  return (
                    <div key={g.type} className="bg-surface-sidebar rounded border border-border p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">{g.icon}</span>
                        <span style={{ color: g.color }} className="text-sm font-semibold uppercase tracking-wide">{loc.label}</span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed mb-1">{loc.desc}</p>
                      <p className="text-[10px] text-text-muted font-mono mb-0.5">{loc.path}</p>
                      <p className="text-[10px] text-text-muted">{loc.priority}</p>
                    </div>
                  )
                })}
                <div className="text-[10px] text-text-muted pt-2 border-t border-border">
                  <p>{t(lang, 'CC Memory — Claude Code memory file manager', 'CC Memory — Claude Code 记忆文件管理器')}</p>
                  {appVersion && <p className="mt-0.5">v{appVersion}</p>}
                </div>
              </div>
            </div>
          ) : selectedFile ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Collapsible loading rules for this memory type */}
              {(() => {
                const def = GROUP_DEFS.find(g => g.type === selectedFile.type)
                if (!def) return null
                const loc = localizeGroup(def, lang)
                return (
                  <div className="border-b border-border">
                    <div
                      onClick={() => setRulesExpanded(!rulesExpanded)}
                      className="px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-surface-raised/50 transition-colors select-none"
                    >
                      <span className="text-[10px] text-text-muted">{rulesExpanded ? '▼' : '▶'}</span>
                      <span>{def.icon}</span>
                      <span style={{ color: def.color }} className="text-[10px] font-semibold uppercase tracking-wide">{loc.label}</span>
                      <span className="text-[10px] text-text-muted">— {loc.desc.slice(0, 60)}…</span>
                    </div>
                    {rulesExpanded && (
                      <div className="px-4 pb-2 space-y-1">
                        <p className="text-[10px] text-text-secondary leading-relaxed">{loc.desc}</p>
                        <p className="text-[10px] text-text-muted font-mono">{loc.path}</p>
                        <p className="text-[10px] text-text-muted">{loc.priority}</p>
                        {selectedFileSources.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap pt-1">
                            <span className="text-[10px] text-text-muted">🔗 {t(lang, 'Indexed by', '索引来源')}:</span>
                            {selectedFileSources.map(s => (
                              <button
                                key={s.path}
                                onClick={() => void openFile(s.path)}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-border text-blue-400 hover:bg-surface-raised hover:text-blue-300 transition-colors"
                              >
                                {s.fileName}
                              </button>
                            ))}
                          </div>
                        )}
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
                  <GitStatusIcon status={gitStatus[selectedFile.path]} lang={lang} />
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
                  <div className="animate-spin size-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              ) : jsonlContent ? (
                <CodeMirrorEditor value={jsonlContent} onChange={() => {}} readOnly />
              ) : (
                <div className="flex-1 flex items-center justify-center text-text-muted text-sm">{t(lang, 'Failed to load session data', '无法加载会话数据')}</div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
              {selectedProjectId
                ? t(lang, 'Select a file or session to view', '选择一个文件或会话进行查看')
                : t(lang, 'Select a project to browse files', '选择一个项目以浏览文件')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App

// ============================================================
// CodeMirror 6 Editor
// ============================================================
const CodeMirrorEditor = ({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const externalUpdateRef = useRef(false)
  const isLightRef = useRef(document.documentElement.classList.contains('light'))

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const createView = (target: HTMLDivElement) => {
      const isLight = isLightRef.current
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
      const view = new EditorView({ state, parent: target })
      viewRef.current = view
    }

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only; value/readOnly changes are handled by the sync effect below

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
