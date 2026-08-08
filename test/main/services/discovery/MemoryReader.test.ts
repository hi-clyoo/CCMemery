import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryReader } from '../../../../src/main/services/discovery/MemoryReader';

const INDEX_MD = `# Memory index

- [Working style](working-style.md) — wants the "why" first
- [Architecture](architecture.md) — LLM-first
`;

describe('MemoryReader', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0;
  });

  function setupProject(memoryFiles: Record<string, string> = {}): {
    projectsDir: string;
    projectId: string;
    memoryDir: string;
  } {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-reader-'));
    tempDirs.push(projectsDir);
    const projectId = '-Users-test-proj';
    const memoryDir = path.join(projectsDir, projectId, 'memory');
    if (Object.keys(memoryFiles).length > 0) {
      fs.mkdirSync(memoryDir, { recursive: true });
      for (const [name, content] of Object.entries(memoryFiles)) {
        fs.writeFileSync(path.join(memoryDir, name), content, 'utf8');
      }
    }
    return { projectsDir, projectId, memoryDir };
  }

  it('hasMemory returns false when memory directory is missing', async () => {
    const { projectsDir, projectId } = setupProject();
    const reader = new MemoryReader(projectsDir);
    expect(await reader.hasMemory(projectId)).toBe(false);
  });

  it('hasMemory returns true when at least one .md file exists', async () => {
    const { projectsDir, projectId } = setupProject({ 'foo.md': '# hi' });
    const reader = new MemoryReader(projectsDir);
    expect(await reader.hasMemory(projectId)).toBe(true);
  });

  it('readIndex parses MEMORY.md and detects orphans', async () => {
    const { projectsDir, projectId } = setupProject({
      'MEMORY.md': INDEX_MD,
      'working-style.md': 'body',
      'architecture.md': 'body',
      'unlinked.md': 'body',
    });
    const reader = new MemoryReader(projectsDir);
    const index = await reader.readIndex(projectId);
    expect(index).not.toBeNull();
    expect(index!.entries).toHaveLength(2);
    expect(index!.orphanFiles).toEqual(['unlinked.md']);
  });

  it('readIndex returns empty index when MEMORY.md is missing but .md files exist', async () => {
    const { projectsDir, projectId } = setupProject({ 'stray.md': 'body' });
    const reader = new MemoryReader(projectsDir);
    const index = await reader.readIndex(projectId);
    expect(index).not.toBeNull();
    expect(index!.entries).toHaveLength(0);
    expect(index!.orphanFiles).toEqual(['stray.md']);
  });

  it('readIndex returns null when memory directory does not exist', async () => {
    const { projectsDir, projectId } = setupProject();
    const reader = new MemoryReader(projectsDir);
    expect(await reader.readIndex(projectId)).toBeNull();
  });

  it('readFile returns the file content', async () => {
    const { projectsDir, projectId } = setupProject({
      'working-style.md': '# Working style\nbody',
    });
    const reader = new MemoryReader(projectsDir);
    const file = await reader.readFile(projectId, 'working-style.md');
    expect(file.content).toContain('Working style');
    expect(file.fileName).toBe('working-style.md');
  });

  it('rejects path traversal in fileName', async () => {
    const { projectsDir, projectId } = setupProject({ 'safe.md': 'body' });
    const reader = new MemoryReader(projectsDir);
    await expect(reader.readFile(projectId, '../../etc/passwd')).rejects.toThrow();
    await expect(reader.readFile(projectId, '../secret.md')).rejects.toThrow();
    await expect(reader.readFile(projectId, 'a/b.md')).rejects.toThrow();
  });

  it('rejects non-.md filenames', async () => {
    const { projectsDir, projectId } = setupProject({ 'safe.md': 'body' });
    const reader = new MemoryReader(projectsDir);
    await expect(reader.readFile(projectId, 'safe.txt')).rejects.toThrow();
  });
});
