import { backupEntryFileName, backupEntryKey } from "../backups";
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

/** Seed for create-vault wizard when user picks a backup row (new vault — no in-place restore). */
export function createDraftFromBackup(
  stamp: string,
  sourceVaultId: string,
  sourceDisplayName: string,
  existingOrders: readonly number[],
  existingDisplayNames: readonly string[] = [],
  sourceGroupId?: string | null,
  snapshotFileName?: string,
  saved = false,
): CreateVaultDraft {
  const draft = createEmptyCreateVaultDraft(existingOrders);
  const displayName = backupVaultDisplayName(sourceDisplayName, existingDisplayNames);
  const groupId = sourceGroupId?.trim() ?? "";
  const fileName = backupEntryFileName({ stamp, fileName: snapshotFileName }, sourceVaultId);
  const key = backupEntryKey({ stamp, fileName: snapshotFileName, saved }, sourceVaultId);

  return {
    ...draft,
    source: "import",
    importKind: "backup",
    importFileName: fileName,
    importFilePath: `vaults/${sourceVaultId}/backups/${key}`,
    displayName,
    groupMode: groupId ? "existing" : "none",
    groupId,
  };
}
