import { sanitizeLogicalFileName } from "./fileNameValidation";
import { importPathSegments } from "./importPaths";
import { addChild } from "./treeOps";
import type { FileTreeNode } from "./types";
import { fileBaseName, findNode, joinPath } from "./treeUtils";

export type PendingImportEntry = {
  path: string;
  type: "file" | "folder";
  sessionId: number;
};

/** Synthetic explorer rows while an OS folder drop is still listing files. */
export const IMPORT_WALK_SLOT_COUNT = 3;
/**
 * File rows drawn as soon as their names are known, before any write starts.
 * A larger drop still imports every file. Past this many, one queue row per
 * folder stands in for the names that are not on screen yet.
 */
export const IMPORT_EXPLORER_SKELETON_FILES = 200;
export const IMPORT_WALK_SLOT_PREFIX = ".upriv-import-walk-";
/** One explorer row per folder whose queued files are not drawn individually. */
export const IMPORT_QUEUE_SLOT_NAME = ".upriv-import-queue";

export function isImportWalkPlaceholderName(name: string): boolean {
  return name.startsWith(IMPORT_WALK_SLOT_PREFIX);
}

export function isImportWalkPlaceholderPath(path: string): boolean {
  return isImportWalkPlaceholderName(fileBaseName(path));
}

export function isImportQueueSlotPath(path: string): boolean {
  return fileBaseName(path) === IMPORT_QUEUE_SLOT_NAME;
}

function parentFolderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash <= 0) return "/";
  return path.slice(0, slash);
}

export function walkPlaceholderEntries(
  parentPath: string,
  sessionId: number,
): PendingImportEntry[] {
  return Array.from({ length: IMPORT_WALK_SLOT_COUNT }, (_, index) => ({
    path: joinPath(parentPath, `${IMPORT_WALK_SLOT_PREFIX}${sessionId}-${index}`),
    type: "file",
    sessionId,
  }));
}

/** Same `name-2.ext` rule as `unique_file_name` in `upriv-core`. */
export function uniqueLogicalFileName(existing: readonly string[], base: string): string {
  if (!existing.includes(base)) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let index = 2;
  for (;;) {
    const candidate = `${stem}-${index}${ext}`;
    if (!existing.includes(candidate)) return candidate;
    index += 1;
  }
}

function childrenAt(tree: FileTreeNode | undefined, parentPath: string): FileTreeNode[] {
  if (!tree) return [];
  if (parentPath === "/" || parentPath === "") return tree.children ?? [];
  return findNode(tree, parentPath)?.children ?? [];
}

export type ImportPlanContext = {
  relativePaths?: readonly string[];
  tree?: FileTreeNode;
};

type ImportPlan = {
  entries: PendingImportEntry[];
  filePaths: (string | null)[];
};

/**
 * Planned vault paths for a drop/picker batch — same sanitizing as
 * `resolveImportDestination`, and the same unique file names as
 * `fs_create_file`, in batch order. An existing file is not marked pending.
 */
export function planPendingImport(
  parentPath: string,
  relativePaths: readonly string[],
  sessionId: number,
  tree?: FileTreeNode,
): ImportPlan {
  const reserved = new Map<string, string[]>();
  const takenAt = (parent: string): string[] => {
    let names = reserved.get(parent);
    if (!names) {
      names = childrenAt(tree, parent).map((child) => child.name);
      reserved.set(parent, names);
    }
    return names;
  };
  const childKind = (parent: string, name: string): FileTreeNode["type"] | null =>
    childrenAt(tree, parent).find((child) => child.name === name)?.type ?? null;

  const byPath = new Map<string, PendingImportEntry>();
  const filePaths: (string | null)[] = [];
  for (const relative of relativePaths) {
    const segments = importPathSegments(relative);
    if (segments.length === 0) {
      filePaths.push(null);
      continue;
    }
    let current = parentPath;
    let blocked = false;
    for (let index = 0; index < segments.length; index += 1) {
      const isFile = index === segments.length - 1;
      const raw = sanitizeLogicalFileName(segments[index] ?? "", isFile ? "file" : "folder");
      if (!isFile) {
        if (childKind(current, raw) === "file") {
          blocked = true;
          break;
        }
        const next = joinPath(current, raw);
        if (childKind(current, raw) !== "folder") {
          const existing = byPath.get(next);
          if (!existing || existing.type === "file") {
            byPath.set(next, { path: next, type: "folder", sessionId });
          }
          if (!takenAt(current).includes(raw)) takenAt(current).push(raw);
        }
        current = next;
        continue;
      }
      const name = uniqueLogicalFileName(takenAt(current), raw);
      if (!takenAt(current).includes(name)) takenAt(current).push(name);
      current = joinPath(current, name);
      byPath.set(current, { path: current, type: "file", sessionId });
    }
    filePaths.push(blocked ? null : current === parentPath ? null : current);
  }
  return { entries: [...byPath.values()], filePaths };
}

