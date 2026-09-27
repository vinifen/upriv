import { RpcError } from "../core-rpc/errors";
import { suggestedImportDisplayName } from "../vault/displayName";
import { VAULT_ERROR_CODES } from "../vault/errors/codes";
import { isAbsoluteOsFilesystemPath, isContentUri } from "../workspace";
import type { CreateVaultDraft, CreateVaultImportKind, CreateVaultImportShape } from "./types";

export type CreateVaultImportDraft = Pick<
  CreateVaultDraft,
  | "source"
  | "importKind"
  | "importShape"
  | "importExtract"
  | "importFileName"
  | "zipLayout"
  | "importZipRejected"
  | "importZipProbeFailed"
>;

type ImportDecision = Partial<CreateVaultImportDraft> & {
  source: CreateVaultDraft["source"];
  importFileName?: string;
};

function archiveKind(fileName: string): "zip" | "seven_zip" | null {
  const name = fileName.trim().toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".7z")) return "seven_zip";
  return null;
}

function shapeOf(draft: ImportDecision): CreateVaultImportShape {
  return draft.importShape ?? "file";
}

function extractWanted(draft: ImportDecision): boolean {
  return draft.importExtract !== false;
}

/** Extract is offered for an ordinary `.zip` or a `.7z`, not a folder or a store zip. */
export function importExtractApplies(draft: ImportDecision): boolean {
  if (draft.importZipProbeFailed) return false;
  if (draft.source !== "import" || draft.importKind === "backup") return false;
  if (shapeOf(draft) === "directory") return false;
  const kind = archiveKind(draft.importFileName ?? "");
  if (kind === "seven_zip") return true;
  if (kind !== "zip") return false;
  if (draft.zipLayout === "store") return false;
  return draft.zipLayout === "files" || draft.importZipRejected === true;
}

/** The user can see Extract and left it on. */
export function importExtractEnabled(draft: ImportDecision): boolean {
  return importExtractApplies(draft) && extractWanted(draft);
}

function isStoreZip(draft: ImportDecision): boolean {
  return (
    shapeOf(draft) !== "directory" &&
    archiveKind(draft.importFileName ?? "") === "zip" &&
    (draft.importKind === "backup" || draft.zipLayout === "store")
  );
}

/** True when the password step must probe a logical `.7z` (not zip / backup). */
export function createVaultImportNeedsArchivePassword(draft: ImportDecision): boolean {
  if (draft.source !== "import" || draft.importKind === "backup") return false;
  return importExtractEnabled(draft) && archiveKind(draft.importFileName ?? "") === "seven_zip";
}

/**
 * The import encrypts documents with a new vault password.
 * A store copy and an extracted `.7z` (archive password) do not.
 */
export function importSetsVaultPassword(draft: ImportDecision): boolean {
  if (draft.source !== "import" || draft.importKind === "backup") return false;
  if (isStoreZip(draft)) return false;
  if (
    shapeOf(draft) !== "directory" &&
    archiveKind(draft.importFileName ?? "") === "zip" &&
    !draft.zipLayout &&
    !draft.importZipRejected
  ) {
    return false;
  }
  if (importExtractEnabled(draft) && archiveKind(draft.importFileName ?? "") === "seven_zip") {
    return false;
  }
  return true;
}

/** An ordinary `.zip` is unpacked into a new vault (Extract on). */
export function importZipWrapsDocuments(draft: {
  source: CreateVaultDraft["source"];
  zipLayout: CreateVaultDraft["zipLayout"];
  importShape?: CreateVaultImportShape;
  importExtract?: boolean;
  importKind?: CreateVaultImportKind;
  importFileName?: string;
  importZipRejected?: boolean;
}): boolean {
  return (
    importExtractEnabled({
      source: draft.source,
      importKind: draft.importKind,
      importShape: draft.importShape,
      importExtract: draft.importExtract,
      importFileName: draft.importFileName ?? "",
      zipLayout: draft.zipLayout,
      importZipRejected: draft.importZipRejected,
    }) && draft.zipLayout === "files"
  );
}

export function createVaultImportPackageKind(
  draft: ImportDecision,
): "store_zip" | "seven_zip" | "files_zip" | "os_tree" {
  if (draft.importZipProbeFailed) {
    throw new RpcError(VAULT_ERROR_CODES.IMPORT_SOURCE_UNREADABLE, "import zip was not classified");
  }
  if (draft.importKind === "backup" || isStoreZip(draft)) return "store_zip";
  if (shapeOf(draft) === "directory") return "os_tree";
  const kind = archiveKind(draft.importFileName ?? "");
  if (kind === "zip" && draft.zipLayout === "files" && importExtractEnabled(draft)) {
    return "files_zip";
  }
  if (kind === "seven_zip" && importExtractEnabled(draft)) return "seven_zip";
  return "os_tree";
}

/** Wire payload for vault import from a finished wizard. */
export function createVaultImportPackage(
  result: ImportDecision & { importFilePath?: string },
  password: string,
):
  | {
      kind: "store_zip" | "seven_zip" | "files_zip" | "os_tree";
      archivePath?: string;
      archivePassword?: string;
    }
  | undefined {
  if (result.source !== "import") return undefined;
  const kind = createVaultImportPackageKind(result);
  const path = result.importFilePath?.trim() ?? "";
  const archivePath =
    result.importKind === "backup"
      ? path || undefined
      : isAbsoluteOsFilesystemPath(path) || (shapeOf(result) === "directory" && isContentUri(path))
        ? path
        : undefined;
  return {
    kind,
    archivePath,
    archivePassword: kind === "seven_zip" ? password : undefined,
  };
}

export function isCreateVaultBackupImport(kind: CreateVaultImportKind | undefined): boolean {
  return kind === "backup";
}

/** Fields written when the user picks a file or a folder in the Import option. */
export function createVaultImportSelectionPatch(
  picked: { path: string; fileName: string; shape: CreateVaultImportShape },
  previousPath: string,
  existingDisplayNames: readonly string[] = [],
): Partial<CreateVaultDraft> {
  return {
    source: "import",
    importShape: picked.shape,
    importExtract: true,
    importFileName: picked.fileName,
    importFilePath: picked.path,
    displayName: suggestedImportDisplayName(picked.fileName, existingDisplayNames),
    password: "",
    passwordConfirm: "",
    passwordValidated: false,
    passwordTestFailed: false,
    passwordProbeUnavailable: false,
    importKind: "file",
    ...(picked.path !== previousPath
      ? { zipLayout: null, importZipRejected: false, importZipProbeFailed: false }
      : {}),
  };
}
