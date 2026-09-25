import type { FileTreeNode } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Wire `FileTreeNode` from `vault_fs_list`. Missing/invalid input becomes an empty folder. */
export function parseFileTreeNode(raw: unknown): FileTreeNode {
  if (!isRecord(raw)) {
    return { name: "", type: "folder", children: [] };
  }
  const name = typeof raw.name === "string" ? raw.name : "";
  const type = raw.type === "file" ? "file" : "folder";
  if (type === "file") {
    return { name, type };
  }
  const children = Array.isArray(raw.children) ? raw.children.map(parseFileTreeNode) : [];
  return { name, type, children };
}
