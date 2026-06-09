/** Matches future `[ui] vault_list_view` in settings.toml */
export type VaultListViewMode = "default" | "large" | "compact" | "blocks";

export const DEFAULT_VAULT_LIST_VIEW: VaultListViewMode = "default";

export const vaultRowDensityClass = {
  default: {
    article: "py-6",
    title: "text-lg",
    icon: "h-10 w-10",
    iconSize: 20 as const,
  },
  large: {
    article: "py-10",
    title: "text-xl",
    icon: "h-12 w-12",
    iconSize: 24 as const,
  },
  compact: {
    article: "py-4",
    title: "text-base",
    icon: "h-8 w-8",
    iconSize: 18 as const,
  },
  blocks: {
    article: "py-5",
    title: "text-base",
    icon: "h-10 w-10",
    iconSize: 20 as const,
  },
} as const;
