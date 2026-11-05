import {
  foldersToExpandOnImport,
  resolveImportDestination,
  type EnsureFolderFn,
} from "../file-tree/importPaths";
import { isRpcError } from "../core-rpc/errors";
import { joinPath } from "../file-tree/treeUtils";
import { VAULT_ERROR_CODES } from "../vault/errors/codes";
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

/**
 * Core refused the file because its folder was deleted while the batch ran.
 * The person removed that folder, so the file is dropped, not a failure, and
 * the rest of the batch goes on.
 */
function folderWasDeleted(error: unknown): boolean {
  return isRpcError(error) && error.code === VAULT_ERROR_CODES.PATH_NOT_FOUND;
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
    /** A started file whose folder was deleted meanwhile: it is dropped. */
    onImportDropped?: (path: string, relativePath: string) => void;
    /** Preferred: stream bytes (any type). Skips `readContent`. */
    importBinaryFile?: (
      vaultId: string,
      parentPath: string,
      fileName: string,
      file: T,
    ) => string | null | Promise<string | null>;
    /** Stop before starting the next file. The write already in flight still finishes. */
    signal?: AbortSignal;
    /**
     * How many files to read and encrypt at once. `1` keeps the batch serial.
     * Only byte imports use more than one. Text imports stay one file at a time.
     */
    importSlots?: number;
  },
): Promise<ImportLogicalResult> {
  const slots = Math.max(1, Math.floor(options.importSlots ?? 1));
  const importBinaryFile = options.importBinaryFile;
  const batch = { ...options, ensureFolder: ensureEachFolderOnce(options.ensureFolder) };
  if (slots > 1 && importBinaryFile) {
    return importBinaryFilesAhead(files, batch, importBinaryFile, slots);
  }
  return importLogicalFilesOneAtATime(files, batch);
}

/**
 * Ask core for each folder once per batch: every later file in the same
 * folder reuses its path. A folder deleted meanwhile is not made again: core
 * refuses each file whose folder is gone, and the batch drops it.
 */
function ensureEachFolderOnce(ensureFolder: EnsureFolderFn): EnsureFolderFn {
  const known = new Map<string, string>();
  return async (vaultId, parentPath, name) => {
    const key = `${parentPath}\u0000${name}`;
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    const path = await ensureFolder(vaultId, parentPath, name);
    if (path) known.set(key, path);
    return path;
  };
}

