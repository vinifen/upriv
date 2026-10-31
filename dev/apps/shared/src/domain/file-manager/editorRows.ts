/**
 * Wrapped rows of a code view, by line: the column where each of a line's rows
 * starts. A line that fits on one row is `[0]`.
 */
export type LineRows = readonly (readonly number[])[];

/** Rows of a line that fits on one row, or whose layout is not known yet. */
export const SINGLE_ROW: readonly number[] = [0];

/** Lines laid out together in a code view's copy of its text. */
export const EDITOR_BLOCK_LINES = 64;

/** Neighbouring lines laid out as one piece of text. */
export interface EditorBlock {
  /** Index of the block's first line. */
  firstLine: number;
  lineCount: number;
  /** Offset of the block's first line. */
  start: number;
  /** The block's lines joined by "\n", without the break after the last one. */
  text: string;
}

/** `text` in blocks of {@link EDITOR_BLOCK_LINES} lines, given where each line starts. */
export function editorBlocks(text: string, lineStarts: readonly number[]): EditorBlock[] {
  const blocks: EditorBlock[] = [];
  for (let firstLine = 0; firstLine < lineStarts.length; firstLine += EDITOR_BLOCK_LINES) {
    const start = lineStarts[firstLine];
    const nextStart = lineStarts[firstLine + EDITOR_BLOCK_LINES];
    blocks.push({
      firstLine,
      lineCount: Math.min(EDITOR_BLOCK_LINES, lineStarts.length - firstLine),
      start,
      text: text.slice(start, nextStart === undefined ? undefined : nextStart - 1),
    });
  }
  return blocks;
}

/**
 * Rows by line, from the rows a text layout reports for lines joined by "\n".
 * Each row's text keeps the line break that ends it. Null when the rows do not
 * add up to `lineCount` lines (the layout was of other text).
 */
export function rowStartsByLine(rowTexts: readonly string[], lineCount: number): number[][] | null {
  const lines: number[][] = [[]];
  let column = 0;
  for (const row of rowTexts) {
    lines[lines.length - 1].push(column);
    if (row.endsWith("\n")) {
      lines.push([]);
      column = 0;
    } else {
      column += row.length;
    }
  }
  // The empty line after a final break may get no row of its own.
  const last = lines[lines.length - 1];
  if (last.length === 0) last.push(0);
  return lines.length === lineCount ? lines : null;
}

/** Row each line starts on, counting every row above it; the last entry is the total. */
export function lineFirstRows(lineRows: LineRows): number[] {
  const first = new Array<number>(lineRows.length + 1);
  first[0] = 0;
  lineRows.forEach((rows, line) => {
    first[line + 1] = first[line] + rows.length;
  });
  return first;
}

/** Line numbers on each line's first row, with a blank row beside every wrapped one. */
export function gutterLabels(lineRows: LineRows): string {
  const labels: string[] = [];
  lineRows.forEach((rows, line) => {
    labels.push(String(line + 1));
    for (let row = 1; row < rows.length; row += 1) labels.push("");
  });
  return labels.join("\n");
}
