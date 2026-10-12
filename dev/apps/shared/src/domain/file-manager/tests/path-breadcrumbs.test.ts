import { describe, expect, it } from "vitest";
import { breadcrumbShrink, pathBreadcrumbs } from "../pathBreadcrumbs";

describe("pathBreadcrumbs", () => {
  it("starts with the vault name and follows the path from the vault root", () => {
    expect(pathBreadcrumbs("Personal", "/notes/bank/pins.md")).toEqual([
      "Personal",
      "notes",
      "bank",
      "pins.md",
    ]);
    expect(pathBreadcrumbs("Personal", "/todo.md")).toEqual(["Personal", "todo.md"]);
  });
});

describe("breadcrumbShrink", () => {
  it("shrinks earlier crumbs first and the file name last", () => {
    const weights = [0, 1, 2, 3].map((index) => breadcrumbShrink(index, 4));
    expect(weights[3]).toBe(1);
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i - 1]).toBeGreaterThan(weights[i]!);
    }
  });

  it("stays finite on deep paths", () => {
    expect(Number.isFinite(breadcrumbShrink(0, 500))).toBe(true);
  });
});
