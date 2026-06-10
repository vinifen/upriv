import { displayNameFromArchiveFilename } from "@/lib/vaultDisplayName";
import { createEmptyDraft } from "./createVaultDefaults";
import type { CreateVaultDraft } from "./createVaultTypes";

/** Seed for create-vault wizard when user picks a backup row (new vault — no in-place restore). */
export function createDraftFromBackup(
  backupFilename: string,
  sourceVaultId: string,
  existingOrders: readonly number[],
): CreateVaultDraft {
  const draft = createEmptyDraft(existingOrders);
  const baseName = displayNameFromArchiveFilename(backupFilename);
  const displayName = baseName ? `${baseName} (backup)` : "Imported backup";

  return {
    ...draft,
    source: "import",
    importFileName: backupFilename,
    importFilePath: `vaults/${sourceVaultId}/backups/${backupFilename}`,
    displayName,
  };
}
