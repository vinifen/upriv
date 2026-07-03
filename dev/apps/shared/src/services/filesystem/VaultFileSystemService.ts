import type { FileTreeNode, VaultFileContent, VaultFileLanguage } from "../../domain/file-tree";

/**
 * Open-vault workspace file tree (mock in-memory today; mount/FUSE via desktop later).
 * Sync API — operations run against the active session while a vault is open.
 */
export interface VaultFileSystemService {
  resetSession(vaultId: string): void;
  getTreeRevision(vaultId: string): number;
  getFileTree(vaultId: string): FileTreeNode;
  getFileContent(vaultId: string, path: string): VaultFileContent | null;
  isFileEditable(vaultId: string, path: string): boolean;
  isFileViewable(vaultId: string, path: string): boolean;
  isFileImage(vaultId: string, path: string): boolean;
  setFileContent(vaultId: string, path: string, content: string): number;
  createFile(vaultId: string, parentPath: string, baseName: string): string | null;
  importFile(vaultId: string, parentPath: string, fileName: string, content: string): string | null;
  createFolder(vaultId: string, parentPath: string, baseName: string): string | null;
  ensureFolder(vaultId: string, parentPath: string, folderName: string): string | null;
  renamePath(vaultId: string, path: string, newName: string): string | null;
  deletePath(vaultId: string, path: string): boolean;
  movePath(vaultId: string, fromPath: string, toFolderPath: string): string | null;
  languageFromPath(path: string): VaultFileLanguage;
}
