import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  GitStatusResolver,
  parsePorcelainZOutput,
} from '@main/services/parsing/GitStatusResolver';
import { afterEach, describe, expect, it } from 'vitest';

describe('parsePorcelainZOutput', () => {
  it('parses untracked, modified and staged entries', () => {
    const buf = '?? new.md\0 M changed.md\0M  staged.md\0';
    expect(parsePorcelainZOutput(buf)).toEqual({
      'new.md': '??',
      'changed.md': ' M',
      'staged.md': 'M ',
    });
  });

  it('handles rename entries (separate destination field)', () => {
    const buf = 'R  old.md\0new.md\0';
    expect(parsePorcelainZOutput(buf)).toEqual({ 'new.md': 'R ' });
  });

  it('ignores empty parts and unpaired rename fields', () => {
    expect(parsePorcelainZOutput('?? a.md\0\0')).toEqual({ 'a.md': '??' });
    expect(parsePorcelainZOutput('')).toEqual({});
  });
});

describe('GitStatusResolver.resolveStatuses', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves committed / modified / untracked from a real git repository', async () => {
    let gitAvailable = false;
    try {
      execFileSync('git', ['--version'], { stdio: 'pipe' });
      gitAvailable = true;
    } catch {
      gitAvailable = false;
    }
    if (!gitAvailable) return;

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-git-status-'));
    tempDirs.push(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });

    const clean = path.join(repo, 'clean.md');
    const dirty = path.join(repo, 'dirty.md');
    fs.writeFileSync(clean, 'x');
    fs.writeFileSync(dirty, 'x');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

    fs.writeFileSync(dirty, 'changed');
    const untracked = path.join(repo, 'untracked.md');
    fs.writeFileSync(untracked, 'x');

    const status = await new GitStatusResolver().resolveStatuses([clean, dirty, untracked]);
    expect(status[clean]).toBe('committed');
    expect(status[dirty]).toBe('modified');
    expect(status[untracked]).toBe('untracked');
  });

  it('resolves missing files and non-repo files to none', async () => {
    const status = await new GitStatusResolver().resolveStatuses([
      '/nonexistent/path/file.md',
      '/nonexistent/path2/file.md',
    ]);
    expect(status['/nonexistent/path/file.md']).toBe('none');
    expect(status['/nonexistent/path2/file.md']).toBe('none');
  });
});
