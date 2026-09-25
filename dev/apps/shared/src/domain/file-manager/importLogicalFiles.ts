import type { VaultWorkspaceAction } from "./workspaceReducer";
import { foldersToExpandOnImport, resolveImportDestination } from "../file-tree/importPaths";
import { joinPath } from "../file-tree/treeUtils";
import { isInternalVaultFileName } from "./workspaceSnapshot";

export interface ImportLogicalFile {
  name: string;
  relativePath: string;
  mime?: string;
  /** Absolute OS path for daemon `vault_fs_import_os_file`. */
  osPath?: string;
}

export interface ImportLogicalResult {
  importedPaths: string[];
  foldersToExpand: string[];
  skippedInvalid: number;
  skippedUnsupported: number;
  readFailureName: string | null;
  writeFailureName: string | null;
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
    ensureFolder: (
      vaultId: string,
      parentPath: string,
      name: string,
    ) => string | null | Promise<string | null>;
    importFile: (
      vaultId: string,
      parentPath: string,
      fileName: string,
      content: string,
    ) => string | null | Promise<string | null>;
    /** Called after each successful store, before the next file. */
    onImported?: (path: string, relativePath: string) => void | Promise<void>;
    /** Called once the destination is known, immediately before the write. */
    onImportStart?: (path: string, relativePath: string) => void;
    /** Preferred: stream bytes (any type). Skips `readContent`. */
    importBinaryFile?: (
      vaultId: string,
      parentPath: string,
      fileName: string,
      file: T,
    ) => string | null | Promise<string | null>;
    /** Stop before starting the next file. The write already in flight still finishes. */
    signal?: AbortSignal;
  },
): Promise<ImportLogicalResult> {
  const importedPaths: string[] = [];
  const foldersToExpand = new Set<string>();
  let skippedInvalid = 0;
  let skippedUnsupported = options.skippedUnsupported ?? 0;
  let readFailureName: string | null = null;
  let writeFailureName: string | null = null;

  for (const file of files) {
    if (options.signal?.aborted) break;
    if (isInternalVaultFileName(file.name)) {
      skippedInvalid += 1;
      continue;
    }

    let destination: { parentPath: string; fileName: string } | null;
    try {
      destination = await resolveImportDestination(
        options.vaultId,
        options.parentPath,
        file.relativePath,
        options.ensureFolder,
      );
    } catch {
      writeFailureName = file.name;
      break;
    }
    if (options.signal?.aborted) break;
    if (!destination || isInternalVaultFileName(destination.fileName)) {
      skippedInvalid += 1;
      continue;
    }

    options.onImportStart?.(
      joinPath(destination.parentPath, destination.fileName),
      file.relativePath,
    );

    let path: string | null = null;
    try {
      if (options.importBinaryFile) {
        path = await options.importBinaryFile(
          options.vaultId,
          destination.parentPath,
          destination.fileName,
          file,
        );
      } else {
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
        path = await options.importFile(
          options.vaultId,
          destination.parentPath,
          destination.fileName,
          content,
        );
      }
    } catch {
      writeFailureName = file.name;
      break;
    }
    if (!path) {
      skippedInvalid += 1;
      continue;
    }
    importedPaths.push(path);
    await options.onImported?.(path, file.relativePath);
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
    writeFailureName,
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

export function importBatchIsWriteFailure(result: ImportLogicalResult): boolean {
  return (
    result.importedPaths.length === 0 &&
    result.writeFailureName !== null &&
    result.skippedInvalid === 0 &&
    result.skippedUnsupported === 0
  );
}

/** Keep leftover skeletons and offer Retry when any file failed to read or store. */
export function importBatchNeedsRetry(result: ImportLogicalResult): boolean {
  return result.readFailureName !== null || result.writeFailureName !== null;
}

export async function applyImportedFilesToWorkspace(
  result: ImportLogicalResult,
  dispatch: (action: VaultWorkspaceAction) => void,
  syncTree: () => void | Promise<void>,
): Promise<void> {
  if (result.importedPaths.length === 0) return;
  await syncTree();
  for (const path of result.foldersToExpand) {
    dispatch({ type: "expand_folder", path });
  }
  dispatch({ type: "mark_session_created", paths: result.importedPaths });
}
