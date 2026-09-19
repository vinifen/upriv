import type { VaultGroup } from "../vault-groups/types";
import type { VaultListItem } from "../vault-list/types";
import type { VaultSettingsConfig, VaultSettingsListPatch } from "./types";

/** List fields synced from `[vault]` on save (`vault_config_save` / `vault_rename`). */
export function vaultSettingsToListPatch(config: VaultSettingsConfig): VaultSettingsListPatch {
  const passwordHint = config.vault.password_hint.trim();
  return {
    id: config.vault.id.trim(),
    displayName: config.vault.display_name,
    order: config.vault.order,
    note: config.vault.note,
    hidden: config.vault.hidden,
    passwordHint: passwordHint || undefined,
    storageMode: config.storage.mode,
  };
}

/** List patch after `vault_rename` — identity only; other fields stay as already on the list. */
export function vaultSettingsIdentityListPatch(
  baseline: VaultSettingsConfig,
  id: string,
  displayName: string,
): VaultSettingsListPatch {
  return vaultSettingsToListPatch({
    ...baseline,
    vault: { ...baseline.vault, id, display_name: displayName },
  });
}

/** Apply settings save patch onto one list row (`fromId` → `patch.id` when renamed). */
export function applyVaultSettingsListPatch(
  vault: VaultListItem,
  patch: VaultSettingsListPatch,
): VaultListItem {
  return {
    ...vault,
    id: patch.id,
    displayName: patch.displayName,
    order: patch.order,
    note: patch.note,
    hidden: patch.hidden,
    passwordHint: patch.passwordHint,
    storageMode: patch.storageMode,
  };
}

/** Remap a vault id inside every group's membership list. */
export function remapVaultIdInGroups(
  groups: readonly VaultGroup[],
  fromId: string,
  toId: string,
): VaultGroup[] {
  if (!fromId || fromId === toId) return groups as VaultGroup[];
  let changed = false;
  const next = groups.map((group) => {
    let groupChanged = false;
    const groupedVaults = group.groupedVaults.map((id) => {
      if (id !== fromId) return id;
      groupChanged = true;
      return toId;
    });
    if (!groupChanged) return group;
    changed = true;
    return { ...group, groupedVaults };
  });
  return changed ? next : (groups as VaultGroup[]);
}
