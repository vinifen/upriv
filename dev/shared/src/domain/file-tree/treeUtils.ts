import type { FileTreeNode } from "./types";

export function joinPath(parent: string, name: string): string {
  if (parent === "/") return `/${name}`;
  return `${parent}/${name}`;
}

export function fileBaseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
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

export function isFolderPath(root: FileTreeNode, path: string): boolean {
  const node = findNode(root, path);
  return node?.type === "folder";
}
