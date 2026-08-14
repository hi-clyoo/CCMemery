import { LinkIndexer } from '@main/services/discovery/LinkIndexer';
import { MemoryReader } from '@main/services/discovery/MemoryReader';
import { LocalFileSystemProvider } from '@main/services/infrastructure/LocalFileSystemProvider';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Keep the test hermetic: LinkIndexer reads ~/.claude/CLAUDE.md via homedir().
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => '/nonexistent-home-for-test' };
});

const PROJECT_ID = '-tmp-linkindexer-test';

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('LinkIndexer.buildIndex', () => {
  it('indexes .md files linked from CLAUDE.md, excluding memory-directory targets', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-linkindexer-'));
    tempDirs.push(root);
    const projectsDir = path.join(root, 'projects');
    const projectPath = path.join(root, 'proj');
    const memoryDir = path.join(projectsDir, PROJECT_ID, 'memory');

    // CLAUDE.md links to a real docs file and to a memory file (the latter must be excluded).
    write(
      path.join(projectPath, 'CLAUDE.md'),
      [
        '# Proj',
        'See [guide](docs/guide.md) for details.',
        'Also [role](../projects/-tmp-linkindexer-test/memory/user_role.md).',
      ].join('\n')
    );
    write(path.join(projectPath, 'docs', 'guide.md'), '# Guide');
    write(path.join(projectPath, '.claude', 'CLAUDE.md'), 'Broken link to [x](docs/missing.md).');
    write(
      path.join(memoryDir, 'MEMORY.md'),
      '# Memory index\n\n- [Role](user_role.md) — the role layer\n'
    );
    write(path.join(memoryDir, 'user_role.md'), '# Role\n');

    const indexer = new LinkIndexer(new MemoryReader(projectsDir, new LocalFileSystemProvider()));
    const files = await indexer.buildIndex(PROJECT_ID, projectPath);

    expect(files).toHaveLength(1);
    const guide = files[0];
    expect(guide.path).toBe(path.join(projectPath, 'docs', 'guide.md'));
    expect(guide.fileName).toBe('guide.md');
    expect(guide.dir).toBe(path.join(projectPath, 'docs'));
    expect(guide.sources).toHaveLength(1);
    expect(guide.sources[0].path).toBe(path.join(projectPath, 'CLAUDE.md'));
    expect(guide.sources[0].fileName).toBe('CLAUDE.md');
    expect(guide.sources[0].line).toBe(2);
  });

  it('returns an empty array when there are no links', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-linkindexer-'));
    tempDirs.push(root);
    const projectsDir = path.join(root, 'projects');
    const projectPath = path.join(root, 'proj');
    write(path.join(projectPath, 'CLAUDE.md'), '# No links here');

    const indexer = new LinkIndexer(new MemoryReader(projectsDir, new LocalFileSystemProvider()));
    const files = await indexer.buildIndex(PROJECT_ID, projectPath);
    expect(files).toEqual([]);
  });

  it('deduplicates the same source file referencing a target multiple times', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-linkindexer-'));
    tempDirs.push(root);
    const projectsDir = path.join(root, 'projects');
    const projectPath = path.join(root, 'proj');
    write(
      path.join(projectPath, 'CLAUDE.md'),
      '[a](guide.md) and again [b](guide.md) and [c](other.md)'
    );
    write(path.join(projectPath, 'guide.md'), 'g');
    write(path.join(projectPath, 'other.md'), 'o');

    const indexer = new LinkIndexer(new MemoryReader(projectsDir, new LocalFileSystemProvider()));
    const files = await indexer.buildIndex(PROJECT_ID, projectPath);

    expect(files).toHaveLength(2);
    const guide = files.find((f) => f.fileName === 'guide.md')!;
    expect(guide.sources).toHaveLength(1);
  });

  it('indexes files referenced via bare paths, backticks and remote URLs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-linkindexer-'));
    tempDirs.push(root);
    const projectsDir = path.join(root, 'projects');
    const projectPath = path.join(root, 'proj');
    write(
      path.join(projectPath, 'CLAUDE.md'),
      [
        '# Proj',
        '规则文档：docs/guide.md',
        '本地：`docs/guide.md`',
        'Gitee：https://gitee.com/org/proj/blob/main/docs/guide.md',
        '无关：`/nonexistent/abs/other.md`',
      ].join('\n')
    );
    // Make projectPath a git repo so the remote URL resolves against the repo root.
    execFileSync('git', ['init', '-q'], { cwd: projectPath });
    write(path.join(projectPath, 'docs', 'guide.md'), 'guide');

    const indexer = new LinkIndexer(new MemoryReader(projectsDir, new LocalFileSystemProvider()));
    const files = await indexer.buildIndex(PROJECT_ID, projectPath);

    // All three real forms reference the same file → a single indexed entry.
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(path.join(projectPath, 'docs', 'guide.md'));
    expect(files[0].sources).toHaveLength(1);
    expect(files[0].sources[0].path).toBe(path.join(projectPath, 'CLAUDE.md'));
  });
});
