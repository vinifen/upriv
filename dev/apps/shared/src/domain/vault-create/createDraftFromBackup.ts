import { displayNameFromImportFilename } from "../vault/displayName";
import { createEmptyCreateVaultDraft } from "./defaults";
import type { CreateVaultDraft } from "./types";

/** Seed for create-vault wizard when user picks a backup row (new vault — no in-place restore). */
export function createDraftFromBackup(
  stamp: string,
  sourceVaultId: string,
  existingOrders: readonly number[],
): CreateVaultDraft {
  const draft = createEmptyCreateVaultDraft(existingOrders);
  const baseName = displayNameFromImportFilename(stamp);
  const displayName = baseName ? `${baseName} (backup)` : "Imported backup";

  return {
    ...draft,
    source: "import",
    importKind: "backup",
    importFileName: stamp,
    importFilePath: `vaults/${sourceVaultId}/backups/${stamp}`,
    displayName,
  };
}
