import type { VaultWorkspaceAction } from "./workspaceReducer";
import { foldersToExpandOnImport, resolveImportDestination } from "../file-tree/importPaths";
import { isVaultImportUnsupported } from "../file-tree/language";

export interface ImportLogicalFile {
  name: string;
  relativePath: string;
}

export interface ImportLogicalResult {
  importedPaths: string[];
  foldersToExpand: string[];
  skippedInvalid: number;
  skippedUnsupported: number;
  readFailureName: string | null;
}

function isUnsupportedRead(error: unknown): boolean {
  return error instanceof Error && error.message === "unsupported";
}

/** Read + write one OS/picker batch. Does not toast or dispatch workspace actions. */
export async function importLogicalFiles<T extends ImportLogicalFile>(
  files: readonly T[],
  options: {
    vaultId: string;
    parentPath: string;
    skippedUnsupported?: number;
    readContent: (file: T) => Promise<string>;
    ensureFolder: (vaultId: string, parentPath: string, name: string) => string | null;
    importFile: (
      vaultId: string,
      parentPath: string,
      fileName: string,
      content: string,
    ) => string | null;
  },
): Promise<ImportLogicalResult> {
  const importedPaths: string[] = [];
  const foldersToExpand = new Set<string>();
  let skippedInvalid = 0;
  let skippedUnsupported = options.skippedUnsupported ?? 0;
  let readFailureName: string | null = null;

  for (const file of files) {
    if (isVaultImportUnsupported(file.name)) {
      skippedUnsupported += 1;
      continue;
    }

    const destination = resolveImportDestination(
      options.vaultId,
      options.parentPath,
      file.relativePath,
      options.ensureFolder,
    );
    if (!destination) {
      skippedInvalid += 1;
      continue;
    }

    let content = "";
    try {
      content = await options.readContent(file);
    } catch (error) {
      if (isUnsupportedRead(error)) {
        skippedUnsupported += 1;
        continue;
      }
      readFailureName = file.name;
      continue;
    }

    const path = options.importFile(
      options.vaultId,
      destination.parentPath,
      destination.fileName,
      content,
    );
    if (!path) {
      skippedInvalid += 1;
      continue;
    }
    importedPaths.push(path);
    for (const folderPath of foldersToExpandOnImport(options.parentPath, file.relativePath)) {
      foldersToExpand.add(folderPath);
    }
  }

  return {
    importedPaths,
    foldersToExpand: [...foldersToExpand],
    skippedInvalid,
    skippedUnsupported,
    readFailureName,
  };
}

export function importBatchIsReadFailure(result: ImportLogicalResult): boolean {
  return (
    result.importedPaths.length === 0 &&
    result.readFailureName !== null &&
    result.skippedInvalid === 0 &&
    result.skippedUnsupported === 0
  );
}

export function applyImportedFilesToWorkspace(
  result: ImportLogicalResult,
  dispatch: (action: VaultWorkspaceAction) => void,
  syncTree: () => void,
): void {
  if (result.importedPaths.length === 0) return;
  syncTree();
  for (const path of result.foldersToExpand) {
    dispatch({ type: "expand_folder", path });
  }
  dispatch({ type: "mark_session_created", paths: result.importedPaths });
}
