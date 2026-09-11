import { describe, expect, it } from "vitest";
import { ICON_GLYPHS } from "../glyphs";
import { ICON_NAMES } from "../names";

describe("ICON_GLYPHS", () => {
  it("covers every catalog name with at least one shape", () => {
    expect(Object.keys(ICON_GLYPHS).sort()).toEqual([...ICON_NAMES].sort());
    for (const name of ICON_NAMES) {
      expect(ICON_GLYPHS[name].length).toBeGreaterThan(0);
    }
  });

  it("settings cog keeps the top tooth arc sweep (0 0 0-1), not a typo 0 0 0 1", () => {
    const path = ICON_GLYPHS.settings.find((s) => s.kind === "path");
    expect(path?.kind).toBe("path");
    if (path?.kind !== "path") return;
    expect(path.d).toContain("0 0 0-1 1.51V21");
    expect(path.d).not.toContain("0 0 0 1 1.51V21");
  });
});
