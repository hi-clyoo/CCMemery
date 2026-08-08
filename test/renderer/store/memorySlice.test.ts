import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryMock = {
  hasMemory: vi.fn(),
  getIndex: vi.fn(),
  readFile: vi.fn(),
  listAvailableOpeners: vi.fn(),
  openIn: vi.fn(),
  copyPath: vi.fn(),
  onChanged: vi.fn(),
};

vi.mock('@renderer/api', () => ({
  api: { memory: memoryMock },
  isElectronMode: () => true,
}));

describe('memorySlice', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loadMemoryForProject populates hasMemory + index when memory exists', async () => {
    const { createTestStore } = await import('./storeTestUtils');
    memoryMock.hasMemory.mockResolvedValue(true);
    memoryMock.getIndex.mockResolvedValue({
      rawMarkdown: '# Memory index',
      entries: [{ title: 'A', file: 'a.md', hook: 'hook', lineNumber: 1 }],
      orphanFiles: [],
    });

    const store = createTestStore();
    await store.getState().loadMemoryForProject('-proj');

    const state = store.getState();
    expect(state.hasMemoryByProjectId['-proj']).toBe(true);
    expect(state.indexByProjectId['-proj']?.entries).toHaveLength(1);
    expect(state.memoryLoadingByProjectId['-proj']).toBe(false);
  });

  it('loadMemoryForProject sets hasMemory=false without calling getIndex when absent', async () => {
    const { createTestStore } = await import('./storeTestUtils');
    memoryMock.hasMemory.mockResolvedValue(false);

    const store = createTestStore();
    await store.getState().loadMemoryForProject('-proj');

    expect(memoryMock.getIndex).not.toHaveBeenCalled();
    expect(store.getState().hasMemoryByProjectId['-proj']).toBe(false);
    expect(store.getState().indexByProjectId['-proj']).toBeNull();
  });

  it('toggleMemoryEntry expands + lazy-loads content, then collapses on second call', async () => {
    const { createTestStore } = await import('./storeTestUtils');
    memoryMock.readFile.mockResolvedValue({
      success: true,
      content: '# A\nbody',
      path: '/abs/a.md',
    });

    const store = createTestStore();
    await store.getState().toggleMemoryEntry('-proj', 'a.md');

    let state = store.getState();
    expect(state.expandedEntriesByProjectId['-proj']).toEqual(['a.md']);
    expect(state.fileContents['-proj::a.md']).toContain('body');
    expect(memoryMock.readFile).toHaveBeenCalledTimes(1);

    // Second toggle collapses
    await store.getState().toggleMemoryEntry('-proj', 'a.md');
    state = store.getState();
    expect(state.expandedEntriesByProjectId['-proj']).toEqual([]);

    // Expand again — content cached, no second readFile call
    await store.getState().toggleMemoryEntry('-proj', 'a.md');
    expect(memoryMock.readFile).toHaveBeenCalledTimes(1);
  });

  it('toggleMemoryEntry stores an error placeholder on read failure', async () => {
    const { createTestStore } = await import('./storeTestUtils');
    memoryMock.readFile.mockResolvedValue({ success: false, error: 'no such file' });

    const store = createTestStore();
    await store.getState().toggleMemoryEntry('-proj', 'missing.md');

    expect(store.getState().fileContents['-proj::missing.md']).toContain('no such file');
  });

  it('refreshMemoryForProject invalidates cached file contents for that project', async () => {
    const { createTestStore } = await import('./storeTestUtils');
    memoryMock.hasMemory.mockResolvedValue(true);
    memoryMock.getIndex.mockResolvedValue({
      rawMarkdown: '',
      entries: [],
      orphanFiles: [],
    });

    const store = createTestStore();
    store.setState({
      fileContents: {
        '-proj::a.md': 'cached',
        '-other::b.md': 'keep',
      },
    });

    await store.getState().refreshMemoryForProject('-proj');

    const contents = store.getState().fileContents;
    expect(contents['-proj::a.md']).toBeUndefined();
    expect(contents['-other::b.md']).toBe('keep');
  });
});
