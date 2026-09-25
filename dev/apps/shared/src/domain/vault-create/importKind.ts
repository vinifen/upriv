import { isAbsoluteOsFilesystemPath } from "../workspace";
import type { CreateVaultDraft, CreateVaultImportKind, CreateVaultResult } from "./types";

export type CreateVaultImportDraft = Pick<
  CreateVaultDraft,
  "source" | "importKind" | "importFileName"
>;

/** True when the password step must probe a logical `.7z` (not zip / backup copy). */
export function createVaultImportNeedsArchivePassword(draft: CreateVaultImportDraft): boolean {
  if (draft.source !== "import") return false;
  if (draft.importKind === "backup") return false;
  return !draft.importFileName.toLowerCase().endsWith(".zip");
}

export function createVaultImportPackageKind(
  draft: Pick<CreateVaultResult, "importKind" | "importFileName">,
): "store_zip" | "seven_zip" {
  if (draft.importKind === "backup") return "store_zip";
  if ((draft.importFileName ?? "").toLowerCase().endsWith(".7z")) return "seven_zip";
  return "store_zip";
}

/** Wire payload for `vault_import_zip` / `vault_import_7z` from a finished wizard. */
export function createVaultImportPackage(
  result: Pick<CreateVaultResult, "source" | "importKind" | "importFileName" | "importFilePath">,
  password: string,
):
  | {
      kind: "store_zip" | "seven_zip";
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
      : isAbsoluteOsFilesystemPath(path)
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
