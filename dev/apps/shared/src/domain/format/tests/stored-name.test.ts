import { describe, expect, it } from "vitest";
import { normalizeStoredName } from "..";

describe("normalizeStoredName", () => {
  it("trims and collapses internal whitespace to one space", () => {
    expect(
      normalizeStoredName(
        "  TEST                   ASDF        ASD   ASD    ---ASDF89AHDUF __--=+==---  ",
      ),
    ).toBe("TEST ASDF ASD ASD ---ASDF89AHDUF __--=+==---");
    expect(normalizeStoredName("a\t\tb\nc")).toBe("a b c");
    expect(normalizeStoredName("   ")).toBe("");
    expect(normalizeStoredName("Notes")).toBe("Notes");
  });
});
