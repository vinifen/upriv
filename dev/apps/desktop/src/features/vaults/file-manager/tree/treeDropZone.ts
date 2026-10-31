import { isDescendantPath, type VisibleTreeRow } from "@upriv/shared";

/** Where a row sits in the outline drawn around the folder a drag is over. */
export type TreeDropZoneEdge = "single" | "first" | "middle" | "last";

/**
 * The folder a drag is over and its visible rows below it, top to bottom. The
 * root has no row: the explorer itself shows that target.
 */
export function treeDropZoneEdges(
  rows: readonly VisibleTreeRow[],
  dropTargetPath: string | null,
): ReadonlyMap<string, TreeDropZoneEdge> {
  const edges = new Map<string, TreeDropZoneEdge>();
  if (!dropTargetPath || dropTargetPath === "/") return edges;
  const start = rows.findIndex((row) => row.path === dropTargetPath);
  if (start < 0 || rows[start].node.type !== "folder") return edges;
  let end = start;
  while (end + 1 < rows.length && isDescendantPath(dropTargetPath, rows[end + 1].path)) end += 1;
  if (start === end) {
    edges.set(dropTargetPath, "single");
    return edges;
  }
  edges.set(rows[start].path, "first");
  for (let index = start + 1; index < end; index += 1) edges.set(rows[index].path, "middle");
  edges.set(rows[end].path, "last");
  return edges;
}
