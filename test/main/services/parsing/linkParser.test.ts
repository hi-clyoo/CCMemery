import { parseMdFileReferences } from '@main/services/parsing/LinkParser';
import { describe, expect, it } from 'vitest';

describe('parseMdFileReferences', () => {
  it('extracts a standard markdown link with its line number', () => {
    expect(parseMdFileReferences('See [guide](docs/guide.md) for details.')).toEqual([
      { raw: 'docs/guide.md', line: 1, kind: 'markdown' },
    ]);
  });

  it('extracts multiple links on the same line', () => {
    expect(parseMdFileReferences('[a](a.md) and [b](b.md)')).toEqual([
      { raw: 'a.md', line: 1, kind: 'markdown' },
      { raw: 'b.md', line: 1, kind: 'markdown' },
    ]);
  });

  it('drops #fragments and optional link titles', () => {
    expect(parseMdFileReferences('[x](foo.md#section) [y](bar.md "title")')).toEqual([
      { raw: 'foo.md', line: 1, kind: 'markdown' },
      { raw: 'bar.md', line: 1, kind: 'markdown' },
    ]);
  });

  it('extracts backtick-quoted paths (absolute and relative)', () => {
    expect(
      parseMdFileReferences('本地：`/Users/clyoo/meetme/docs/card-image-rules.md`，规则：`docs/rules.md`')
    ).toEqual([
      { raw: '/Users/clyoo/meetme/docs/card-image-rules.md', line: 1, kind: 'code' },
      { raw: 'docs/rules.md', line: 1, kind: 'code' },
    ]);
  });

  it('extracts a bare .md path written in prose', () => {
    expect(parseMdFileReferences('规则文档：docs/card-image-rules.md。')).toEqual([
      { raw: 'docs/card-image-rules.md', line: 1, kind: 'bare' },
    ]);
  });

  it('extracts remote URLs ending in .md', () => {
    expect(
      parseMdFileReferences('Gitee：https://gitee.com/clyoo/meetme/blob/main/docs/card-image-rules.md')
    ).toEqual([
      { raw: 'https://gitee.com/clyoo/meetme/blob/main/docs/card-image-rules.md', line: 1, kind: 'url' },
    ]);
  });

  it('does not double-report a markdown-link target as a bare path', () => {
    const refs = parseMdFileReferences('[x](a.md) b.md c.md');
    expect(refs).toEqual([
      { raw: 'a.md', line: 1, kind: 'markdown' },
      { raw: 'b.md', line: 1, kind: 'bare' },
      { raw: 'c.md', line: 1, kind: 'bare' },
    ]);
  });

  it('ignores non-.md targets and bare URLs', () => {
    expect(parseMdFileReferences('[a](x.js) https://example.com/page plain .md')).toEqual([]);
  });

  it('reports correct line numbers across multiple lines', () => {
    const md = 'line one\nline [two](a.md) here\n`b.md`\n三行 docs/c.md';
    expect(parseMdFileReferences(md)).toEqual([
      { raw: 'a.md', line: 2, kind: 'markdown' },
      { raw: 'b.md', line: 3, kind: 'code' },
      { raw: 'docs/c.md', line: 4, kind: 'bare' },
    ]);
  });

  it('returns an empty array when there are no references', () => {
    expect(parseMdFileReferences('plain text with no links')).toEqual([]);
  });
});
