import { importDisplayNameFromFilename, suggestedImportDisplayName } from "../vault/displayName";
import { createEmptyCreateVaultDraft } from "./defaults";
import type { CreateVaultDraft, CreateVaultImportShape } from "./types";

/**
 * Seed create-vault wizard for an OS-dropped or picked file or folder.
 *
 * `importFilePath` must be a real absolute path (Electron `webUtils.getPathForFile`
 * / native picker). Never fall back to the filename — the daemon would treat it as
 * a relative path and fail with a misleading IO error.
 */
export function createDraftFromImportPackage(
  fileName: string,
  existingOrders: readonly number[],
  options?: {
    filePath?: string;
    existingDisplayNames?: readonly string[];
    shape?: CreateVaultImportShape;
  },
): CreateVaultDraft {
  const draft = createEmptyCreateVaultDraft(existingOrders);
  const trimmedName = fileName.trim();
  const path = options?.filePath?.trim() ?? "";

  return {
    ...draft,
    source: "import",
    importKind: "file",
    importShape: options?.shape ?? "file",
    importFileName: trimmedName,
    importFilePath: path,
    displayName: suggestedImportDisplayName(trimmedName, options?.existingDisplayNames ?? []),
  };
}

/** True when the import filename cannot be used as a display name as-is. */
export function createVaultImportNeedsRename(draft: {
  source: CreateVaultDraft["source"];
  importFileName: string;
}): boolean {
  if (draft.source !== "import" || !draft.importFileName.trim()) {
    return false;
  }
  return importDisplayNameFromFilename(draft.importFileName).needsChoice;
}

/** Open wizard on Import with nothing chosen yet (empty-state Import CTA). */
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
