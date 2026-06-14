import type { VaultFileSystemService } from "@upriv/shared";
import {
  createVaultFile,
  createVaultFolder,
  deleteVaultPath,
  ensureVaultFolder,
  getVaultFileContent,
  getVaultFileTree,
  getVaultTreeRevision,
  importVaultFile,
  isVaultFileEditable,
  isVaultFileImage,
  isVaultFileViewable,
  moveVaultPath,
  renameVaultPath,
  resetVaultFileSession,
  setVaultFileContent,
  vaultFileLanguageFromPath,
} from "@/platform/mocks/stores/fileSystem";

/** Prototype workspace FS — in-memory tree until FUSE/mount is wired. */
export const mockVaultFileSystemService: VaultFileSystemService = {
  resetSession: resetVaultFileSession,
  getTreeRevision: getVaultTreeRevision,
  getFileTree: getVaultFileTree,
  getFileContent: getVaultFileContent,
  isFileEditable: isVaultFileEditable,
  isFileViewable: isVaultFileViewable,
  isFileImage: isVaultFileImage,
  setFileContent: setVaultFileContent,
  createFile: createVaultFile,
  importFile: importVaultFile,
  createFolder: createVaultFolder,
  ensureFolder: ensureVaultFolder,
  renamePath: renameVaultPath,
  deletePath: deleteVaultPath,
  movePath: moveVaultPath,
  languageFromPath: vaultFileLanguageFromPath,
};
