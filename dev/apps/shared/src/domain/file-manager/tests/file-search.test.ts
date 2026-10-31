import { describe, expect, it } from "vitest";
import {
  findTextMatches,
  lineStartOffsets,
  matchesBySpan,
  spanAt,
  stepMatchIndex,
} from "../fileSearch";

describe("lineStartOffsets and spanAt", () => {
  it("starts a line after every break, including a final one", () => {
    expect(lineStartOffsets("")).toEqual([0]);
    expect(lineStartOffsets("ab\n\ncd\n")).toEqual([0, 3, 4, 7]);
  });

  it("finds the span holding an offset, a break belonging to the line it ends", () => {
    const starts = lineStartOffsets("ab\n\ncd\n");
    expect(spanAt(starts, 0)).toBe(0);
    expect(spanAt(starts, 2)).toBe(0);
    expect(spanAt(starts, 3)).toBe(1);
    expect(spanAt(starts, 5)).toBe(2);
    expect(spanAt(starts, 7)).toBe(3);
    expect(spanAt(starts, 99)).toBe(3);
  });
});

describe("matchesBySpan", () => {
  it("groups matches by span with offsets inside it and keeps their file-wide number", () => {
    const text = "cat\ndog cat\ncat";
    const starts = lineStartOffsets(text);
    const bySpan = matchesBySpan(starts, findTextMatches(text, "cat"));
    expect([...bySpan.entries()]).toEqual([
      [0, [{ start: 0, end: 3, index: 0 }]],
      [1, [{ start: 4, end: 7, index: 1 }]],
      [2, [{ start: 0, end: 3, index: 2 }]],
    ]);
  });

  it("leaves a span without matches out", () => {
    const text = "a\nb\na";
    const bySpan = matchesBySpan([0, 4], findTextMatches(text, "a"));
    expect([...bySpan.keys()]).toEqual([0, 1]);
    expect(bySpan.get(1)).toEqual([{ start: 0, end: 1, index: 1 }]);
  });
});

describe("findTextMatches", () => {
  it("returns empty array for empty query or empty text", () => {
    expect(findTextMatches("", "hello")).toEqual([]);
    expect(findTextMatches("hello world", "")).toEqual([]);
    expect(findTextMatches("hello world", "   ")).toEqual([]);
  });

  it("finds case-insensitive occurrences", () => {
    const text = "Hello world, HELLO universe, hello again";
    const matches = findTextMatches(text, "hello");
    expect(matches).toEqual([
      { start: 0, end: 5 },
      { start: 13, end: 18 },
      { start: 29, end: 34 },
    ]);
  });

  it("keeps offsets in the original text when lowercasing would change its length", () => {
    // "İ".toLowerCase() is two code units; offsets must still point into the original.
    const text = "İstanbul ist";
    expect(findTextMatches(text, "IST")).toEqual([{ start: 9, end: 12 }]);
  });

  it("matches regular expression characters literally", () => {
    expect(findTextMatches("a.b axb (c)", ".")).toEqual([{ start: 1, end: 2 }]);
    expect(findTextMatches("a.b axb (c)", "(c)")).toEqual([{ start: 8, end: 11 }]);
  });

  it("handles non-overlapping matches", () => {
    const text = "aaaa";
    const matches = findTextMatches(text, "aa");
    expect(matches).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe("stepMatchIndex", () => {
  it("wraps forward and backward correctly", () => {
    expect(stepMatchIndex(0, 3, 1)).toBe(1);
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
    expect(stepMatchIndex(1, 3, -1)).toBe(0);
  });

  it("returns 0 when total is 0", () => {
    expect(stepMatchIndex(0, 0, 1)).toBe(0);
    expect(stepMatchIndex(5, 0, -1)).toBe(0);
  });
});
