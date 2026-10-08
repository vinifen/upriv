import type { VaultSettingsConfig } from "../../domain/vault-settings";

/** Last `config.toml` read or saved in this process, keyed by vault id. */
const remembered = new Map<string, VaultSettingsConfig>();

/** Hermes does not provide `structuredClone`. The config is plain JSON. */
function cloneConfig(config: VaultSettingsConfig): VaultSettingsConfig {
  return JSON.parse(JSON.stringify(config)) as VaultSettingsConfig;
}

export function rememberVaultSettings(vaultId: string, config: VaultSettingsConfig): void {
  remembered.set(vaultId, cloneConfig(config));
}

export function peekVaultSettings(vaultId: string): VaultSettingsConfig | undefined {
  return remembered.get(vaultId);
}

export function forgetVaultSettings(vaultId: string): void {
  remembered.delete(vaultId);
}
