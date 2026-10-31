import { describe, expect, it } from "vitest";
import {
  EDITOR_BLOCK_LINES,
  editorBlocks,
  gutterLabels,
  lineFirstRows,
  rowStartsByLine,
  SINGLE_ROW,
} from "../editorRows";
import { lineStartOffsets } from "../fileSearch";

describe("editorBlocks", () => {
  const blocksOf = (text: string) => editorBlocks(text, lineStartOffsets(text));

  it("gives a short text one block", () => {
    expect(blocksOf("a\nb")).toEqual([{ firstLine: 0, lineCount: 2, start: 0, text: "a\nb" }]);
  });

  it("gives an empty text one empty block", () => {
    expect(blocksOf("")).toEqual([{ firstLine: 0, lineCount: 1, start: 0, text: "" }]);
  });

  it("splits lines into blocks that join back into the text", () => {
    const lines = Array.from({ length: EDITOR_BLOCK_LINES * 2 + 3 }, (_, line) => `line ${line}`);
    const text = lines.join("\n");
    const blocks = blocksOf(text);
    expect(blocks.map((block) => block.lineCount)).toEqual([
      EDITOR_BLOCK_LINES,
      EDITOR_BLOCK_LINES,
      3,
    ]);
    expect(blocks.map((block) => block.firstLine)).toEqual([
      0,
      EDITOR_BLOCK_LINES,
      EDITOR_BLOCK_LINES * 2,
    ]);
    expect(blocks.map((block) => block.text).join("\n")).toBe(text);
    for (const block of blocks) expect(text.startsWith(block.text, block.start)).toBe(true);
  });

  it("keeps the empty line after a final break", () => {
    const text = `${"x\n".repeat(EDITOR_BLOCK_LINES - 1)}x\n`;
    const blocks = blocksOf(text);
    expect(blocks.map((block) => block.lineCount)).toEqual([EDITOR_BLOCK_LINES, 1]);
    expect(blocks[1].text).toBe("");
    expect(blocks.map((block) => block.text).join("\n")).toBe(text);
  });
});

describe("rowStartsByLine", () => {
  it("gives each line the column of every row it wraps to", () => {
    // "abcdef" wraps after four columns; "xy" fits.
    expect(rowStartsByLine(["abcd", "ef\n", "xy"], 2)).toEqual([[0, 4], [0]]);
  });

  it("gives an empty line one row", () => {
    expect(rowStartsByLine(["a\n", "\n", "b"], 3)).toEqual([[0], [0], [0]]);
  });

  it("gives the empty line after a final break a row when the layout reports none", () => {
    expect(rowStartsByLine(["a\n"], 2)).toEqual([[0], [0]]);
    expect(rowStartsByLine(["a\n", ""], 2)).toEqual([[0], [0]]);
  });

  it("refuses a layout of a different number of lines", () => {
    expect(rowStartsByLine(["a\n", "b"], 3)).toBeNull();
  });
});

describe("lineFirstRows", () => {
  it("counts every row above each line and ends with the total", () => {
    expect(lineFirstRows([[0, 4, 8], SINGLE_ROW, [0, 5]])).toEqual([0, 3, 4, 6]);
    expect(lineFirstRows([])).toEqual([0]);
  });
});

describe("gutterLabels", () => {
  it("puts each number on its line's first row and leaves wrapped rows blank", () => {
    expect(gutterLabels([[0, 4], SINGLE_ROW, [0, 2, 4]])).toBe("1\n\n2\n3\n\n");
  });
});
