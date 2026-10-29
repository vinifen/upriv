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
  | { type: "close_tabs"; paths: string[] }
  | { type: "dismiss_workspace" }
  /** Lock / close-all: after save or discard, close the vault. */
  | { type: "close_vault" }
  /** Lock while an import is still writing. Cancel continues into close. */
  | { type: "close_vault_import" }
  | { type: "import_in_progress" };

/** VS Code-style explorer cue: created (green) outranks modified (accent). */
export type SessionPathKind = "created" | "modified";

/** Vault-wide markdown surface. One choice applies to every `.md` file. */
export type MarkdownViewMode = "preview" | "source";

export function markdownViewMode(value: unknown): MarkdownViewMode {
  return value === "source" ? "source" : "preview";
}

/**
 * Per-file view, outline, word wrap, and in-file search. A missing field uses the
 * default: Read (`preview`), outline shown, wrapped, no search.
 */
export interface PerFileWorkspaceState {
  markdownView?: MarkdownViewMode;
  markdownOutlineOpen?: boolean;
  searchQuery?: string;
  wordWrap?: boolean;
}

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
  /**
   * Explorer hidden behind its toggle button. Per vault, persisted on
   * `.upriv-workspace.json`. RAM default is shown.
   */
  explorerCollapsed: boolean;
  /**
   * Per-file view mode, outline visibility, word wrap, and search state.
   * Keyed by logical file path (e.g. `/readme.md`).
   * Persisted on `.upriv-workspace.json`.
   */
  fileStates: Record<string, PerFileWorkspaceState>;
  /**
   * Explorer/editor divider split width (canonical integer % of the FM pane, 4–65).
   * Per vault, persisted on `.upriv-workspace.json`. Null uses `TREE_SPLIT_DEFAULT_PERCENT`.
   */
  treeSplitPercent: number | null;
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
    explorerCollapsed: false,
    fileStates: {},
    treeSplitPercent: null,
  };
}

function fileState(
  state: VaultWorkspaceState,
  path: string | null,
): PerFileWorkspaceState | undefined {
  return path ? state.fileStates[path] : undefined;
}

export function fileMarkdownView(
  state: VaultWorkspaceState,
  path: string | null,
): MarkdownViewMode {
  return fileState(state, path)?.markdownView ?? "preview";
}

export function fileMarkdownOutlineOpen(state: VaultWorkspaceState, path: string | null): boolean {
  return fileState(state, path)?.markdownOutlineOpen ?? true;
}

export function fileEditorWordWrap(state: VaultWorkspaceState, path: string | null): boolean {
  return fileState(state, path)?.wordWrap ?? true;
}

export function fileSearchQuery(state: VaultWorkspaceState, path: string | null): string {
  return fileState(state, path)?.searchQuery ?? "";
}

export function isPathDirty(state: VaultWorkspaceState, path: string): boolean {
  return state.dirtyPaths.includes(path);
}

export function hasUnsavedWorkspaceChanges(state: VaultWorkspaceState): boolean {
  return state.dirtyPaths.length > 0;
}

/**
 * Each listed path and every folder above it, built once per list. The
 * workspace lists are replaced, never edited, so a list keeps its set; the
 * explorer asks once per row on every render.
 */
const listedWithAncestors = new WeakMap<readonly string[], ReadonlySet<string>>();

function pathsWithAncestors(paths: readonly string[]): ReadonlySet<string> {
  const cached = listedWithAncestors.get(paths);
  if (cached) return cached;
  const marked = new Set<string>();
  for (const path of paths) {
    // A path already marked has its folders marked too.
    for (let current = path; !marked.has(current);) {
      marked.add(current);
      if (current === "/") break;
      const slash = current.lastIndexOf("/");
      current = slash <= 0 ? "/" : current.slice(0, slash);
    }
  }
  listedWithAncestors.set(paths, marked);
  return marked;
}

/** `path` is listed, or a folder above something listed. */
function pathOrDescendantInList(paths: readonly string[], path: string): boolean {
  return pathsWithAncestors(paths).has(path);
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