async function importLogicalFilesOneAtATime<T extends ImportLogicalFile>(
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
    onImported?: (path: string, relativePath: string) => void | Promise<void>;
    onImportStart?: (path: string, relativePath: string) => void;
    onImportDropped?: (path: string, relativePath: string) => void;
    importBinaryFile?: (
      vaultId: string,
      parentPath: string,
      fileName: string,
      file: T,
    ) => string | null | Promise<string | null>;
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
    } catch (error) {
      if (folderWasDeleted(error)) continue;
      writeFailureName = file.name;
      break;
    }
    if (options.signal?.aborted) break;
    if (!destination || isInternalVaultFileName(destination.fileName)) {
      skippedInvalid += 1;
      continue;
    }

    const target = joinPath(destination.parentPath, destination.fileName);
    options.onImportStart?.(target, file.relativePath);

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
    } catch (error) {
      if (folderWasDeleted(error)) {
        options.onImportDropped?.(target, file.relativePath);
        continue;
      }
      // A write stopped with the rest of the batch is not a failure.
      if (!options.signal?.aborted) writeFailureName = file.name;
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

/** `absent` is a file never written: stopped, or its folder was deleted meanwhile. */
type AheadOutcome =
  | { kind: "absent" }
  | { kind: "skip-invalid" }
  | { kind: "imported"; path: string }
  | { kind: "write-fail" };

/** Byte imports. Folder creation stays in order. Writes overlap up to `slots`. */
async function importBinaryFilesAhead<T extends ImportLogicalFile>(
  files: readonly T[],
  options: {
    vaultId: string;
    parentPath: string;
    skippedUnsupported?: number;
    ensureFolder: (
      vaultId: string,
      parentPath: string,
      name: string,
    ) => string | null | Promise<string | null>;
    onImported?: (path: string, relativePath: string) => void | Promise<void>;
    onImportStart?: (path: string, relativePath: string) => void;
    onImportDropped?: (path: string, relativePath: string) => void;
    signal?: AbortSignal;
  },
  importBinaryFile: (
    vaultId: string,
    parentPath: string,
    fileName: string,
    file: T,
  ) => string | null | Promise<string | null>,
  slots: number,
): Promise<ImportLogicalResult> {
  const outcomes: AheadOutcome[] = files.map(() => ({ kind: "absent" }));
  let cursor = 0;
  let stop = false;
  let folderGate: Promise<void> = Promise.resolve();
  const withFolders = <R>(run: () => Promise<R> | R): Promise<R> => {
    const next = folderGate.then(run, run);
    folderGate = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const worker = async () => {
    for (;;) {
      if (stop || options.signal?.aborted) {
        stop = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= files.length) return;
      const file = files[index];
      if (!file) return;
      if (isInternalVaultFileName(file.name)) {
        outcomes[index] = { kind: "skip-invalid" };
        continue;
      }
      let destination: { parentPath: string; fileName: string } | null;
      try {
        destination = await withFolders(() =>
          resolveImportDestination(
            options.vaultId,
            options.parentPath,
            file.relativePath,
            options.ensureFolder,
          ),
        );
      } catch (error) {
        if (folderWasDeleted(error)) continue;
        outcomes[index] = { kind: "write-fail" };
        stop = true;
        return;
      }
      if (stop || options.signal?.aborted) {
        stop = true;
        outcomes[index] = { kind: "absent" };
        return;
      }
      if (!destination || isInternalVaultFileName(destination.fileName)) {
        outcomes[index] = { kind: "skip-invalid" };
        continue;
      }
      const target = joinPath(destination.parentPath, destination.fileName);
      options.onImportStart?.(target, file.relativePath);
      let path: string | null;
      try {
        path = await importBinaryFile(
          options.vaultId,
          destination.parentPath,
          destination.fileName,
          file,
        );
      } catch (error) {
        if (folderWasDeleted(error)) {
          options.onImportDropped?.(target, file.relativePath);
          continue;
        }
        // A write stopped with the rest of the batch is not a failure.
        outcomes[index] = options.signal?.aborted ? { kind: "absent" } : { kind: "write-fail" };
        stop = true;
        return;
      }
      if (!path) {
        outcomes[index] = { kind: "skip-invalid" };
        continue;
      }
      outcomes[index] = { kind: "imported", path };
      await options.onImported?.(path, file.relativePath);
    }
  };

  if (files.length > 0) {
    await Promise.all(Array.from({ length: Math.min(slots, files.length) }, () => worker()));
  }

  const importedPaths: string[] = [];
  const foldersToExpand = new Set<string>();
  let skippedInvalid = 0;
  let writeFailureName: string | null = null;
  files.forEach((file, index) => {
    const outcome = outcomes[index];
    if (!outcome || outcome.kind === "absent") return;
    if (outcome.kind === "skip-invalid") {
      skippedInvalid += 1;
      return;
    }
    if (outcome.kind === "write-fail") {
      writeFailureName ??= file.name;
      return;
    }
    importedPaths.push(outcome.path);
    for (const folderPath of foldersToExpandOnImport(options.parentPath, file.relativePath)) {
      foldersToExpand.add(folderPath);
    }
  });

  return {
    importedPaths,
    foldersToExpand: [...foldersToExpand],
    skippedInvalid,
    skippedUnsupported: options.skippedUnsupported ?? 0,
    readFailureName: null,
    writeFailureName,
  };
}
