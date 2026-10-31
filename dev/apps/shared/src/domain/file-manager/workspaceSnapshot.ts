import { clampCanonicalTreeSplitPercent, findNode, type FileTreeNode } from "../file-tree";
import type { PerFileWorkspaceState, VaultWorkspaceState } from "./workspaceTypes";

/** Logical file at vault root — encrypted in `store/` with the rest of the vault. */
export const UPRIV_WORKSPACE_FILE_NAME = ".upriv-workspace.json";
export const UPRIV_WORKSPACE_PATH = `/${UPRIV_WORKSPACE_FILE_NAME}`;

export const WORKSPACE_SNAPSHOT_FORMAT_VERSION = 1 as const;

export interface WorkspaceSnapshot {
  format_version: typeof WORKSPACE_SNAPSHOT_FORMAT_VERSION;
  openTabs: string[];
  activeTabPath: string | null;
  expandedPaths: string[];
  selectedPath: string | null;
  /** Missing or anything but `true` loads as shown. */
  explorerCollapsed: boolean;
  /** Missing or anything but `true` loads as closed. */
  explorerSearchOpen: boolean;
  /** Missing or not a string loads as no search. */
  explorerSearchQuery: string;
  /** Per-file view, outline, word wrap, and search. */
  files?: Record<string, PerFileWorkspaceState>;
  /** Vault-specific explorer/editor split percentage (4–65). */
  treeSplitPercent?: number | null;
}

export function isInternalVaultFileName(name: string): boolean {
  return name === UPRIV_WORKSPACE_FILE_NAME;
}

export function isInternalVaultPath(path: string): boolean {
  return path === UPRIV_WORKSPACE_PATH || path.endsWith(`/${UPRIV_WORKSPACE_FILE_NAME}`);
}

/** Strip reserved internal files from an explorer tree (source of truth stays on disk/session). */
export function omitInternalVaultNodes(node: FileTreeNode): FileTreeNode {
  if (node.type !== "folder" || !node.children?.length) return node;
  return {
    ...node,
    children: node.children
      .filter((child) => !isInternalVaultFileName(child.name))
      .map(omitInternalVaultNodes),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonEmptyString);
}

function dedupePaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

function parseFilesRecord(raw: unknown): Record<string, PerFileWorkspaceState> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, PerFileWorkspaceState> = {};
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNonEmptyString(path) || isInternalVaultPath(path)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const fileObj = entry as Record<string, unknown>;
    const fileState: PerFileWorkspaceState = {};
    if (fileObj.markdownView === "source" || fileObj.markdownView === "preview") {
      fileState.markdownView = fileObj.markdownView;
    }
    if (typeof fileObj.markdownOutlineOpen === "boolean") {
      fileState.markdownOutlineOpen = fileObj.markdownOutlineOpen;
    }
    if (typeof fileObj.searchQuery === "string") {
      fileState.searchQuery = fileObj.searchQuery;
    }
    if (typeof fileObj.wordWrap === "boolean") {
      fileState.wordWrap = fileObj.wordWrap;
    }
    if (Object.keys(fileState).length > 0) {
      out[path] = fileState;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseTreeSplitPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return clampCanonicalTreeSplitPercent(rounded);
}

/**
 * Parse raw JSON text. Corrupt / unknown versions → null (caller starts clean).
 * Does **not** check that paths exist — use `sanitizeWorkspaceSnapshot` for that.
 */
export function parseWorkspaceSnapshot(raw: string): WorkspaceSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.format_version !== WORKSPACE_SNAPSHOT_FORMAT_VERSION) return null;

  const openTabs = dedupePaths(asStringArray(obj.openTabs).filter((p) => !isInternalVaultPath(p)));
  const expandedPaths = dedupePaths(asStringArray(obj.expandedPaths));
  const activeTabPath =
    obj.activeTabPath === null || obj.activeTabPath === undefined
      ? null
      : isNonEmptyString(obj.activeTabPath) && !isInternalVaultPath(obj.activeTabPath)
        ? obj.activeTabPath
        : null;
  const selectedPath =
    obj.selectedPath === null || obj.selectedPath === undefined
      ? null
      : isNonEmptyString(obj.selectedPath) && !isInternalVaultPath(obj.selectedPath)
        ? obj.selectedPath
        : null;

  const files = parseFilesRecord(obj.files);
  const treeSplitPercent = parseTreeSplitPercent(obj.treeSplitPercent);

  return {
    format_version: WORKSPACE_SNAPSHOT_FORMAT_VERSION,
    openTabs,
    activeTabPath,
    expandedPaths,
    selectedPath,
    explorerCollapsed: obj.explorerCollapsed === true,
    explorerSearchOpen: obj.explorerSearchOpen === true,
    explorerSearchQuery: typeof obj.explorerSearchQuery === "string" ? obj.explorerSearchQuery : "",
    ...(files ? { files } : {}),
    ...(treeSplitPercent !== null ? { treeSplitPercent } : {}),
  };
}

