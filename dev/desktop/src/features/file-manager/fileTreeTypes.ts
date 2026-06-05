import { TREE_SPLIT_DEFAULT_PERCENT } from "./treeSplit";

export type FileTreeNodeType = "file" | "folder";

export interface FileTreeNode {
  name: string;
  type: FileTreeNodeType;
  children?: FileTreeNode[];
}

export type MockFileLanguage = "markdown" | "text" | "shell" | "env" | "binary";

export interface MockFileContent {
  content: string;
  language: MockFileLanguage;
}

export interface FileContextMenuState {
  x: number;
  y: number;
  path: string;
}

export interface FileDeleteTarget {
  path: string;
  name: string;
  isFolder: boolean;
}

export type UnsavedPromptAction = { type: "close_tab"; path: string };

export interface VaultWorkspaceState {
  expandedPaths: string[];
  openTabs: string[];
  activeTabPath: string | null;
  selectedPath: string | null;
  treeSplitPercent: number;
  treeRevision: number;
  editorDrafts: Record<string, string>;
  dirtyPaths: string[];
  renamingPath: string | null;
  contextMenu: FileContextMenuState | null;
  deleteTarget: FileDeleteTarget | null;
  unsavedPrompt: UnsavedPromptAction | null;
  dragSourcePath: string | null;
  dropTargetPath: string | null;
  toastMessage: string | null;
}

export function createDefaultWorkspaceState(): VaultWorkspaceState {
  return {
    expandedPaths: ["/"],
    openTabs: [],
    activeTabPath: null,
    selectedPath: null,
    treeSplitPercent: TREE_SPLIT_DEFAULT_PERCENT,
    treeRevision: 0,
    editorDrafts: {},
    dirtyPaths: [],
    renamingPath: null,
    contextMenu: null,
    deleteTarget: null,
    unsavedPrompt: null,
    dragSourcePath: null,
    dropTargetPath: null,
    toastMessage: null,
  };
}

export function isPathDirty(state: VaultWorkspaceState, path: string): boolean {
  return state.dirtyPaths.includes(path);
}
