import { createLiveVaultFileSystemService } from "@upriv/shared";
import {
  rpcVaultFsCreateFile,
  rpcVaultFsCreateFolder,
  rpcVaultFsDelete,
  rpcVaultFsEnsureFolder,
  rpcVaultFsImportOsFile,
  rpcVaultFsList,
  rpcVaultFsMove,
  rpcVaultFsOsPath,
  rpcVaultFsRead,
  rpcVaultFsReadRange,
  rpcVaultFsRename,
  rpcVaultFsRevision,
  rpcVaultFsTruncate,
  rpcVaultFsWrite,
  rpcVaultFsWriteRange,
} from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable } from "./safVaultRpcGuard";

function withSaf<T>(run: () => Promise<T>): Promise<T> {
  assertSafVaultPathRpcAvailable();
  return run();
}

/** Native → `upriv-ffi` `vault_fs_*` (skipped on SAF trees). */
export const nativeVaultFileSystemService = createLiveVaultFileSystemService({
  list: (id) => withSaf(() => rpcVaultFsList(id)),
  revision: (id) => withSaf(() => rpcVaultFsRevision(id)),
  read: (id, path) => withSaf(() => rpcVaultFsRead(id, path)),
  readRange: (id, path, offset, len) => withSaf(() => rpcVaultFsReadRange(id, path, offset, len)),
  write: (id, path, contentB64) => withSaf(() => rpcVaultFsWrite(id, path, contentB64)),
  writeRange: (id, path, offset, contentB64) =>
    withSaf(() => rpcVaultFsWriteRange(id, path, offset, contentB64)),
  importOsFile: (id, parentPath, name, osPath) =>
    withSaf(() => rpcVaultFsImportOsFile(id, parentPath, name, osPath)),
  truncate: (id, path, size) => withSaf(() => rpcVaultFsTruncate(id, path, size)),
  createFile: (id, parentPath, name) => withSaf(() => rpcVaultFsCreateFile(id, parentPath, name)),
  createFolder: (id, parentPath, name) =>
    withSaf(() => rpcVaultFsCreateFolder(id, parentPath, name)),
  ensureFolder: (id, parentPath, name) =>
    withSaf(() => rpcVaultFsEnsureFolder(id, parentPath, name)),
  delete: (id, path) => withSaf(() => rpcVaultFsDelete(id, path)),
  rename: (id, path, newName) => withSaf(() => rpcVaultFsRename(id, path, newName)),
  move: (id, fromPath, toFolderPath) => withSaf(() => rpcVaultFsMove(id, fromPath, toFolderPath)),
  osPath: (id, path) => withSaf(() => rpcVaultFsOsPath(id, path)),
});
