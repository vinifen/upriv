import type { IconName } from "@/components/icons";
import type { VaultListSortDirection, VaultListSortMode, VaultListViewMode } from "@upriv/shared";

export const SORT_MODE_ICON: Record<VaultListSortMode, IconName> = {
  order: "grip-vertical",
  name: "sort-alpha",
  state: "sort-state",
  last_accessed: "clock",
};

export const SORT_DIRECTION_ICON: Record<VaultListSortDirection, IconName> = {
  asc: "arrow-up",
  desc: "arrow-down",
};

export const VIEW_MODE_ICON: Record<VaultListViewMode, IconName> = {
  default: "list-rows",
  large: "list-rows-loose",
  compact: "list-rows-tight",
  blocks: "layout-grid",
};
