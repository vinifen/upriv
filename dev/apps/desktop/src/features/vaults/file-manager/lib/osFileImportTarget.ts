import {
  findNode,
  getParentPath,
  type FileTreeNode,
  type VaultWorkspaceState,
} from "@upriv/shared";

/** Folder under the pointer, else the selected folder, else vault root. */
export function osFileImportParentPath(tree: FileTreeNode, workspace: VaultWorkspaceState): string {
  const hover = workspace.dropTargetPath;
  if (hover) return hover;
  const selected = workspace.selectedPath;
  if (!selected || selected === "/") return "/";
  const node = findNode(tree, selected);
  if (node?.type === "folder") return selected;
  return getParentPath(selected);
}
