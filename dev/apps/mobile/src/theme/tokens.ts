import type { UiTheme } from "@upriv/shared";

/**
 * Design tokens mirrored from desktop `styles/tokens.css`.
 * Use `colorsForTheme()` / `useTheme()` — do not hardcode a single theme in screens.
 */
export type ThemeColors = {
  background: string;
  surfaceContainer: string;
  /** Muted sheet under group boxes (desktop `surface-container-low`). */
  surfaceContainerLow: string;
  surfaceContainerHigh: string;
  surfaceRowHover: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outlineVariant: string;
  primary: string;
  onPrimary: string;
  accent: string;
  accentForeground: string;
  vaultStatusOpen: string;
  vaultStatusClosed: string;
  vaultStatusSealed: string;
  vaultStatusRecovery: string;
  errorContainer: string;
  onErrorContainer: string;
  modalScrim: string;
  logViewerBg: string;
};

const DARK: ThemeColors = {
  background: "#081425",
  surfaceContainer: "#152031",
  surfaceContainerLow: "#0e1828",
  surfaceContainerHigh: "#1f2a3c",
  surfaceRowHover: "#1c2839",
  surfaceContainerHighest: "#2a3548",
  onSurface: "#d8e3fb",
  onSurfaceVariant: "#c6c6cd",
  outlineVariant: "#45464d",
  primary: "#bec6e0",
  onPrimary: "#283044",
  accent: "#6b8cff",
  accentForeground: "#0f172a",
  vaultStatusOpen: "#3dd68c",
  vaultStatusClosed: "#6b8cff",
  vaultStatusSealed: "#8b8b8b",
  vaultStatusRecovery: "#f5a623",
  errorContainer: "#93000a",
  onErrorContainer: "#ffdad6",
  modalScrim: "rgba(8, 20, 37, 0.8)",
  logViewerBg: "#0d1117",
};

const NEUTRAL: ThemeColors = {
  background: "#282f3e",
  surfaceContainer: "#353d4e",
  surfaceContainerLow: "#2e3544",
  surfaceContainerHigh: "#3f4756",
  surfaceRowHover: "#474f5e",
  surfaceContainerHighest: "#505864",
  onSurface: "#eaebee",
  onSurfaceVariant: "#a4acb8",
  outlineVariant: "#5c6474",
  primary: "#c4cad4",
  onPrimary: "#252b38",
  accent: "#6888dc",
  accentForeground: "#0f172a",
  vaultStatusOpen: "#42de9a",
  vaultStatusClosed: "#6888dc",
  vaultStatusSealed: "#9aa3b0",
  vaultStatusRecovery: "#f0b84a",
  errorContainer: "#a82028",
  onErrorContainer: "#ffe8e4",
  modalScrim: "rgba(32, 38, 50, 0.74)",
  logViewerBg: "#2e3542",
};

const LIGHT: ThemeColors = {
  background: "#d6dde8",
  surfaceContainer: "#f0f3f9",
  surfaceContainerLow: "#e4eaf3",
  surfaceContainerHigh: "#e8edf4",
  surfaceRowHover: "#dde4ef",
  surfaceContainerHighest: "#c8d2e0",
  onSurface: "#243048",
  onSurfaceVariant: "#566678",
  outlineVariant: "#bcc8d8",
  primary: "#364a62",
  onPrimary: "#f4f7fb",
  accent: "#4a62b8",
  accentForeground: "#ffffff",
  vaultStatusOpen: "#1f8560",
  vaultStatusClosed: "#4a62b8",
  vaultStatusSealed: "#687488",
  vaultStatusRecovery: "#a67c0a",
  errorContainer: "#edd8d4",
  onErrorContainer: "#721218",
  modalScrim: "rgba(36, 48, 72, 0.32)",
  logViewerBg: "#d0d8e4",
};

export const THEME_COLORS: Record<UiTheme, ThemeColors> = {
  dark: DARK,
  neutral: NEUTRAL,
  light: LIGHT,
};

export function colorsForTheme(theme: UiTheme): ThemeColors {
  return THEME_COLORS[theme] ?? DARK;
}

/** @deprecated Prefer `useTheme().colors` — static dark fallback for legacy imports. */
export const colors = DARK;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

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

/** @deprecated Prefer `useTheme().typography` */
export const typography = typographyForColors(DARK);

/** Minimum touch target (pt). */
export const touchMin = 44;

/** Desktop `h-10` — primary/secondary control height (header, toolbar filters). */
export const CONTROL_HEIGHT_MD = 40;

/**
 * Modal vertical budget — desktop uses ~92dvh; keep one ratio for all mobile dialogs.
 * Frame safe-area padding is applied on top of this.
 */
export const MODAL_MAX_HEIGHT_RATIO = 0.88;

/** Create-vault step pane inside the dialog (desktop ~72–76vh / 40–44rem). */
export const MODAL_WIZARD_BODY_MAX_HEIGHT_RATIO = 0.66;

/**
 * Centered content columns — desktop Tailwind `max-w-content` / `max-w-vault-list`.
 * On tablets / landscape, content stops hugging the extreme edges.
 */
export const MAX_WIDTH_CONTENT = 1200;
export const MAX_WIDTH_VAULT_LIST = 900;
