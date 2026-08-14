/**
 * LinkIndexer - Builds the reverse index of markdown files referenced from
 * CLAUDE.md / MEMORY.md.
 *
 * Source (indexing) files:
 * - Project CLAUDE.md: <projectPath>/CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md
 * - User CLAUDE.md:   ~/.claude/CLAUDE.md
 * - MEMORY.md entries (via MemoryReader.readIndex)
 *
 * Indexed (target) files:
 * - Any `.md` file those sources link to, resolved to an absolute path,
 *   EXCLUDING files inside the project's memory directory (those already live
 *   under the "记忆" group and would be redundant here).
 *
 * Local-filesystem only. In SSH contexts the memory paths are remote, so
 * existence checks fail and the index degrades to an empty result gracefully.
 */

import { type IndexedFile, type IndexSourceRef } from '@shared/types/api';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

import { parseMdFileReferences } from '../parsing/LinkParser';

import type { MemoryReader } from './MemoryReader';

export class LinkIndexer {
  private readonly memoryReader: MemoryReader;

  constructor(memoryReader: MemoryReader) {
    this.memoryReader = memoryReader;
  }

  /**
   * Builds the reverse index for a project. Targets are grouped and sorted by
   * directory, then file name.
   */
  async buildIndex(projectId: string, projectPath: string): Promise<IndexedFile[]> {
    const memoryDir = this.memoryReader.getDirPath(projectId);
    const byTarget = new Map<string, Map<string, IndexSourceRef>>();

    const addRef = (
      targetAbs: string,
      source: { path: string; fileName: string },
      line?: number
    ): void => {
      if (!targetAbs.toLowerCase().endsWith('.md')) return;
      if (isWithin(targetAbs, memoryDir)) return;
      if (!fs.existsSync(targetAbs)) return;

      let refs = byTarget.get(targetAbs);
      if (!refs) {
        refs = new Map();
        byTarget.set(targetAbs, refs);
      }
      if (!refs.has(source.path)) {
        refs.set(source.path, { path: source.path, fileName: source.fileName, line });
      }
    };

    // 1. CLAUDE.md sources
    const home = homedir();
    const claudeMdPaths = [
      path.join(projectPath, 'CLAUDE.md'),
      path.join(projectPath, '.claude', 'CLAUDE.md'),
      path.join(projectPath, 'CLAUDE.local.md'),
      path.join(home, '.claude', 'CLAUDE.md'),
    ];
    for (const srcPath of claudeMdPaths) {
      let content: string;
      try {
        content = await fs.promises.readFile(srcPath, 'utf-8');
      } catch {
        continue;
      }
      const source = { path: srcPath, fileName: path.basename(srcPath) };
      const sourceDir = path.dirname(srcPath);
      const repoRoot = findRepoRoot(sourceDir);
      for (const ref of parseMdFileReferences(content)) {
        if (ref.kind === 'url') {
          const urlPath = extractUrlRepoPath(ref.raw);
          if (urlPath && repoRoot) {
            addRef(path.join(repoRoot, urlPath), source, ref.line);
          }
          continue;
        }
        const targetAbs = path.resolve(sourceDir, ref.raw);
        addRef(targetAbs, source, ref.line);
      }
    }

    // 2. MEMORY.md entries — MEMORY.md links to files inside the memory dir,
    // which addRef excludes, but keep as a source for correctness/completeness.
    try {
      const idx = await this.memoryReader.readIndex(projectId);
      if (idx && idx.entries.length > 0) {
        const memorySource = { path: path.join(memoryDir, 'MEMORY.md'), fileName: 'MEMORY.md' };
        for (const entry of idx.entries) {
          addRef(path.join(memoryDir, entry.file), memorySource, entry.lineNumber);
        }
      }
    } catch {
      // Memory unavailable (e.g. SSH) — ignore, index still contains CLAUDE.md refs.
    }

    const files: IndexedFile[] = [];
    for (const [targetAbs, refs] of byTarget) {
      files.push({
        path: targetAbs,
        fileName: path.basename(targetAbs),
        dir: path.dirname(targetAbs),
        sources: [...refs.values()],
      });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.fileName.localeCompare(b.fileName));
    return files;
  }
}

function isWithin(child: string, dir: string): boolean {
  const rel = path.relative(dir, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Nearest ancestor directory containing a `.git` entry (dir or worktree file). */
function findRepoRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Extracts a repo-relative `.md` path from a remote URL so it can be resolved
 * against the local git root. Handles the common `/blob/<ref>/path.md` form;
 * query/fragment suffixes are stripped. Returns null for non-`.md` URLs.
 */
function extractUrlRepoPath(url: string): string | null {
  const schemeEnd = url.indexOf('://');
  const hostStart = schemeEnd === -1 ? 0 : schemeEnd + 3;
  const slash = url.indexOf('/', hostStart);
  if (slash === -1) return null;
  let rest = url.slice(slash + 1);
  const queryStart = rest.search(/[?#]/);
  if (queryStart !== -1) rest = rest.slice(0, queryStart);
  if (!rest.toLowerCase().endsWith('.md')) return null;
  if (rest.startsWith('blob/')) {
    const parts = rest.split('/');
    if (parts.length >= 3) rest = parts.slice(2).join('/');
  }
  return rest || null;
}
