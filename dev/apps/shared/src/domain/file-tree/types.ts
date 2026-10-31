export type FileTreeNodeType = "file" | "folder";

export interface FileTreeNode {
  name: string;
  type: FileTreeNodeType;
  children?: FileTreeNode[];
  /** In the plain-text folder right now. Only a vault of chosen files sets it. */
  inFolder?: boolean;
}

export type VaultFileLanguage = "markdown" | "text" | "shell" | "env" | "image" | "binary";

export interface VaultFileContent {
  content: string;
  language: VaultFileLanguage;
}
