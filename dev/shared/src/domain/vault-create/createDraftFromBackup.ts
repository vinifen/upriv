import { displayNameFromArchiveFilename } from "../vault/displayName";
import { createEmptyCreateVaultDraft } from "./defaults";
import type { CreateVaultDraft } from "./types";

/** Seed for create-vault wizard when user picks a backup row (new vault — no in-place restore). */
export function createDraftFromBackup(
  backupFilename: string,
  sourceVaultId: string,
  existingOrders: readonly number[],
): CreateVaultDraft {
  const draft = createEmptyCreateVaultDraft(existingOrders);
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