/** Explorer rows for a batch. The full pending list stays in memory for retry. */
export function pendingEntriesForExplorer(
  pending: readonly PendingImportEntry[],
  activePaths: ReadonlySet<string>,
  landedPaths?: ReadonlySet<string>,
): PendingImportEntry[] {
  let files = 0;
  for (const entry of pending) {
    if (entry.type === "file" && !isImportWalkPlaceholderPath(entry.path)) files += 1;
  }
  if (files <= IMPORT_EXPLORER_SKELETON_FILES) return [...pending];
  const visible: PendingImportEntry[] = [];
  let drawnFiles = 0;
  const parents = new Set<string>();
  for (const entry of pending) {
    if (entry.type === "folder" || isImportWalkPlaceholderPath(entry.path)) {
      visible.push(entry);
      continue;
    }
    const started = activePaths.has(entry.path) || (landedPaths?.has(entry.path) ?? false);
    if (started || drawnFiles < IMPORT_EXPLORER_SKELETON_FILES) {
      visible.push(entry);
      drawnFiles += 1;
      continue;
    }
    parents.add(parentFolderOf(entry.path));
  }
  const slots: PendingImportEntry[] = [...parents].sort().map((parent) => ({
    path: joinPath(parent, IMPORT_QUEUE_SLOT_NAME),
    type: "file",
    sessionId: 0,
  }));
  return [...visible, ...slots];
}

export function pendingEntriesFromRelativePaths(
  parentPath: string,
  relativePaths: readonly string[],
  sessionId: number,
  tree?: FileTreeNode,
): PendingImportEntry[] {
  return planPendingImport(parentPath, relativePaths, sessionId, tree).entries;
}

export function plannedImportPath(
  parentPath: string,
  relativePath: string,
  context?: ImportPlanContext,
): string | null {
  const relatives = context?.relativePaths ?? [relativePath];
  const index = relatives.indexOf(relativePath);
  if (index < 0) return null;
  const planned = planPendingImport(parentPath, relatives, 0, context?.tree).filePaths[index];
  return planned ?? null;
}

/** One plan for the whole batch. Per-file replanning walked every path again. */
export function plannedImportPathMap(
  parentPath: string,
  relativePaths: readonly string[],
  tree?: FileTreeNode,
): Map<string, string | null> {
  const planned = planPendingImport(parentPath, relativePaths, 0, tree).filePaths;
  const map = new Map<string, string | null>();
  relativePaths.forEach((relative, index) => {
    if (!map.has(relative)) map.set(relative, planned[index] ?? null);
  });
  return map;
}

export function replaceSessionPending(
  pending: readonly PendingImportEntry[],
  sessionId: number,
  next: readonly PendingImportEntry[],
): PendingImportEntry[] {
  return [...pending.filter((entry) => entry.sessionId !== sessionId), ...next];
}

export function dropSessionPending(
  pending: readonly PendingImportEntry[],
  sessionId: number,
): PendingImportEntry[] {
  return pending.filter((entry) => entry.sessionId !== sessionId);
}

