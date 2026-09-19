import type { UiTheme } from "../app-settings/types";
import { hexWithAlpha } from "./hex";

/**
 * Full visual palette (desktop CSS custom properties + mobile `ThemeColors`).
 * Hex strings (`#RRGGBB` or `#RRGGBBAA`) plus CSS `box-shadow` values that
 * embed hex (desktop only — RN uses elevation objects in mobile `theme/tokens.ts`).
 * No Tailwind, no React Native shadow objects.
 */
export type ThemePalette = {
  background: string;
  surfaceContainer: string;
  surfaceContainerLow: string;
  surfaceContainerHigh: string;
  surfaceRowHover: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outlineVariant: string;
  splitDivider: string;
  splitDividerOnPrimary: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  primary: string;
  onPrimary: string;
  accent: string;
  accentForeground: string;
  vaultStatusOpen: string;
  vaultStatusClosed: string;
  vaultStatusRecovery: string;
  vaultOpenBadgeBg: string;
  vaultOpenIconBg: string;
  vaultRecoveryBadgeBg: string;
  vaultRecoveryIconBg: string;
  vaultOpenGlow: string;
  editorGutterMuted: string;
  errorContainer: string;
  onErrorContainer: string;
  modalScrim: string;
  modalShadow: string;
  vaultRowShadow: string;
  /** Compact float for FM dock chips — soft all-around, a bit stronger than vault rows. */
  dockChipShadow: string;
  settingsSectionShadow: string;
  logViewerBg: string;
};

const DARK: ThemePalette = {
  background: "#081425",
  surfaceContainer: "#152031",
  surfaceContainerLow: "#0e1828",
  surfaceContainerHigh: "#1f2a3c",
  surfaceRowHover: "#1c2839",
  surfaceContainerHighest: "#2a3548",
  onSurface: "#d8e3fb",
  onSurfaceVariant: "#c6c6cd",
  outlineVariant: hexWithAlpha("#45464d", 0.6),
  splitDivider: hexWithAlpha("#909097", 0.38),
  splitDividerOnPrimary: hexWithAlpha("#283044", 0.32),
  scrollbarThumb: "#2a3548",
  scrollbarThumbHover: "#45464d",
  primary: "#bec6e0",
  onPrimary: "#283044",
  accent: "#6b8cff",
  accentForeground: "#0f172a",
  vaultStatusOpen: "#3dd68c",
  vaultStatusClosed: "#6b8cff",
  vaultStatusRecovery: "#f5a623",
  vaultOpenBadgeBg: hexWithAlpha("#3dd68c", 0.1),
  vaultOpenIconBg: hexWithAlpha("#3dd68c", 0.22),
  vaultRecoveryBadgeBg: hexWithAlpha("#f5a623", 0.12),
  vaultRecoveryIconBg: hexWithAlpha("#f5a623", 0.22),
  vaultOpenGlow: hexWithAlpha("#3dd68c", 0.45),
  editorGutterMuted: "#8b8b8b",
  errorContainer: "#93000a",
  onErrorContainer: "#ffdad6",
  modalScrim: hexWithAlpha("#081425", 0.8),
  modalShadow: `0 12px 32px ${hexWithAlpha("#000000", 0.22)}`,
  vaultRowShadow: `0 10px 14px -10px ${hexWithAlpha("#000000", 0.4)}`,
  dockChipShadow: `0 0 6px ${hexWithAlpha("#000000", 0.28)}, 0 5px 12px -4px ${hexWithAlpha("#000000", 0.48)}`,
  settingsSectionShadow: `0 6px 12px -8px ${hexWithAlpha("#000000", 0.22)}`,
  logViewerBg: "#0d1117",
};

