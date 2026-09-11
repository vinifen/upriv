/** Corner radii (px). Desktop Tailwind: `rounded` / `md|lg` / `xl` / `2xl` / `full`. */
export const RADII = {
  /** Badges / chips / checkbox. */
  xs: 8,
  /** Buttons / inputs / drag handle. */
  sm: 12,
  /** Vaults / cards / toasts / search. */
  md: 16,
  /** Modals / menus / pipeline overlay. */
  lg: 20,
  /** Circles / pills. */
  full: 999,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Minimum touch target (pt / CSS px). */
export const TOUCH_MIN = 44;

/** Desktop `h-10` — primary/secondary control height. */
export const CONTROL_HEIGHT_MD = 40;

/** Desktop header chrome — ⋮ / gear / search / sort / view (`--control-width-chrome`). */
export const CONTROL_WIDTH_CHROME = 46;

/**
 * Modal vertical budget — desktop uses ~92dvh; keep one ratio for all mobile dialogs.
 * Frame safe-area padding is applied on top of this.
 */
export const MODAL_MAX_HEIGHT_RATIO = 0.88;

/** Create-vault step pane inside the dialog (desktop ~72–76vh / 40–44rem). */
export const MODAL_WIZARD_BODY_MAX_HEIGHT_RATIO = 0.66;

/** Centered content columns — desktop Tailwind `max-w-content` / `max-w-vault-list`. */
export const MAX_WIDTH_CONTENT = 1200;
export const MAX_WIDTH_VAULT_LIST = 900;
