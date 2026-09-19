import { describe, expect, it } from "vitest";
import { pointInHitRect, smallestContainingKey } from "../hitRect";

describe("hitRect", () => {
  it("accepts a point on the inclusive edge", () => {
    expect(pointInHitRect(10, 10, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(pointInHitRect(11, 10, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it("picks the smallest containing rect", () => {
    const rects: Array<[string, { x: number; y: number; w: number; h: number }]> = [
      ["outer", { x: 0, y: 0, w: 100, h: 100 }],
      ["inner", { x: 10, y: 10, w: 20, h: 20 }],
    ];
    expect(smallestContainingKey(rects, 15, 15)).toBe("inner");
    expect(smallestContainingKey(rects, 80, 80)).toBe("outer");
    expect(smallestContainingKey(rects, 15, 15, (key) => key === "inner")).toBe("outer");
  });
});
