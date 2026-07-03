import { TREE_SPLIT_DEFAULT_PERCENT } from "@upriv/shared";

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

export type UnsavedPromptAction =
  | { type: "close_tab"; path: string }
  | { type: "switch_tab"; toPath: string }
  | { type: "dismiss_workspace" };

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
  /** Paths with unsaved in-app edits that diverged from disk after an external change. */
  externalConflictPaths: string[];
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
    externalConflictPaths: [],
  };
}

export function isPathDirty(state: VaultWorkspaceState, path: string): boolean {
  return state.dirtyPaths.includes(path);
}

export function hasUnsavedWorkspaceChanges(state: VaultWorkspaceState): boolean {
  return state.dirtyPaths.length > 0;
}
