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
  | { type: "dismiss_workspace" }
  | { type: "import_in_progress" };

/** VS Code-style explorer cue: created (green) outranks modified (accent). */
export type SessionPathKind = "created" | "modified";

export interface VaultWorkspaceState {
  expandedPaths: string[];
  /**
   * Folders the user collapsed. Import and other automatic expands skip these
   * until the user opens the folder again. RAM-only; not written to the snapshot.
   */
  userCollapsedPaths: string[];
  openTabs: string[];
  activeTabPath: string | null;
  selectedPath: string | null;
  treeRevision: number;
  editorDrafts: Record<string, string>;
  dirtyPaths: string[];
  /**
   * Paths created this file-manager session (create / import).
   * RAM-only. Explorer icon uses vault-status-open (green); folders inherit
   * with priority over modified (VS Code-style).
   */
  sessionCreatedPaths: string[];
  /**
   * Paths modified this session (save / rename / move of an existing path).
   * RAM-only. Explorer icon uses accent. A path in `sessionCreatedPaths` stays
   * “created” even after later edits.
   */
  sessionModifiedPaths: string[];
  renamingPath: string | null;
  contextMenu: FileContextMenuState | null;
  deleteTarget: FileDeleteTarget | null;
  unsavedPrompt: UnsavedPromptAction | null;
  dragSourcePath: string | null;
  dropTargetPath: string | null;
}

export function createDefaultWorkspaceState(): VaultWorkspaceState {
  return {
    expandedPaths: ["/"],
    userCollapsedPaths: [],
    openTabs: [],
    activeTabPath: null,
    selectedPath: null,
    treeRevision: 0,
    editorDrafts: {},
    dirtyPaths: [],
    sessionCreatedPaths: [],
    sessionModifiedPaths: [],
    renamingPath: null,
    contextMenu: null,
    deleteTarget: null,
    unsavedPrompt: null,
    dragSourcePath: null,
    dropTargetPath: null,
  };
}

export function isPathDirty(state: VaultWorkspaceState, path: string): boolean {
  return state.dirtyPaths.includes(path);
}

export function hasUnsavedWorkspaceChanges(state: VaultWorkspaceState): boolean {
  return state.dirtyPaths.length > 0;
}

function pathOrDescendantInList(paths: readonly string[], path: string): boolean {
  if (paths.includes(path)) return true;
  if (path === "/") return paths.some((p) => p !== "/");
  const prefix = `${path}/`;
  return paths.some((p) => p.startsWith(prefix));
}

/**
 * Session cue for a file/folder icon (self or any descendant).
 * Created wins over modified — same priority as VS Code source-control colors.
 */
export function sessionPathKind(state: VaultWorkspaceState, path: string): SessionPathKind | null {
  if (pathOrDescendantInList(state.sessionCreatedPaths, path)) return "created";
  if (
    pathOrDescendantInList(state.sessionModifiedPaths, path) ||
    pathOrDescendantInList(state.dirtyPaths, path)
  ) {
    return "modified";
  }
  return null;
}

/** @deprecated Prefer `sessionPathKind` — kept for call sites that only need a boolean. */
export function isPathSessionModified(state: VaultWorkspaceState, path: string): boolean {
  return sessionPathKind(state, path) !== null;
}
