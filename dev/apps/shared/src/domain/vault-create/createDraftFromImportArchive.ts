import { displayNameFromArchiveFilename } from "../vault/displayName";
import { createEmptyCreateVaultDraft } from "./defaults";
import type { CreateVaultDraft } from "./types";

/**
 * Seed create-vault wizard for an OS-dropped or picked `.7z` archive.
 *
 * FUTURE: `importFilePath` must be a real absolute path (Electron `File.path` or
 * daemon-copied path under the vault-root). Browser File blobs alone are not enough
 * for the eventual copy-into-vault-folder step.
 */
export function createDraftFromImportArchive(
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
    displayName: displayNameFromArchiveFilename(trimmedName),
  };
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
