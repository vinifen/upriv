import { joinPath } from "./treeUtils";
import type { FileTreeNode } from "./types";

/** How much of a tree entry is in a plain-text vault's folder. */
export type FolderPresence = "all" | "some" | "none";

/**
 * Presence by path for a vault of chosen files; null for any other vault, whose
 * tree carries no marks. A folder counts the files under it. A folder with none
 * counts itself, and a vault root with no files has no entry: nothing to send.
 */
export function treeFolderPresence(root: FileTreeNode): Map<string, FolderPresence> | null {
  if (root.inFolder === undefined) return null;
  const presence = new Map<string, FolderPresence>();
  const walk = (node: FileTreeNode, path: string): { held: number; total: number } => {
    let held = 0;
    let total = 0;
    for (const child of node.children ?? []) {
      const counts = walk(child, joinPath(path, child.name));
      held += counts.held;
      total += counts.total;
    }
    if (total > 0) {
      presence.set(path, held === 0 ? "none" : held === total ? "all" : "some");
      return { held, total };
    }
    if (path !== "/") presence.set(path, node.inFolder ? "all" : "none");
    return node.type === "file" ? { held: node.inFolder ? 1 : 0, total: 1 } : { held, total };
  };
  walk(root, "/");
  return presence;
}
