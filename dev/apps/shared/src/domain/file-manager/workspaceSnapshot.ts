import { findNode, type FileTreeNode } from "../file-tree";
import type { MarkdownViewMode, VaultWorkspaceState } from "./workspaceTypes";
import { createDefaultWorkspaceState, markdownViewMode } from "./workspaceTypes";

/** Logical file at vault root — encrypted in `store/` with the rest of the vault. */
export const UPRIV_WORKSPACE_FILE_NAME = ".upriv-workspace.json";
export const UPRIV_WORKSPACE_PATH = `/${UPRIV_WORKSPACE_FILE_NAME}`;

export const WORKSPACE_SNAPSHOT_FORMAT_VERSION = 1 as const;

export interface WorkspaceSnapshotV1 {
  format_version: typeof WORKSPACE_SNAPSHOT_FORMAT_VERSION;
  openTabs: string[];
  activeTabPath: string | null;
  expandedPaths: string[];
  selectedPath: string | null;
  /** Missing or any value other than `source` loads as `preview`. */
  markdownView: MarkdownViewMode;
  /** Missing or anything but `true` loads as shown. */
  explorerCollapsed: boolean;
  /** Missing or anything but `true` loads as hidden. */
  markdownOutlineOpen: boolean;
}

export type WorkspaceSnapshot = WorkspaceSnapshotV1;

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

  return {
    format_version: WORKSPACE_SNAPSHOT_FORMAT_VERSION,
    openTabs,
    activeTabPath,
    expandedPaths,
    selectedPath,
    markdownView: markdownViewMode(obj.markdownView),
    explorerCollapsed: obj.explorerCollapsed === true,
    markdownOutlineOpen: obj.markdownOutlineOpen === true,
  };
}

export function serializeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
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

  return {
    format_version: WORKSPACE_SNAPSHOT_FORMAT_VERSION,
    openTabs,
    activeTabPath,
    expandedPaths,
    selectedPath,
    markdownView: markdownViewMode(snapshot.markdownView),
    explorerCollapsed: snapshot.explorerCollapsed === true,
    markdownOutlineOpen: snapshot.markdownOutlineOpen === true,
  };
}

export function workspaceSnapshotFromState(state: VaultWorkspaceState): WorkspaceSnapshot {
  return {
    format_version: WORKSPACE_SNAPSHOT_FORMAT_VERSION,
    openTabs: state.openTabs.filter((p) => !isInternalVaultPath(p)),
    activeTabPath:
      state.activeTabPath && !isInternalVaultPath(state.activeTabPath) ? state.activeTabPath : null,
    expandedPaths: state.expandedPaths.length > 0 ? state.expandedPaths : ["/"],
    selectedPath:
      state.selectedPath && !isInternalVaultPath(state.selectedPath) ? state.selectedPath : null,
    markdownView: markdownViewMode(state.markdownView),
    explorerCollapsed: state.explorerCollapsed,
    markdownOutlineOpen: state.markdownOutlineOpen,
  };
}

/** Build a fresh workspace state from a sanitized snapshot (no drafts / session cues). */
export function workspaceStateFromSnapshot(snapshot: WorkspaceSnapshot): VaultWorkspaceState {
  const base = createDefaultWorkspaceState();
  return {
    ...base,
    openTabs: snapshot.openTabs,
    activeTabPath: snapshot.activeTabPath,
    expandedPaths: snapshot.expandedPaths,
    selectedPath: snapshot.selectedPath,
    markdownView: markdownViewMode(snapshot.markdownView),
    explorerCollapsed: snapshot.explorerCollapsed === true,
    markdownOutlineOpen: snapshot.markdownOutlineOpen === true,
  };
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
    a.markdownView === b.markdownView &&
    a.explorerCollapsed === b.explorerCollapsed &&
    a.markdownOutlineOpen === b.markdownOutlineOpen
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
 * Read/Code, hide explorer, and the outline can be toggled while the file is
 * still loading. Those flags stay as the user left them. The saved tabs are
 * still applied, so that click does not replace the file with an empty layout.
 */
export function workspaceSnapshotToHydrate(
  mount: WorkspaceSnapshot,
  current: WorkspaceSnapshot,
  loaded: WorkspaceSnapshot,
): WorkspaceSnapshot | null {
  if (!fileLayoutIsCold(current) || !sameFileLayout(mount, current)) return null;
  const merged: WorkspaceSnapshot = {
    ...loaded,
    markdownView:
      current.markdownView !== mount.markdownView ? current.markdownView : loaded.markdownView,
    explorerCollapsed:
      current.explorerCollapsed !== mount.explorerCollapsed
        ? current.explorerCollapsed
        : loaded.explorerCollapsed,
    markdownOutlineOpen:
      current.markdownOutlineOpen !== mount.markdownOutlineOpen
        ? current.markdownOutlineOpen
        : loaded.markdownOutlineOpen,
  };
  if (snapshotsEqual(current, merged)) return null;
  return merged;
}

/**
 * Apply a loaded snapshot only when memory is still the cold-open file layout.
 * Host seed or user edits (open file / expand folder) must win — including when
 * a parent re-render recaptures “mount” as the already-edited layout.
 * Chrome toggled during the load (Read/Code, explorer, outline) does not count
 * as that edit.
 */
export function shouldHydratePersistedWorkspace(
  mount: WorkspaceSnapshot,
  current: WorkspaceSnapshot,
  loaded: WorkspaceSnapshot,
): boolean {
  return workspaceSnapshotToHydrate(mount, current, loaded) != null;
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
