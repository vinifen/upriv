export type FileTreeNodeType = "file" | "folder";

/**
 * What keeps a file from being read in full: its data is gone (`missing`) or
 * fails its integrity check (`damaged`). The file stays in the vault, marked,
 * until it is deleted or written again.
 */
export type FileProblem = "missing" | "damaged";

export function isFileProblem(value: unknown): value is FileProblem {
  return value === "missing" || value === "damaged";
}

export interface FileTreeNode {
  name: string;
  type: FileTreeNodeType;
  children?: FileTreeNode[];
  /** In the plain-text folder right now. Only a vault of chosen files sets it. */
  inFolder?: boolean;
  /** Files only: why this file cannot be read in full. */
  problem?: FileProblem;
}

export type VaultFileLanguage = "markdown" | "text" | "shell" | "env" | "image" | "binary";

export interface VaultFileContent {
  content: string;
  language: VaultFileLanguage;
}
