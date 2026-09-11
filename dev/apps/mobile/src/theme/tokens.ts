import {
  CONTROL_HEIGHT_MD,
  CONTROL_WIDTH_CHROME,
  MAX_WIDTH_CONTENT,
  MAX_WIDTH_VAULT_LIST,
  MODAL_MAX_HEIGHT_RATIO,
  MODAL_WIZARD_BODY_MAX_HEIGHT_RATIO,
  RADII,
  SPACING,
  TOUCH_MIN,
  hexWithAlpha,
  mixHex,
  colorsForTheme,
  type ThemePalette,
  type UiTheme,
} from "@upriv/shared";

/**
 * Platform helpers on top of `@upriv/shared` `domain/theme`.
 * Use `colorsForTheme()` / `useTheme()` — do not hardcode a single theme in screens.
 */
export type ThemeColors = ThemePalette;

export {
  CONTROL_HEIGHT_MD,
  CONTROL_WIDTH_CHROME,
  MAX_WIDTH_CONTENT,
  MAX_WIDTH_VAULT_LIST,
  MODAL_MAX_HEIGHT_RATIO,
  MODAL_WIZARD_BODY_MAX_HEIGHT_RATIO,
  colorsForTheme,
  hexWithAlpha,
  mixHex,
};

export const spacing = SPACING;
export const radii = RADII;
export const touchMin = TOUCH_MIN;

/** `accent/40`-style overlays from a hex token — result is `#RRGGBBAA`. */
export function colorAlpha(hex: string, alpha: number): string {
  return hexWithAlpha(hex, alpha);
}

/**
 * Desktop `settingsControlClass`: `ring-0` idle, `focus:ring-2 focus:ring-accent/40`.
 * Idle border matches the fill so the 2px slot does not show a hairline or jump on focus.
 */
export function controlFocusRing(accent: string, fill: string, focused: boolean) {
  return {
    borderWidth: 2 as const,
    borderColor: focused ? hexWithAlpha(accent, 0.4) : fill,
  };
}

export function typographyForColors(c: ThemeColors) {
  return {
    title: { fontSize: 22, fontWeight: "600" as const, color: c.onSurface, letterSpacing: 0.4 },
    headline: { fontSize: 18, fontWeight: "600" as const, color: c.onSurface },
    body: { fontSize: 15, fontWeight: "400" as const, color: c.onSurface },
    bodyMuted: { fontSize: 14, fontWeight: "400" as const, color: c.onSurfaceVariant },
    caption: { fontSize: 12, fontWeight: "400" as const, color: c.onSurfaceVariant },
    mono: { fontSize: 12, fontFamily: "monospace" as const, color: c.onSurfaceVariant },
  };
}

/**
 * RN elevation objects for heavy surfaces (vault rows, dialogs).
 * Settings accordion cards use `settingsSectionBoxShadow(theme)` (CSS `boxShadow`,
 * New Architecture) — same soft shape as desktop, slightly stronger on mobile only.
 */
export const vaultRowShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.32,
  shadowRadius: 18,
  elevation: 5,
} as const;

/** Dialog panel elevation. Same caveat as `vaultRowShadow`. */
export const modalShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.22,
  shadowRadius: 16,
  elevation: 8,
} as const;

/**
 * Mobile settings/help section cards only. Keeps desktop `0 6px 12px -8px` geometry;
 * opacity is bumped vs shared `settingsSectionShadow` so cards read clearer on phone.
 */
export function settingsSectionBoxShadow(theme: UiTheme): string {
  if (theme === "light") {
    return `0 6px 12px -8px ${hexWithAlpha("#243048", 0.18)}`;
  }
  if (theme === "neutral") {
    return `0 6px 12px -8px ${hexWithAlpha("#000000", 0.32)}`;
  }
  return `0 6px 12px -8px ${hexWithAlpha("#000000", 0.38)}`;
}
