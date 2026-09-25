import { importDisplayNameFromFilename } from "../vault/displayName";
import { createEmptyCreateVaultDraft } from "./defaults";
import type { CreateVaultDraft } from "./types";

/**
 * Seed create-vault wizard for an OS-dropped or picked `.zip` of `store/` or `.7z`.
 *
 * `importFilePath` must be a real absolute path (Electron `webUtils.getPathForFile`
 * / native picker). Never fall back to the filename — the daemon would treat it as
 * a relative path and fail with a misleading IO error.
 */
export function createDraftFromImportPackage(
  fileName: string,
  existingOrders: readonly number[],
  options?: { filePath?: string },
): CreateVaultDraft {
  const draft = createEmptyCreateVaultDraft(existingOrders);
  const trimmedName = fileName.trim();
  const path = options?.filePath?.trim() ?? "";

  return {
    ...draft,
    source: "import",
    importKind: "file",
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
