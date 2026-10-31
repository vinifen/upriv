import type { FileTreeNode, VaultFileContent, VaultFileLanguage } from "../../domain/file-tree";

/** Slice-only byte source so large files never sit in RAM as one buffer. */
export interface VaultBinaryByteSource {
  /** Known length, `0` for empty, or `< 0` to stream until a short read. */
  size: number;
  slice(start: number, end: number): Promise<Uint8Array>;
}

/** A file still being written elsewhere stays in the folder and counts as `kept`. */
export interface FolderRemoval {
  removed: number;
  kept: number;
}

/**
 * Open-vault workspace file tree. Mutations persist into `store/` via the
 * daemon / FFI. Path-kind helpers stay sync (extension only).
 */
export interface VaultFileSystemService {
  resetSession(vaultId: string): void;
  getTreeRevision(vaultId: string): Promise<number>;
  getFileTree(vaultId: string): Promise<FileTreeNode>;
  getFileContent(vaultId: string, path: string): Promise<VaultFileContent | null>;
  /** Free RAM can hold a preview of this file. */
  previewFits(vaultId: string, path: string): Promise<boolean>;
  isFileEditable(vaultId: string, path: string): boolean;
  isFileViewable(vaultId: string, path: string): boolean;
  isFileImage(vaultId: string, path: string): boolean;
  setFileContent(vaultId: string, path: string, content: string): Promise<number>;
  createFile(vaultId: string, parentPath: string, baseName: string): Promise<string | null>;
  importFile(
    vaultId: string,
    parentPath: string,
    fileName: string,
    content: string,
  ): Promise<string | null>;
  importFileFromBytes(
    vaultId: string,
    parentPath: string,
    fileName: string,
    source: VaultBinaryByteSource,
  ): Promise<string | null>;
  /**
   * Daemon/FFI streams `osPath` into `store/` (no renderer/JSON file bytes).
   * The file is in the sealed index when this resolves.
   */
  importFileFromOsPath(
    vaultId: string,
    parentPath: string,
    fileName: string,
    osPath: string,
  ): Promise<string | null>;
  createFolder(vaultId: string, parentPath: string, baseName: string): Promise<string | null>;
  ensureFolder(vaultId: string, parentPath: string, folderName: string): Promise<string | null>;
  renamePath(vaultId: string, path: string, newName: string): Promise<string | null>;
  deletePath(vaultId: string, path: string): Promise<boolean>;
  movePath(vaultId: string, fromPath: string, toFolderPath: string): Promise<string | null>;
  /**
   * Absolute OS path of `path` on the live FUSE/WinFsp mount.
   * `null` when this vault has no OS folder (switch off, macOS, or mobile).
   */
  osPath(vaultId: string, path: string): Promise<string | null>;
  /** Put these paths in a plain-text vault's folder. Resolves to how many files go there. */
  sendToFolder(vaultId: string, paths: string[]): Promise<number>;
  /** Take these paths out of a plain-text vault's folder. The vault keeps them. */
  removeFromFolder(vaultId: string, paths: string[]): Promise<FolderRemoval>;
  languageFromPath(path: string): VaultFileLanguage;
}
