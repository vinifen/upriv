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

/** A match inside one piece of text, numbered among all matches of the file. */
export interface IndexedMatch extends TextMatch {
  index: number;
}

/** Start offset of every line of `text` (the first is 0). */
export function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/**
 * Span holding `offset`, given the ascending start of each span (the first is
 * 0): the line for {@link lineStartOffsets}, a block of lines, or a wrapped row.
 */
export function spanAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * `matches` grouped by the span (a run of whole lines) holding them, with
 * offsets inside that span, for an editor that draws its highlights a span at
 * a time. A query never holds a line break, so no match crosses one.
 */
export function matchesBySpan(
  spanStarts: readonly number[],
  matches: readonly TextMatch[],
): Map<number, IndexedMatch[]> {
  const bySpan = new Map<number, IndexedMatch[]>();
  matches.forEach((match, index) => {
    const span = spanAt(spanStarts, match.start);
    const start = spanStarts[span];
    const local = { start: match.start - start, end: match.end - start, index };
    const list = bySpan.get(span);
    if (list) list.push(local);
    else bySpan.set(span, [local]);
  });
  return bySpan;
}

/** Given a match index and total matches, wraps around smoothly. */
export function stepMatchIndex(current: number, total: number, step: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + step + total) % total;
}
