import type { I18nKey } from "../../i18n/catalog";
import type { VaultGroup } from "./types";
import type { VaultListItem } from "../vault-list/types";

export interface GroupedVaultPickerItem {
  vault: VaultListItem;
  /** Present when the vault currently belongs to another group. */
  otherGroup: VaultGroup | null;
}

function sortByDisplayName(a: VaultListItem, b: VaultListItem): number {
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Flat, name-sorted vault rows for group create/settings pickers.
 * `excludeGroupId` — when editing, that group's vaults are not labeled "in another group".
 * Hidden vaults are omitted unless `includeHidden`.
 */
export function buildGroupedVaultPickerItems(options: {
  vaults: readonly VaultListItem[];
  groups: readonly VaultGroup[];
  excludeGroupId?: string;
  query?: string;
  /** When false (default), hidden vaults are omitted so they cannot be selected. */
  includeHidden?: boolean;
}): GroupedVaultPickerItem[] {
  const otherByVaultId = new Map<string, VaultGroup>();
  for (const group of options.groups) {
    if (options.excludeGroupId && group.id === options.excludeGroupId) continue;
    for (const id of group.groupedVaults) {
      otherByVaultId.set(id, group);
    }
  }

  const includeHidden = options.includeHidden ?? false;
  const q = options.query?.trim().toLocaleLowerCase() ?? "";
  return options.vaults
    .filter((vault) => includeHidden || !vault.hidden)
    .filter((vault) => (q ? vault.displayName.toLocaleLowerCase().includes(q) : true))
    .slice()
    .sort(sortByDisplayName)
    .map((vault) => ({
      vault,
      otherGroup: otherByVaultId.get(vault.id) ?? null,
    }));
}

/** First select row: leave/unassign. `danger` when the vault already has a group. */
export function groupAssignmentClearOption(
  selectedGroupId: string,
  t: (key: I18nKey) => string,
): { value: ""; label: string; tone: "muted" | "danger" } {
  const assigned = selectedGroupId.trim().length > 0;
  return {
    value: "",
    label: t(assigned ? "vault.group.assignment.remove" : "vault.group.assignment.none"),
    tone: assigned ? "danger" : "muted",
  };
}
