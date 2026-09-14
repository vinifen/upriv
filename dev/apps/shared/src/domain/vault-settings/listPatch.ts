import type { VaultSettingsConfig } from "./types";

/** List fields synced from `[vault]` on save (`vault_config_save`). */
export function vaultSettingsToListPatch(config: VaultSettingsConfig) {
  const passwordHint = config.vault.password_hint.trim();
  const storageMode = config.storage.mode;
  return {
    displayName: config.vault.display_name,
    order: config.vault.order,
    note: config.vault.note,
    hidden: config.vault.hidden,
    passwordHint: passwordHint || undefined,
    storageMode,
  };
}
