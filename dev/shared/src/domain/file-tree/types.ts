export type FileTreeNodeType = "file" | "folder";

export interface FileTreeNode {
  name: string;
  type: FileTreeNodeType;
  children?: FileTreeNode[];
}

export type VaultFileLanguage = "markdown" | "text" | "shell" | "env" | "image" | "binary";

export interface VaultFileContent {
  content: string;
  language: VaultFileLanguage;
}
