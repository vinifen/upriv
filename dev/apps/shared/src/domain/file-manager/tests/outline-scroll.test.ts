import { describe, expect, it } from "vitest";
import { activeOutlineIndex } from "../outlineScroll";

const TOPS = [0, 400, 900, 1500];
const view = (offset: number) => ({ offset, viewport: 500, content: 2400 });

describe("activeOutlineIndex", () => {
  it("is the first heading near the top and with no headings", () => {
    expect(activeOutlineIndex(TOPS, view(0))).toBe(0);
    expect(activeOutlineIndex(TOPS, view(10))).toBe(0);
    expect(activeOutlineIndex([], view(800))).toBe(0);
  });

  it("is the last heading that reached the top edge", () => {
    expect(activeOutlineIndex(TOPS, view(300))).toBe(0);
    // 400 is within the 24 px lead of 380.
    expect(activeOutlineIndex(TOPS, view(380))).toBe(1);
    expect(activeOutlineIndex(TOPS, view(1000))).toBe(2);
  });

  it("is the last heading at the end, even before it reaches the top", () => {
    expect(activeOutlineIndex(TOPS, view(1890))).toBe(3);
  });

  it("skips headings that are not laid out yet", () => {
    expect(activeOutlineIndex([0, undefined, 900], view(1000))).toBe(2);
    expect(activeOutlineIndex([0, undefined, 900], view(500))).toBe(0);
  });
});
