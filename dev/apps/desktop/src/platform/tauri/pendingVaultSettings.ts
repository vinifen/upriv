import type { StorageMode, VaultSettingsConfig } from "@upriv/shared";

/** UI-only vault configs until Tauri create-vault writes them to disk. */
const pendingByVaultId = new Map<string, VaultSettingsConfig>();

export function getPendingVaultSettings(vaultId: string): VaultSettingsConfig | undefined {
  const config = pendingByVaultId.get(vaultId);
  return config ? structuredClone(config) : undefined;
}

export function setPendingVaultSettings(vaultId: string, config: VaultSettingsConfig): void {
  pendingByVaultId.set(vaultId, structuredClone(config));
}

export function clearPendingVaultSettings(vaultId: string): void {
  pendingByVaultId.delete(vaultId);
}

export function getPendingVaultStorageMode(vaultId: string): StorageMode | undefined {
  return pendingByVaultId.get(vaultId)?.storage.mode;
}

export function isVaultConfigMissingError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);

  return (
    message.includes("vault config not found") ||
    message.includes("VaultNotFound") ||
    message.includes("id mismatch in config")
  );
}

/** @internal Test hook */
export function __clearPendingVaultSettingsForTests(): void {
  pendingByVaultId.clear();
}
