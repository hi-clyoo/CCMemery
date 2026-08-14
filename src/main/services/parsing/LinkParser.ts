/**
 * LinkParser - Extracts `.md` file references from markdown.
 *
 * CLAUDE.md / memory content written by AI rarely uses only standard
 * `[label](target.md)` links. This parser recognizes four forms:
 *
 * - `markdown` — `[label](target.md)`
 * - `code`     — `` `path/to/file.md` `` (inline code; any `.md` token inside)
 * - `bare`     — `docs/file.md` written plainly in prose (relative or absolute)
 * - `url`      — `https://host/.../file.md` remote URLs
 *
 * A `bare` scan runs over each line with `markdown`/`code`/`url` spans masked
 * out, so the same occurrence is never reported twice. Downstream, LinkIndexer
 * drops references that don't resolve to an existing file, which absorbs any
 * residual false positives from prose.
 *
 * Bounded character classes (no unbounded `.*`/`+?` alternatives) whose
 * elements are mutually exclusive with their terminators keep matching linear.
 */
/* eslint-disable sonarjs/slow-regex -- bounded negated/literal classes, linear matching */
const MD_LINK_REGEX = /\[[^\]\n]*\]\(([^)\n#]+\.md)(?:[# ][^)\n]*)?\)/g;
const CODE_SPAN_REGEX = /`([^`\n]*\.md)`/g;
const URL_REGEX = /https?:\/\/[^\s"'<>()[\]]+\.md/g;
const BARE_REGEX = /(?<![\w/.:@~-])([A-Za-z0-9_~./\\-]+\.md)(?![\w./-])/g;
/* eslint-enable sonarjs/slow-regex -- end of bounded regex block */

export type MdReferenceKind = 'markdown' | 'code' | 'bare' | 'url';

export interface MdReference {
  /** Raw path or URL as written in the markdown */
  raw: string;
  /** 1-based line number of the reference */
  line: number;
  /** How the reference was written */
  kind: MdReferenceKind;
}

export function parseMdFileReferences(content: string): MdReference[] {
  const refs: MdReference[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const masked = line.split('');

    const mask = (start: number, end: number): void => {
      for (let i = start; i < end; i++) masked[i] = ' ';
    };

    for (const m of line.matchAll(MD_LINK_REGEX)) {
      const raw = m[1].trim();
      if (raw) refs.push({ raw, line: lineNo, kind: 'markdown' });
      mask(m.index ?? 0, (m.index ?? 0) + m[0].length);
    }

    for (const m of line.matchAll(CODE_SPAN_REGEX)) {
      const inner = m[1];
      for (const t of inner.matchAll(BARE_REGEX)) {
        const raw = t[1].trim();
        if (raw) refs.push({ raw, line: lineNo, kind: 'code' });
      }
      mask(m.index ?? 0, (m.index ?? 0) + m[0].length);
    }

    for (const m of line.matchAll(URL_REGEX)) {
      const raw = m[0].trim();
      if (raw) refs.push({ raw, line: lineNo, kind: 'url' });
      mask(m.index ?? 0, (m.index ?? 0) + m[0].length);
    }

    const maskedStr = masked.join('');
    for (const m of maskedStr.matchAll(BARE_REGEX)) {
      const raw = m[1].trim();
      if (raw) refs.push({ raw, line: lineNo, kind: 'bare' });
    }
  });
  return refs;
}
