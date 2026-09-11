import { importDisplayNameFromFilename } from "../vault/displayName";
import { createEmptyCreateVaultDraft } from "./defaults";
import type { CreateVaultDraft } from "./types";

/**
 * Seed create-vault wizard for an OS-dropped or picked `.zip` of `contents/` or `.7z`.
 *
 * FUTURE: `importFilePath` must be a real absolute path (Electron `File.path` or
 * daemon-copied path under the vault-root). Browser File blobs alone are not enough
 * for the eventual copy-into-vault-folder step.
 */
export function createDraftFromImportPackage(
  fileName: string,
  existingOrders: readonly number[],
  options?: { filePath?: string },
): CreateVaultDraft {
  const draft = createEmptyCreateVaultDraft(existingOrders);
  const trimmedName = fileName.trim();
  const path = options?.filePath?.trim() || trimmedName;

  return {
    ...draft,
    source: "import",
    importFileName: trimmedName,
    importFilePath: path,
    displayName: importDisplayNameFromFilename(trimmedName).displayName,
  };
}

/** True when the import filename cannot be used as a display name as-is. */
export function createVaultImportNeedsRename(draft: {
  source: CreateVaultDraft["source"];
  importFileName: string;
}): boolean {
  if (draft.source !== "import" || !draft.importFileName.trim()) return false;
  return importDisplayNameFromFilename(draft.importFileName).needsChoice;
}

/** Open wizard on Import with no archive chosen yet (empty-state Import CTA). */
export function createDraftForImportSource(existingOrders: readonly number[]): CreateVaultDraft {
  return {
    ...createEmptyCreateVaultDraft(existingOrders),
    source: "import",
  };
}

/** Open wizard with Create from scratch already selected (empty-state Create CTA). */
export function createDraftForScratchSource(existingOrders: readonly number[]): CreateVaultDraft {
  return {
    ...createEmptyCreateVaultDraft(existingOrders),
    source: "scratch",
  };
}
