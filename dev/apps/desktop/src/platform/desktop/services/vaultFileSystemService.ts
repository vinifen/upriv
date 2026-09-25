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

/** Desktop → daemon `vault_fs_*`. */
export const desktopVaultFileSystemService = createLiveVaultFileSystemService({
  list: (id) => rpcVaultFsList(id),
  revision: (id) => rpcVaultFsRevision(id),
  read: (id, path) => rpcVaultFsRead(id, path),
  readRange: (id, path, offset, len) => rpcVaultFsReadRange(id, path, offset, len),
  write: (id, path, contentB64) => rpcVaultFsWrite(id, path, contentB64),
  writeRange: (id, path, offset, contentB64) => rpcVaultFsWriteRange(id, path, offset, contentB64),
  importOsFile: (id, parentPath, name, osPath) =>
    rpcVaultFsImportOsFile(id, parentPath, name, osPath),
  truncate: (id, path, size) => rpcVaultFsTruncate(id, path, size),
  createFile: (id, parentPath, name) => rpcVaultFsCreateFile(id, parentPath, name),
  createFolder: (id, parentPath, name) => rpcVaultFsCreateFolder(id, parentPath, name),
  ensureFolder: (id, parentPath, name) => rpcVaultFsEnsureFolder(id, parentPath, name),
  delete: (id, path) => rpcVaultFsDelete(id, path),
  rename: (id, path, newName) => rpcVaultFsRename(id, path, newName),
  move: (id, fromPath, toFolderPath) => rpcVaultFsMove(id, fromPath, toFolderPath),
  osPath: (id, path) => rpcVaultFsOsPath(id, path),
});
