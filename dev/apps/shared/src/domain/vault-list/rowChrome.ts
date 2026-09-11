/**
 * Vault list row chrome follows **row width**, not platform.
 * Phone portrait and a narrow desktop window share compact chrome;
 * landscape / tablet / desktop share comfortable chrome.
 */

export type VaultRowChrome = "compact" | "comfortable";

/**
 * Inner row width at which the name circle, status badge, and Unlock/Lock
 * fit on one horizontal line without wrapping (button is 9rem + icons).
 */
export const VAULT_ROW_COMFORTABLE_MIN_PX = 560;

export function vaultRowChrome(rowWidthPx: number): VaultRowChrome {
  if (rowWidthPx < VAULT_ROW_COMFORTABLE_MIN_PX) return "compact";
  return "comfortable";
}

/** Matches Tailwind `sm` — two block columns need this list width. */
export const VAULT_BLOCKS_TWO_COL_MIN_PX = 640;
/** Matches Tailwind `lg`. */
export const VAULT_BLOCKS_THREE_COL_MIN_PX = 1024;

export function vaultBlocksColumnCount(listWidthPx: number): 1 | 2 | 3 {
  if (listWidthPx >= VAULT_BLOCKS_THREE_COL_MIN_PX) return 3;
  if (listWidthPx >= VAULT_BLOCKS_TWO_COL_MIN_PX) return 2;
  return 1;
}

/**
 * A 0–1 vault group sits in one cell (beside other cards). Two members span two
 * columns. Three or more take the full row.
 */
export function vaultBlocksGroupColumnSpan(
  visibleMemberCount: number,
  columns: 1 | 2 | 3,
): 1 | 2 | 3 {
  if (visibleMemberCount <= 1 || columns <= 1) return 1;
  if (visibleMemberCount === 2) return 2;
  return columns;
}

/** Nested card grid inside a group box — never wider than the outer span. */
export function vaultBlocksGroupInnerColumns(
  visibleMemberCount: number,
  columns: 1 | 2 | 3,
): 1 | 2 | 3 {
  if (visibleMemberCount <= 1) return 1;
  if (visibleMemberCount === 2) return columns === 1 ? 1 : 2;
  return columns;
}

/** Vertical padding / title / name-circle sizes — keep Tailwind classes in sync. */
export const VAULT_ROW_DENSITY = {
  default: { paddingY: 24, paddingX: 16, titleSize: 18, icon: 40, iconLetters: 14 },
  large: { paddingY: 40, paddingX: 16, titleSize: 20, icon: 48, iconLetters: 16 },
  compact: { paddingY: 16, paddingX: 16, titleSize: 16, icon: 32, iconLetters: 12 },
  blocks: { paddingY: 20, paddingX: 16, titleSize: 16, icon: 40, iconLetters: 14 },
} as const;
