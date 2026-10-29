export interface TextMatch {
  start: number;
  end: number;
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Case-insensitive find of all non-overlapping occurrences of `query` in `text`.
 * Offsets index `text` itself: lowercasing first would shift them after a
 * character whose lowercase is longer (`İ` → `i̇`).
 */
export function findTextMatches(text: string, query: string): TextMatch[] {
  const trimmed = query.trim();
  if (!trimmed || !text) return [];
  const pattern = new RegExp(trimmed.replace(REGEXP_SPECIAL, "\\$&"), "giu");
  const matches: TextMatch[] = [];
  for (const found of text.matchAll(pattern)) {
    matches.push({ start: found.index, end: found.index + found[0].length });
  }
  return matches;
}

/** Given a match index and total matches, wraps around smoothly. */
export function stepMatchIndex(current: number, total: number, step: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + step + total) % total;
}
