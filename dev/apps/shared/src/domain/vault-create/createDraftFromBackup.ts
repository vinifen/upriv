import type { VaultBackupEntry } from "../backups";
import { backupVaultDisplayName } from "../vault/displayName";
import { createEmptyCreateVaultDraft } from "./defaults";
import type { CreateVaultDraft } from "./types";

/** Group that currently lists `vaultId`, if any. Membership is not inside the backup zip. */
export function groupIdContainingVault(
  groups: readonly { id: string; groupedVaults: readonly string[] }[],
  vaultId: string,
): string | null {
  return groups.find((group) => group.groupedVaults.includes(vaultId))?.id ?? null;
}

/**
 * Seed for the create-vault wizard when the person picks a backup (a new
 * vault, never an in-place restore). The backup's key names its folder, so
 * core finds it wherever it is.
 */
export function createDraftFromBackup(
  backup: Pick<VaultBackupEntry, "key" | "fileName">,
  sourceVaultId: string,
  sourceDisplayName: string,
  existingOrders: readonly number[],
  existingDisplayNames: readonly string[] = [],
  sourceGroupId?: string | null,
): CreateVaultDraft {
  const draft = createEmptyCreateVaultDraft(existingOrders);
  const displayName = backupVaultDisplayName(sourceDisplayName, existingDisplayNames);
  const groupId = sourceGroupId?.trim() ?? "";

  return {
    ...draft,
    source: "import",
    importKind: "backup",
    importFileName: backup.fileName,
    importFilePath: `vaults/${sourceVaultId}/backups/${backup.key}`,
    displayName,
    groupMode: groupId ? "existing" : "none",
    groupId,
  };
}
