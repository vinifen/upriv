import type { UiTheme } from "../app-settings/types";
import { colorsForTheme, type ThemePalette } from "./palettes";
import {
  RADII,
  CONTROL_HEIGHT_MD,
  CONTROL_WIDTH_CHROME,
  MAX_WIDTH_CONTENT,
  MAX_WIDTH_VAULT_LIST,
} from "./tokens";

/** Palette field → desktop CSS custom property name. */
export const THEME_CSS_VAR_NAMES = {
  background: "--background",
  surfaceContainer: "--surface-container",
  surfaceContainerLow: "--surface-container-low",
  surfaceContainerHigh: "--surface-container-high",
  surfaceRowHover: "--surface-row-hover",
  surfaceContainerHighest: "--surface-container-highest",
  onSurface: "--on-surface",
  onSurfaceVariant: "--on-surface-variant",
  outlineVariant: "--outline-variant",
  splitDivider: "--split-divider",
  splitDividerOnPrimary: "--split-divider-on-primary",
  scrollbarThumb: "--scrollbar-thumb",
  scrollbarThumbHover: "--scrollbar-thumb-hover",
  primary: "--primary",
  onPrimary: "--on-primary",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  vaultStatusOpen: "--vault-status-open",
  vaultStatusClosed: "--vault-status-closed",
  vaultStatusRecovery: "--vault-status-recovery",
  vaultOpenBadgeBg: "--vault-open-badge-bg",
  vaultOpenIconBg: "--vault-open-icon-bg",
  vaultRecoveryBadgeBg: "--vault-recovery-badge-bg",
  vaultRecoveryIconBg: "--vault-recovery-icon-bg",
  vaultOpenGlow: "--vault-open-glow",
  editorGutterMuted: "--editor-gutter-muted",
  errorContainer: "--error-container",
  onErrorContainer: "--on-error-container",
  modalScrim: "--modal-scrim",
  modalShadow: "--modal-shadow",
  vaultRowShadow: "--vault-row-shadow",
  dockChipShadow: "--dock-chip-shadow",
  settingsSectionShadow: "--settings-section-shadow",
  logViewerBg: "--log-viewer-bg",
} as const satisfies Record<keyof ThemePalette, `--${string}`>;

/**
 * CSS custom properties for one theme (palette + radii).
 * Desktop applies this on `document.documentElement`; Tailwind keeps `var(--*)`.
 */
export function cssCustomProperties(theme: UiTheme): Record<string, string> {
  const palette = colorsForTheme(theme);
  const vars: Record<string, string> = {
    "--radius-xs": `${RADII.xs}px`,
    "--radius-sm": `${RADII.sm}px`,
    "--radius-md": `${RADII.md}px`,
    "--radius-lg": `${RADII.lg}px`,
    "--radius-full": `${RADII.full}px`,
    "--control-height-md": `${CONTROL_HEIGHT_MD}px`,
    "--control-width-chrome": `${CONTROL_WIDTH_CHROME}px`,
    "--max-width-content": `${MAX_WIDTH_CONTENT}px`,
    "--max-width-vault-list": `${MAX_WIDTH_VAULT_LIST}px`,
  };
  for (const key of Object.keys(THEME_CSS_VAR_NAMES) as (keyof ThemePalette)[]) {
    vars[THEME_CSS_VAR_NAMES[key]] = palette[key];
  }
  return vars;
}
