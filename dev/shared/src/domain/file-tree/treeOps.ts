import type { FileTreeNode } from "./types";
import { fileBaseName, findNode, joinPath } from "./treeUtils";

export { findNode } from "./treeUtils";

export function getParentPath(path: string): string {
  if (path === "/") return "/";
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function siblingNames(root: FileTreeNode, parentPath: string): string[] {
  const parent = findNode(root, parentPath);
  return parent?.children?.map((child) => child.name) ?? [];
}

export function isDescendantPath(ancestor: string, candidate: string): boolean {
  if (ancestor === "/") return candidate !== "/";
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
}

export function uniqueName(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  const dot = base.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt ? base.slice(0, dot) : base;
  const ext = hasExt ? base.slice(dot) : "";
  let index = 2;
  while (existing.includes(`${stem}-${index}${ext}`)) index += 1;
  return `${stem}-${index}${ext}`;
}

export function uniqueFolderName(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  let index = 2;
  while (existing.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function addChild(
  root: FileTreeNode,
  parentPath: string,
  child: FileTreeNode,
): FileTreeNode {
  const next = structuredClone(root);
  const parent = findNode(next, parentPath);
  if (!parent || parent.type !== "folder") return root;
  parent.children = [...(parent.children ?? []), child];
  return next;
}

export function removeNode(root: FileTreeNode, path: string): FileTreeNode {
  if (path === "/") return root;
  const next = structuredClone(root);
  const parentPath = getParentPath(path);
  const parent = findNode(next, parentPath);
  const name = fileBaseName(path);
  if (!parent?.children) return root;
  parent.children = parent.children.filter((child) => child.name !== name);
  return next;
}

export function renameNode(root: FileTreeNode, path: string, newName: string): FileTreeNode {
  if (path === "/") return root;
  const next = structuredClone(root);
  const node = findNode(next, path);
  if (!node) return root;
  node.name = newName;
  return next;
}

export function moveNode(root: FileTreeNode, fromPath: string, toFolderPath: string): FileTreeNode {
  if (fromPath === "/" || fromPath === toFolderPath) return root;
  if (isDescendantPath(fromPath, toFolderPath)) return root;

  const node = findNode(root, fromPath);
  if (!node) return root;

  const targetParent = findNode(root, toFolderPath);
  if (!targetParent || targetParent.type !== "folder") return root;

  const targetNames = targetParent.children?.map((c) => c.name) ?? [];
  if (targetNames.includes(node.name) && getParentPath(fromPath) !== toFolderPath) return root;

  let next = removeNode(root, fromPath);
  next = addChild(next, toFolderPath, structuredClone(node));
  return next;
}

export function collectFilePaths(root: FileTreeNode, base = "/"): string[] {
  if (root.type === "file") return [base];
  return (root.children ?? []).flatMap((child) =>
    collectFilePaths(child, joinPath(base, child.name)),
  );
}

export function remapContentPaths(
  contents: Record<string, string>,
  fromPrefix: string,
  toPrefix: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [path, value] of Object.entries(contents)) {
    if (path === fromPrefix) {
      next[toPrefix] = value;
    } else if (path.startsWith(`${fromPrefix}/`)) {
      next[`${toPrefix}${path.slice(fromPrefix.length)}`] = value;
    } else {
      next[path] = value;
    }
  }
  return next;
}

export function removeContentPaths(
  contents: Record<string, string>,
  prefix: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [path, value] of Object.entries(contents)) {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) next[path] = value;
  }
  return next;
}
