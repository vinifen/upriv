import { describe, expect, it } from "vitest";
import { interpolate } from "../interpolate";

describe("interpolate", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    expect(interpolate("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
    expect(interpolate("{n} of {n}", { n: 2 })).toBe("2 of 2");
    expect(interpolate("left {missing}", { name: "x" })).toBe("left {missing}");
    expect(interpolate("plain")).toBe("plain");
  });
});
