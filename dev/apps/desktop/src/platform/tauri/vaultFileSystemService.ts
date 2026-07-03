import type { VaultFileSystemService } from "@upriv/shared";
import {
  createFile,
  createFolder,
  deletePath,
  ensureFolder,
  getFileContent,
  getFileTree,
  getTreeRevision,
  importFile,
  importHostFolder,
  isFileEditable,
  isFileImage,
  isFileViewable,
  languageFromPath,
  movePath,
  renamePath,
  resetWorkspaceSession,
  setFileContent,
} from "./workspaceFsStore";

/** Tauri workspace FS — mirrors the open vault's `workspace/` directory on disk. */
export function createTauriVaultFileSystemService(): VaultFileSystemService {
  return {
    resetSession: resetWorkspaceSession,
    getTreeRevision,
    getFileTree,
    getFileContent,
    isFileEditable,
    isFileViewable,
    isFileImage,
    setFileContent,
    createFile,
    importFile,
    importHostFolder,
    createFolder,
    ensureFolder,
    renamePath,
    deletePath,
    movePath,
    languageFromPath,
  };
}