const NEUTRAL: ThemePalette = {
  background: "#282f3e",
  surfaceContainer: "#353d4e",
  surfaceContainerLow: "#2e3544",
  surfaceContainerHigh: "#3f4756",
  surfaceRowHover: "#474f5e",
  surfaceContainerHighest: "#505864",
  onSurface: "#eaebee",
  onSurfaceVariant: "#a4acb8",
  outlineVariant: hexWithAlpha("#5c6474", 0.6),
  splitDivider: hexWithAlpha("#8c94a4", 0.44),
  splitDividerOnPrimary: hexWithAlpha("#202632", 0.38),
  scrollbarThumb: "#525a68",
  scrollbarThumbHover: "#656d7a",
  primary: "#c4cad4",
  onPrimary: "#252b38",
  accent: "#6888dc",
  accentForeground: "#0f172a",
  vaultStatusOpen: "#42de9a",
  vaultStatusClosed: "#6888dc",
  vaultStatusRecovery: "#f0b84a",
  vaultOpenBadgeBg: hexWithAlpha("#42de9a", 0.18),
  vaultOpenIconBg: hexWithAlpha("#42de9a", 0.24),
  vaultRecoveryBadgeBg: hexWithAlpha("#f0b84a", 0.2),
  vaultRecoveryIconBg: hexWithAlpha("#f0b84a", 0.24),
  vaultOpenGlow: hexWithAlpha("#42de9a", 0.44),
  editorGutterMuted: "#9aa3b0",
  errorContainer: "#a82028",
  onErrorContainer: "#ffe8e4",
  modalScrim: hexWithAlpha("#202632", 0.74),
  modalShadow: `0 12px 32px ${hexWithAlpha("#000000", 0.2)}`,
  vaultRowShadow: `0 10px 14px -10px ${hexWithAlpha("#000000", 0.34)}`,
  dockChipShadow: `0 0 6px ${hexWithAlpha("#000000", 0.24)}, 0 5px 12px -4px ${hexWithAlpha("#000000", 0.42)}`,
  settingsSectionShadow: `0 6px 12px -8px ${hexWithAlpha("#000000", 0.18)}`,
  logViewerBg: "#2e3542",
};

const LIGHT: ThemePalette = {
  background: "#d6dde8",
  surfaceContainer: "#f0f3f9",
  surfaceContainerLow: "#e4eaf3",
  surfaceContainerHigh: "#e8edf4",
  surfaceRowHover: "#dde4ef",
  surfaceContainerHighest: "#c8d2e0",
  onSurface: "#243048",
  onSurfaceVariant: "#566678",
  outlineVariant: hexWithAlpha("#bcc8d8", 0.6),
  splitDivider: hexWithAlpha("#58667c", 0.24),
  splitDividerOnPrimary: hexWithAlpha("#ffffff", 0.42),
  scrollbarThumb: "#c0cad8",
  scrollbarThumbHover: "#aab6c8",
  primary: "#364a62",
  onPrimary: "#f4f7fb",
  accent: "#4a62b8",
  accentForeground: "#ffffff",
  vaultStatusOpen: "#1f8560",
  vaultStatusClosed: "#4a62b8",
  vaultStatusRecovery: "#a67c0a",
  vaultOpenBadgeBg: hexWithAlpha("#1f8560", 0.14),
  vaultOpenIconBg: hexWithAlpha("#1f8560", 0.2),
  vaultRecoveryBadgeBg: hexWithAlpha("#a67c0a", 0.14),
  vaultRecoveryIconBg: hexWithAlpha("#a67c0a", 0.2),
  vaultOpenGlow: hexWithAlpha("#1f8560", 0.2),
  editorGutterMuted: "#687488",
  errorContainer: "#edd8d4",
  onErrorContainer: "#721218",
  modalScrim: hexWithAlpha("#243048", 0.32),
  modalShadow: `0 12px 32px ${hexWithAlpha("#243048", 0.08)}`,
  vaultRowShadow: `0 10px 14px -10px ${hexWithAlpha("#243048", 0.16)}`,
  dockChipShadow: `0 0 6px ${hexWithAlpha("#243048", 0.1)}, 0 5px 12px -4px ${hexWithAlpha("#243048", 0.18)}`,
  settingsSectionShadow: `0 6px 12px -8px ${hexWithAlpha("#243048", 0.1)}`,
  logViewerBg: "#d0d8e4",
};

export const THEME_PALETTES: Record<UiTheme, ThemePalette> = {
  dark: DARK,
  neutral: NEUTRAL,
  light: LIGHT,
};

export function colorsForTheme(theme: UiTheme): ThemePalette {
  return THEME_PALETTES[theme] ?? DARK;
}
