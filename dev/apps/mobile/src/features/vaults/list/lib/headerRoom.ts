import { CONTROL_HEIGHT_MD, CONTROL_WIDTH_CHROME, spacing } from "@/theme/tokens";

/** Narrowest the open vault search gets; the header keeps this much room for it. */
export const VAULT_LIST_SEARCH_OPEN_MIN_WIDTH = 160;
const TITLE_ICON_WIDTH = 22;

export interface VaultListHeaderLayout {
  /** Width of the header row. */
  rowWidth: number;
  /** Width of the list title at its full length. */
  titleTextWidth: number;
  showCreate: boolean;
  showSearch: boolean;
  searchOpen: boolean;
  showSort: boolean;
  showView: boolean;
}

/**
 * Whether the list icon and title fit at full width beside every shown
 * control. When they do not (a narrow phone with several buttons, or the
 * search open), they give their room to the controls; the create button stays.
 */
export function vaultListTitleFits(layout: VaultListHeaderLayout): boolean {
  if (layout.rowWidth <= 0 || layout.titleTextWidth <= 0) return true;
  const title = TITLE_ICON_WIDTH + spacing.sm + layout.titleTextWidth;
  const create = layout.showCreate ? spacing.sm + CONTROL_HEIGHT_MD : 0;
  const filters = [
    layout.showSearch
      ? layout.searchOpen
        ? VAULT_LIST_SEARCH_OPEN_MIN_WIDTH
        : CONTROL_WIDTH_CHROME
      : 0,
    layout.showSort ? CONTROL_WIDTH_CHROME : 0,
    layout.showView ? CONTROL_WIDTH_CHROME : 0,
  ].filter((width) => width > 0);
  const filterRow =
    filters.length === 0
      ? 0
      : spacing.md +
        filters.reduce((sum, width) => sum + width, 0) +
        spacing.sm * (filters.length - 1);
  return title + create + filterRow <= layout.rowWidth;
}
