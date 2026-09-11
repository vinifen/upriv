import { describe, expect, it } from "vitest";
import { hexWithAlpha, mixHex } from "../hex";

describe("hexWithAlpha", () => {
  it("appends an 8-digit alpha channel", () => {
    expect(hexWithAlpha("#3dd68c", 0.1)).toBe("#3dd68c1a");
    expect(hexWithAlpha("bec6e0", 1)).toBe("#bec6e0ff");
    expect(hexWithAlpha("#00000038", 0.22)).toBe("#00000038");
  });

  it("rejects non-hex strings", () => {
    expect(() => hexWithAlpha("rgba(0,0,0,0.2)", 0.5)).toThrow(/expected #RRGGBB/);
  });
});

describe("mixHex", () => {
  it("returns opaque #RRGGBB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#152031", "#93000a", 0)).toBe("#152031");
  });

  it("rejects rgba()", () => {
    expect(() => mixHex("rgba(0,0,0,1)", "#ff0000", 0.2)).toThrow(/expected #RRGGBB/);
  });
});
