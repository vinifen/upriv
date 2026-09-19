import { findNode, type FileTreeNode } from "../file-tree";
import type { VaultWorkspaceState } from "./workspaceTypes";
import { createDefaultWorkspaceState } from "./workspaceTypes";

/** Logical file at vault root — encrypted in `contents/` with the rest of the vault. */
export const UPRIV_WORKSPACE_FILE_NAME = ".upriv-workspace.json";
export const UPRIV_WORKSPACE_PATH = `/${UPRIV_WORKSPACE_FILE_NAME}`;

export const WORKSPACE_SNAPSHOT_FORMAT_VERSION = 1 as const;

export interface WorkspaceSnapshotV1 {
  format_version: typeof WORKSPACE_SNAPSHOT_FORMAT_VERSION;
  openTabs: string[];
  activeTabPath: string | null;
  expandedPaths: string[];
  selectedPath: string | null;
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
 * Legacy `treeSplitPercent` in older files is ignored (split lives in app settings).
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
    a.expandedPaths.every((path, index) => path === b.expandedPaths[index])
  );
}

/** Flush layout into the vault session (dismiss / purge / list sync). */
export function persistWorkspaceSnapshot(
  fs: {
    getFileTree: (vaultId: string) => FileTreeNode;
    setFileContent: (vaultId: string, path: string, content: string) => number;
  },
  vaultId: string,
  workspace: VaultWorkspaceState,
): void {
  const snapshot = workspaceSnapshotFromState(workspace);
  const sanitized = sanitizeWorkspaceSnapshot(snapshot, fs.getFileTree(vaultId));
  fs.setFileContent(vaultId, UPRIV_WORKSPACE_PATH, serializeWorkspaceSnapshot(sanitized));
}
