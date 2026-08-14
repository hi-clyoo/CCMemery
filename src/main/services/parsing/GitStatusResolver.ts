/**
 * GitStatusResolver - Resolves real git working-tree status for files.
 *
 * Uses the system `git` binary (via child_process.execFile, no shell) so the
 * reported status matches what `git status` shows: committed (clean), modified,
 * staged, untracked, or none (not inside a git repository).
 *
 * The porcelain `-z` parser is a pure function and unit-tested separately.
 */

import { type GitFileStatus } from '@shared/types/api';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

export class GitStatusResolver {
  /**
   * Resolves git status for a list of absolute file paths.
   * Missing files, directories, and files outside any git repo resolve to 'none'.
   */
  async resolveStatuses(paths: string[]): Promise<Record<string, GitFileStatus>> {
    const result: Record<string, GitFileStatus> = {};
    const unique = [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))];
    if (unique.length === 0) return result;

    const byRepo = new Map<string, string[]>();
    const noRepo: string[] = [];

    for (const p of unique) {
      let isFile = false;
      try {
        const st = await fs.promises.stat(p);
        isFile = st.isFile();
      } catch {
        // Not resolvable — treat as no git status.
      }
      if (!isFile) {
        result[p] = 'none';
        continue;
      }
      const root = await findRepoRoot(p);
      if (root) {
        const arr = byRepo.get(root);
        if (arr) arr.push(p);
        else byRepo.set(root, [p]);
      } else {
        noRepo.push(p);
      }
    }

    for (const p of noRepo) result[p] = 'none';

    for (const [root, repoPaths] of byRepo) {
      const relPaths = repoPaths.map((p) => path.relative(root, p).split(path.sep).join('/'));
      const relToAbs = new Map(relPaths.map((rel, i) => [rel, repoPaths[i]]));

      let porcelain: Record<string, string> = {};
      try {
        const stdout = await execGit(root, [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--',
          ...relPaths,
        ]);
        porcelain = parsePorcelainZOutput(stdout);
      } catch {
        // git unavailable / repo broken — leave porcelain empty.
      }

      let tracked = new Set<string>();
      try {
        const stdout = await execGit(root, ['ls-files', '-z', '--', ...relPaths]);
        tracked = new Set(stdout.split('\0').filter(Boolean));
      } catch {
        // Leave tracked empty.
      }

      for (const rel of relPaths) {
        const abs = relToAbs.get(rel);
        if (!abs) continue;
        result[abs] = classifyStatus(porcelain[rel], tracked.has(rel));
      }
    }

    return result;
  }
}

async function execGit(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: 'utf-8',
  });
  return stdout;
}

async function findRepoRoot(filePath: string): Promise<string | null> {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    try {
      const st = await fs.promises.stat(path.join(current, '.git'));
      if (st.isDirectory() || st.isFile()) return current;
    } catch {
      // Not a repo — keep walking up.
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Parses `git status --porcelain=v1 -z` output into a map of repo-relative
 * path → two-char status code. Handles rename/copy entries, whose destination
 * path is emitted as a separate NUL-terminated field.
 */
export function parsePorcelainZOutput(buf: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = buf.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const code = part.slice(0, 2);
    const entryPath = part.slice(3);
    if (!entryPath) continue;
    if ((code.startsWith('R') || code.startsWith('C')) && i + 1 < parts.length) {
      const dest = parts[i + 1];
      if (dest) result[dest] = code;
      i++; // consume the destination field
    } else {
      result[entryPath] = code;
    }
  }
  return result;
}

function classifyStatus(code: string | undefined, isTracked: boolean): GitFileStatus {
  if (code) {
    if (code === '??') return 'untracked';
    const index = code[0];
    const worktree = code[1];
    if (index !== ' ' && index !== '?' && worktree === ' ') return 'staged';
    return 'modified';
  }
  return isTracked ? 'committed' : 'untracked';
}

// Export singleton instance
export const gitStatusResolver = new GitStatusResolver();
