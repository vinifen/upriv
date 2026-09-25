import type { FileTreeNode, VaultFileContent, VaultFileLanguage } from "../../domain/file-tree";

/** Slice-only byte source so large files never sit in RAM as one buffer. */
export interface VaultBinaryByteSource {
  /** Known length, `0` for empty, or `< 0` to stream until a short read. */
  size: number;
  slice(start: number, end: number): Promise<Uint8Array>;
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
  /** Daemon/FFI streams `osPath` into `store/` (no renderer/JSON file bytes). */
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
   * Absolute OS path of `path` on the live FUSE/WinFsp (or `upriv_plain`) mount.
   * Throws `vault_mount_failed` when this vault is not mounted in the OS.
   */
  osPath(vaultId: string, path: string): Promise<string>;
  languageFromPath(path: string): VaultFileLanguage;
}