export function ensureNodeAtPath(
  root: FileTreeNode,
  path: string,
  type: "file" | "folder",
): FileTreeNode {
  if (path === "/" || findNode(root, path)) return root;
  const segments = path.split("/").filter(Boolean);
  let current = "/";
  let next = root;
  for (let index = 0; index < segments.length; index += 1) {
    const name = segments[index];
    if (!name) continue;
    const childPath = joinPath(current, name);
    const isLeaf = index === segments.length - 1;
    const childType = isLeaf ? type : "folder";
    if (!findNode(next, childPath)) {
      next = addChild(next, current, {
        name,
        type: childType,
        ...(childType === "folder" ? { children: [] } : {}),
      });
    }
    current = childPath;
  }
  return next;
}

export function mergePendingIntoTree(
  tree: FileTreeNode,
  pending: readonly PendingImportEntry[],
): FileTreeNode {
  let next = tree;
  for (const entry of pending) {
    next = ensureNodeAtPath(next, entry.path, entry.type);
  }
  return next;
}

export function attachImportedPath(tree: FileTreeNode, path: string): FileTreeNode {
  return ensureNodeAtPath(tree, path, "file");
}

/** A file this session is encrypting now. Queued files are not added until they start. */
export type ActiveImportWrite = {
  sessionId: number;
  path: string;
  startedAt: number;
};

export function upsertActiveImportWrite(
  writes: readonly ActiveImportWrite[],
  next: ActiveImportWrite,
): ActiveImportWrite[] {
  const rest = writes.filter(
    (write) => write.sessionId !== next.sessionId || write.path !== next.path,
  );
  return [...rest, next];
}

export function dropActiveImportWritesForSession(
  writes: readonly ActiveImportWrite[],
  sessionId: number,
): ActiveImportWrite[] {
  return writes.filter((write) => write.sessionId !== sessionId);
}

export function dropActiveImportWritePath(
  writes: readonly ActiveImportWrite[],
  path: string,
  sessionId: number,
): ActiveImportWrite[] {
  return writes.filter((write) => write.path !== path || write.sessionId !== sessionId);
}

export function activeImportWriteForPath(
  writes: readonly ActiveImportWrite[],
  path: string | null | undefined,
): ActiveImportWrite | undefined {
  if (!path) return undefined;
  return writes.find((write) => write.path === path);
}

/** Record paths stored during a large import. Same set when nothing new was added. */
export function rememberLandedImportPaths(
  landed: ReadonlySet<string>,
  paths: readonly string[],
): ReadonlySet<string> {
  let changed = false;
  const next = new Set(landed);
  for (const path of paths) {
    if (next.has(path)) continue;
    next.add(path);
    changed = true;
  }
  return changed ? next : landed;
}

/** Drop landed paths that belonged to a finished import session. */
export function releaseLandedImportPaths(
  landed: ReadonlySet<string>,
  pending: readonly PendingImportEntry[],
  sessionId: number,
): ReadonlySet<string> {
  if (landed.size === 0) return landed;
  const next = new Set(landed);
  let changed = false;
  for (const entry of pending) {
    if (entry.sessionId === sessionId && next.delete(entry.path)) changed = true;
  }
  return changed ? next : landed;
}

function folderStillHasPendingChild(
  pending: readonly PendingImportEntry[],
  sessionId: number,
  folderPath: string,
): boolean {
  const prefix = `${folderPath}/`;
  return pending.some(
    (entry) =>
      entry.sessionId === sessionId && entry.path !== folderPath && entry.path.startsWith(prefix),
  );
}

export function dropResolvedPending(
  pending: readonly PendingImportEntry[],
  importedPath: string,
  plannedPath: string | null,
  sessionId: number,
): PendingImportEntry[] {
  const withoutFile = pending.filter((entry) => {
    if (entry.sessionId !== sessionId) return true;
    if (isImportWalkPlaceholderPath(entry.path)) return false;
    if (entry.type === "folder") return true;
    if (entry.path === importedPath || entry.path === plannedPath) return false;
    return true;
  });
  let current = withoutFile;
  let changed = true;
  while (changed) {
    changed = false;
    const next = current.filter((entry) => {
      if (entry.sessionId !== sessionId || entry.type !== "folder") return true;
      if (folderStillHasPendingChild(current, sessionId, entry.path)) return true;
      changed = true;
      return false;
    });
    current = next;
  }
  return current;
}
