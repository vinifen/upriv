import { describe, expect, it } from "vitest";
import { ICON_NAMES } from "../../icons";
import { SORT_DIRECTION_ICON, SORT_MODE_ICON, VIEW_MODE_ICON } from "../toolbarIcons";

describe("vault list toolbar icons", () => {
  it("only references names in the shared glyph catalog", () => {
    const catalog = new Set<string>(ICON_NAMES);
    for (const name of Object.values(SORT_MODE_ICON)) {
      expect(catalog.has(name)).toBe(true);
    }
    for (const name of Object.values(SORT_DIRECTION_ICON)) {
      expect(catalog.has(name)).toBe(true);
    }
    for (const name of Object.values(VIEW_MODE_ICON)) {
      expect(catalog.has(name)).toBe(true);
    }
  });
});
