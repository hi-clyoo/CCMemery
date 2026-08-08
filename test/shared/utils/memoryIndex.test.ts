import { describe, expect, it } from 'vitest';

import { parseMemoryIndex } from '@shared/utils/memoryIndex';

const CRAWLER_FIXTURE = `# Memory index

- [Working style](working-style.md) — wants the "why" first, pushes back on architecture, harness robustness is in-scope
- [Snapshot = full fetch outcome](snapshot-is-full-fetch-outcome.md) — prepare.py captures status/blocks/redirects/raw+rendered HTML/sitemap/XHR, not just clean DOM; generator graded on access-handling too
- [Architecture: LLM-first](architecture-llm-first.md) — one structured-output LLM call per site within 30-min budget; render via crawl4ai (pluggable); AxTree as primary input modality; Claude CLI ($0 via Max subscription) + OpenRouter adapters; SoM hook off by default
`;

describe('parseMemoryIndex', () => {
  it('parses the crawler fixture into 3 entries', () => {
    const result = parseMemoryIndex(CRAWLER_FIXTURE, [
      'MEMORY.md',
      'working-style.md',
      'snapshot-is-full-fetch-outcome.md',
      'architecture-llm-first.md',
    ]);

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toMatchObject({
      title: 'Working style',
      file: 'working-style.md',
      lineNumber: 3,
    });
    expect(result.entries[0].hook).toContain('wants the "why" first');
    expect(result.entries[2].title).toBe('Architecture: LLM-first');
    expect(result.orphanFiles).toEqual([]);
  });

  it('detects orphan .md files not referenced in the index', () => {
    const result = parseMemoryIndex(CRAWLER_FIXTURE, [
      'MEMORY.md',
      'working-style.md',
      'snapshot-is-full-fetch-outcome.md',
      'architecture-llm-first.md',
      'untracked.md',
      'another-stray.md',
    ]);

    expect(result.orphanFiles).toEqual(['another-stray.md', 'untracked.md']);
  });

  it('accepts plain ASCII dash and en-dash separators', () => {
    const md = `- [A](a.md) - ascii hook\n- [B](b.md) – en-dash hook\n- [C](c.md) — em-dash hook\n`;
    const result = parseMemoryIndex(md, ['a.md', 'b.md', 'c.md']);
    expect(result.entries.map((e) => e.hook)).toEqual([
      'ascii hook',
      'en-dash hook',
      'em-dash hook',
    ]);
  });

  it('tolerates entries with no hook', () => {
    const md = `- [Bare](bare.md)\n`;
    const result = parseMemoryIndex(md, ['bare.md']);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      title: 'Bare',
      file: 'bare.md',
      hook: '',
    });
  });

  it('ignores non-list lines so headers/preamble are preserved in rawMarkdown', () => {
    const md = `# Memory index\n\nSome preamble.\n\n- [Real](real.md) — hook\nrandom text\n`;
    const result = parseMemoryIndex(md, ['real.md']);
    expect(result.entries).toHaveLength(1);
    expect(result.rawMarkdown).toBe(md);
  });

  it('treats non-.md links as non-entries', () => {
    const md = `- [Site](https://example.com) — not a file\n- [Real](real.md) — hook\n`;
    const result = parseMemoryIndex(md, ['real.md']);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].file).toBe('real.md');
  });
});
