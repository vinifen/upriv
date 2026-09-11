import { describe, expect, it } from "vitest";
import type { UiTheme } from "../../app-settings/types";
import { THEME_PALETTES, colorsForTheme } from "../palettes";
import {
  RADII,
  CONTROL_HEIGHT_MD,
  CONTROL_WIDTH_CHROME,
  MAX_WIDTH_CONTENT,
  MAX_WIDTH_VAULT_LIST,
} from "../tokens";
import { THEME_CSS_VAR_NAMES, cssCustomProperties } from "../cssVars";

const THEMES: UiTheme[] = ["dark", "neutral", "light"];

describe("cssCustomProperties", () => {
  it.each(THEMES)("%s maps every palette field and radii", (theme) => {
    const vars = cssCustomProperties(theme);
    const palette = colorsForTheme(theme);

    expect(vars["--radius-xs"]).toBe(`${RADII.xs}px`);
    expect(vars["--radius-sm"]).toBe(`${RADII.sm}px`);
    expect(vars["--radius-md"]).toBe(`${RADII.md}px`);
    expect(vars["--radius-lg"]).toBe(`${RADII.lg}px`);
    expect(vars["--radius-full"]).toBe(`${RADII.full}px`);
    expect(vars["--control-height-md"]).toBe(`${CONTROL_HEIGHT_MD}px`);
    expect(vars["--control-width-chrome"]).toBe(`${CONTROL_WIDTH_CHROME}px`);
    expect(vars["--max-width-content"]).toBe(`${MAX_WIDTH_CONTENT}px`);
    expect(vars["--max-width-vault-list"]).toBe(`${MAX_WIDTH_VAULT_LIST}px`);

    for (const [field, cssName] of Object.entries(THEME_CSS_VAR_NAMES)) {
      expect(vars[cssName]).toBe(palette[field as keyof typeof palette]);
    }
  });

  it("keeps the three palettes distinct", () => {
    expect(THEME_PALETTES.dark.background).toBe("#081425");
    expect(THEME_PALETTES.neutral.background).toBe("#282f3e");
    expect(THEME_PALETTES.light.background).toBe("#d6dde8");
  });

  it("stores translucent colors as 8-digit hex, not rgba()", () => {
    for (const theme of THEMES) {
      for (const value of Object.values(THEME_PALETTES[theme])) {
        expect(value).not.toMatch(/rgba?\(/i);
      }
    }
  });
});
