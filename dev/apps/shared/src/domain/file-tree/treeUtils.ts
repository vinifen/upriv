import type { FileTreeNode } from "./types";

export function joinPath(parent: string, name: string): string {
  if (parent === "/") return `/${name}`;
  return `${parent}/${name}`;
}

export function fileBaseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** One explorer row: a node and where it sits. */
export interface VisibleTreeRow {
  path: string;
  node: FileTreeNode;
  /** 0 for a child of the root. */
  depth: number;
}

/**
 * The explorer's rows in order: the root's children, and below each expanded
 * folder its children, depth first. A folder that is not expanded hides its
 * whole subtree.
 */
export function visibleTreeRows(
  root: FileTreeNode,
  expandedPaths: readonly string[],
): VisibleTreeRow[] {
  const expanded = new Set(expandedPaths);
  const rows: VisibleTreeRow[] = [];
  const walk = (folder: FileTreeNode, folderPath: string, depth: number) => {
    for (const child of folder.children ?? []) {
      const path = joinPath(folderPath, child.name);
      rows.push({ path, node: child, depth });
      if (child.type === "folder" && expanded.has(path)) walk(child, path, depth + 1);
    }
  };
  if (root.type === "folder") walk(root, "/", 0);
  return rows;
}

export function findNode(root: FileTreeNode, path: string): FileTreeNode | null {
  if (path === "/") return root;

  const segments = path.split("/").filter(Boolean);
  let current: FileTreeNode = root;
  for (const segment of segments) {
    const next = current.children?.find((child) => child.name === segment);
    if (!next) return null;
    current = next;
  }
  return current;
}
