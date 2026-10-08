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

function createImportIndexSeal(sealImports: (() => Promise<void>) | undefined) {
  return {
    async finish() {
      if (sealImports) await sealImports();
    },
  };
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
    /**
     * How many files to read and encrypt at once. `1` keeps the batch serial.
     * Only byte imports use more than one. Text imports stay one file at a time.
     */
    importSlots?: number;
    /**
     * Seal staged blobs once, after the last file in this batch. A file does
     * not wait on the index write.
     */
    sealImports?: () => Promise<void>;
  },
): Promise<ImportLogicalResult> {
  const slots = Math.max(1, Math.floor(options.importSlots ?? 1));
  const importBinaryFile = options.importBinaryFile;
  const seal = createImportIndexSeal(options.sealImports);
  try {
    if (slots > 1 && importBinaryFile) {
      return await importBinaryFilesAhead(files, options, importBinaryFile, slots, seal);
    }
    return await importLogicalFilesOneAtATime(files, options, seal);
  } finally {
    await seal.finish();
  }
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
    importBinaryFile?: (
      vaultId: string,
      parentPath: string,
      fileName: string,
      file: T,
    ) => string | null | Promise<string | null>;
    signal?: AbortSignal;
  },
  _seal: { finish: () => Promise<void> },
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
    signal?: AbortSignal;
  },
  importBinaryFile: (
    vaultId: string,
    parentPath: string,
    fileName: string,
    file: T,
  ) => string | null | Promise<string | null>,
  slots: number,
  _seal: { finish: () => Promise<void> },
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
      } catch {
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
      options.onImportStart?.(
        joinPath(destination.parentPath, destination.fileName),
        file.relativePath,
      );
      let path: string | null;
      try {
        path = await importBinaryFile(
          options.vaultId,
          destination.parentPath,
          destination.fileName,
          file,
        );
      } catch {
        outcomes[index] = { kind: "write-fail" };
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
