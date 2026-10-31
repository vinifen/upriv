import { joinPath, type VisibleTreeRow } from "./treeUtils";
import type { FileTreeNode } from "./types";

interface SearchRowOptions {
  /** Stays in whatever its name, because a new file is named in its own row. */
  renamingPath?: string | null;
  /** Folders collapsed in these results. What is under them stays out. */
  collapsed?: ReadonlySet<string>;
}

/**
 * Rows for an explorer search: every entry whose name holds `query`, in any
 * case, under the folders that lead to it. Everything under a matching folder
 * stays out unless it matches too.
 */
export function searchTreeRows(
  root: FileTreeNode,
  query: string,
  { renamingPath = null, collapsed }: SearchRowOptions = {},
): VisibleTreeRow[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0 || root.type !== "folder") return [];
  const walk = (folder: FileTreeNode, folderPath: string, depth: number): VisibleTreeRow[] => {
    const rows: VisibleTreeRow[] = [];
    for (const child of folder.children ?? []) {
      const path = joinPath(folderPath, child.name);
      const under = child.type === "folder" ? walk(child, path, depth + 1) : [];
      const shown =
        under.length > 0 ||
        path === renamingPath ||
        child.name.toLocaleLowerCase().includes(needle);
      if (!shown) continue;
      rows.push({ path, node: child, depth });
      const renamingInside = renamingPath?.startsWith(`${path}/`) === true;
      if (renamingInside || !collapsed?.has(path)) rows.push(...under);
    }
    return rows;
  };
  return walk(root, "/", 0);
}