export function serializeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
  const clean: Record<string, unknown> = {
    format_version: snapshot.format_version,
    openTabs: snapshot.openTabs,
    activeTabPath: snapshot.activeTabPath,
    expandedPaths: snapshot.expandedPaths,
    selectedPath: snapshot.selectedPath,
    explorerCollapsed: snapshot.explorerCollapsed,
    explorerSearchOpen: snapshot.explorerSearchOpen,
    explorerSearchQuery: snapshot.explorerSearchQuery,
  };
  if (snapshot.files && Object.keys(snapshot.files).length > 0) {
    clean.files = snapshot.files;
  }
  if (typeof snapshot.treeSplitPercent === "number") {
    clean.treeSplitPercent = snapshot.treeSplitPercent;
  }
  return `${JSON.stringify(clean, null, 2)}\n`;
}

function sanitizeFilesRecord(
  files: Record<string, PerFileWorkspaceState> | undefined,
  tree: FileTreeNode,
): Record<string, PerFileWorkspaceState> | undefined {
  if (!files) return undefined;
  const out: Record<string, PerFileWorkspaceState> = {};
  for (const [path, state] of Object.entries(files)) {
    if (isInternalVaultPath(path)) continue;
    const node = findNode(tree, path);
    if (node?.type === "file") {
      out[path] = state;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Vault tree is source of truth: drop tabs/folders/selection that no longer exist.
 * Always keeps `/` in expandedPaths.
 */
export function sanitizeWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  tree: FileTreeNode,
): WorkspaceSnapshot {
  const openTabs = dedupePaths(
    snapshot.openTabs.filter((path) => {
      if (isInternalVaultPath(path)) return false;
      const node = findNode(tree, path);
      return node?.type === "file";
    }),
  );

  let activeTabPath = snapshot.activeTabPath;
  if (!activeTabPath || !openTabs.includes(activeTabPath)) {
    activeTabPath = openTabs[openTabs.length - 1] ?? null;
  }

  const expandedPaths = dedupePaths(
    snapshot.expandedPaths.filter((path) => {
      if (path === "/") return true;
      if (isInternalVaultPath(path)) return false;
      return findNode(tree, path)?.type === "folder";
    }),
  );
  if (!expandedPaths.includes("/")) expandedPaths.unshift("/");

  let selectedPath = snapshot.selectedPath;
  if (selectedPath) {
    if (isInternalVaultPath(selectedPath) || !findNode(tree, selectedPath)) {
      selectedPath = activeTabPath;
    }
  } else {
    selectedPath = activeTabPath;
  }

  const files = sanitizeFilesRecord(snapshot.files, tree);

  return {
    format_version: WORKSPACE_SNAPSHOT_FORMAT_VERSION,
    openTabs,
    activeTabPath,
    expandedPaths,
    selectedPath,
    explorerCollapsed: snapshot.explorerCollapsed === true,
    explorerSearchOpen: snapshot.explorerSearchOpen === true,
    explorerSearchQuery: snapshot.explorerSearchQuery,
    ...(files ? { files } : {}),
    ...(typeof snapshot.treeSplitPercent === "number"
      ? { treeSplitPercent: snapshot.treeSplitPercent }
      : {}),
  };
}

export function workspaceSnapshotFromState(state: VaultWorkspaceState): WorkspaceSnapshot {
  const files: Record<string, PerFileWorkspaceState> = {};
  for (const [path, entry] of Object.entries(state.fileStates)) {
    if (!isInternalVaultPath(path) && Object.keys(entry).length > 0) {
      files[path] = entry;
    }
  }

  return {
    format_version: WORKSPACE_SNAPSHOT_FORMAT_VERSION,
    openTabs: state.openTabs.filter((p) => !isInternalVaultPath(p)),
    activeTabPath:
      state.activeTabPath && !isInternalVaultPath(state.activeTabPath) ? state.activeTabPath : null,
    expandedPaths: state.expandedPaths.length > 0 ? state.expandedPaths : ["/"],
    selectedPath:
      state.selectedPath && !isInternalVaultPath(state.selectedPath) ? state.selectedPath : null,
    explorerCollapsed: state.explorerCollapsed,
    explorerSearchOpen: state.explorerSearchOpen,
    explorerSearchQuery: state.explorerSearchQuery,
    ...(Object.keys(files).length > 0 ? { files } : {}),
    ...(typeof state.treeSplitPercent === "number"
      ? { treeSplitPercent: state.treeSplitPercent }
      : {}),
  };
}

function fileStatesEqual(
  a?: Record<string, PerFileWorkspaceState>,
  b?: Record<string, PerFileWorkspaceState>,
): boolean {
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const aVal = a?.[key];
    const bVal = b?.[key];
    if (!bVal) return false;
    const aSearchQuery = aVal?.searchQuery ?? "";
    const bSearchQuery = bVal?.searchQuery ?? "";
    if (
      aVal?.markdownView !== bVal?.markdownView ||
      aVal?.markdownOutlineOpen !== bVal?.markdownOutlineOpen ||
      aVal?.wordWrap !== bVal?.wordWrap ||
      aSearchQuery !== bSearchQuery
    ) {
      return false;
    }
  }
  return true;
}

export function snapshotsEqual(a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean {
  return (
    a.format_version === b.format_version &&
    a.activeTabPath === b.activeTabPath &&
    a.selectedPath === b.selectedPath &&
    a.openTabs.length === b.openTabs.length &&
    a.openTabs.every((path, index) => path === b.openTabs[index]) &&
    a.expandedPaths.length === b.expandedPaths.length &&
    a.expandedPaths.every((path, index) => path === b.expandedPaths[index]) &&
    a.explorerCollapsed === b.explorerCollapsed &&
    a.explorerSearchOpen === b.explorerSearchOpen &&
    a.explorerSearchQuery === b.explorerSearchQuery &&
    (a.treeSplitPercent ?? null) === (b.treeSplitPercent ?? null) &&
    fileStatesEqual(a.files, b.files)
  );
}

function fileLayoutIsCold(snapshot: WorkspaceSnapshot): boolean {
  return (
    snapshot.openTabs.length === 0 &&
    snapshot.activeTabPath === null &&
    snapshot.selectedPath === null &&
    snapshot.expandedPaths.length === 1 &&
    snapshot.expandedPaths[0] === "/"
  );
}

function sameFileLayout(a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean {
  return (
    a.activeTabPath === b.activeTabPath &&
    a.selectedPath === b.selectedPath &&
    a.openTabs.length === b.openTabs.length &&
    a.openTabs.every((path, index) => path === b.openTabs[index]) &&
    a.expandedPaths.length === b.expandedPaths.length &&
    a.expandedPaths.every((path, index) => path === b.expandedPaths[index])
  );
}

/**
 * Saved layout to apply, or null when tabs, folders, or selection already changed.
 *
 * Read/Code, hide explorer, the explorer search, and the outline can change
 * while the file is still loading. Those stay as the user left them. The saved
 * tabs are still applied, so that click does not replace the file with an empty
 * layout.
 */
export function workspaceSnapshotToHydrate(
  mount: WorkspaceSnapshot,
  current: WorkspaceSnapshot,
  loaded: WorkspaceSnapshot,
): WorkspaceSnapshot | null {
  if (!fileLayoutIsCold(current) || !sameFileLayout(mount, current)) return null;

  const mergedFiles = {
    ...(loaded.files ?? {}),
    ...(current.files ?? {}),
  };
  const treeSplitPercent =
    current.treeSplitPercent !== mount.treeSplitPercent
      ? current.treeSplitPercent
      : loaded.treeSplitPercent;

  const merged: WorkspaceSnapshot = {
    ...loaded,
    explorerCollapsed:
      current.explorerCollapsed !== mount.explorerCollapsed
        ? current.explorerCollapsed
        : loaded.explorerCollapsed,
    explorerSearchOpen:
      current.explorerSearchOpen !== mount.explorerSearchOpen
        ? current.explorerSearchOpen
        : loaded.explorerSearchOpen,
    explorerSearchQuery:
      current.explorerSearchQuery !== mount.explorerSearchQuery
        ? current.explorerSearchQuery
        : loaded.explorerSearchQuery,
    ...(Object.keys(mergedFiles).length > 0 ? { files: mergedFiles } : {}),
    ...(treeSplitPercent !== undefined && treeSplitPercent !== null ? { treeSplitPercent } : {}),
  };
  if (snapshotsEqual(current, merged)) return null;
  return merged;
}

export function serializedLayoutSnapshot(
  workspace: VaultWorkspaceState,
  tree: FileTreeNode,
): string {
  return serializeWorkspaceSnapshot(
    sanitizeWorkspaceSnapshot(workspaceSnapshotFromState(workspace), tree),
  );
}

/** Flush layout into the open vault session (dismiss / close). */
export async function persistWorkspaceSnapshot(
  fs: {
    getFileTree: (vaultId: string) => FileTreeNode | Promise<FileTreeNode>;
    setFileContent: (vaultId: string, path: string, content: string) => number | Promise<number>;
  },
  vaultId: string,
  workspace: VaultWorkspaceState,
): Promise<string> {
  const raw = serializedLayoutSnapshot(workspace, await fs.getFileTree(vaultId));
  await fs.setFileContent(vaultId, UPRIV_WORKSPACE_PATH, raw);
  return raw;
}
