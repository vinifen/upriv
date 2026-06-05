import { useCallback } from "react";
import { VAULT_DISPLAY_NAME_MAX_LENGTH } from "@/constants/vault";
import { useTranslation } from "@/i18n";
import { validateFileName } from "./fileNameValidation";
import type { FileManagerEntry } from "./fileManagerTypes";
import { collectFilePaths, getParentPath, siblingNames } from "./fileTreeOps";
import { fileBaseName, findTreeNode } from "./fileTreeUtils";
import {
  createVaultFile,
  createVaultFolder,
  deleteVaultPath,
  getVaultFileContent,
  getVaultFileTree,
  getVaultTreeRevision,
  moveVaultPath,
  renameVaultPath,
  setVaultFileContent,
} from "./mockVaultFileSystem";
import type { VaultWorkspaceAction } from "./vaultWorkspaceReducer";
import { isVaultFileEditable } from "./mockVaultFileSystem";
import { resolveUnsavedPrompt } from "./vaultWorkspaceReducer";

interface UseVaultFileManagerOptions {
  entry: FileManagerEntry;
  dispatch: (action: VaultWorkspaceAction) => void;
}

export function useVaultFileManager({ entry, dispatch }: UseVaultFileManagerOptions) {
  const { t } = useTranslation();
  const vaultId = entry.vaultId;
  const workspace = entry.workspace;

  const syncTree = useCallback(() => {
    dispatch({ type: "tree_mutated", revision: getVaultTreeRevision(vaultId) });
  }, [dispatch, vaultId]);

  const showMockToast = useCallback(
    (key: "open_system" | "open_terminal") => {
      dispatch({ type: "set_toast", message: t(`modal.file_manager.toast.${key}`) });
      window.setTimeout(() => dispatch({ type: "set_toast", message: null }), 2800);
    },
    [dispatch, t],
  );

  const getEditorContent = useCallback(
    (path: string): string => {
      if (path in workspace.editorDrafts) return workspace.editorDrafts[path];
      return getVaultFileContent(vaultId, path)?.content ?? "";
    },
    [vaultId, workspace.editorDrafts],
  );

  const saveFile = useCallback(
    (path: string) => {
      const content = getEditorContent(path);
      setVaultFileContent(vaultId, path, content);
      dispatch({ type: "mark_saved", path, content });
    },
    [dispatch, getEditorContent, vaultId],
  );

  const saveAllFiles = useCallback(() => {
    for (const path of workspace.dirtyPaths) {
      if (!isVaultFileEditable(vaultId, path)) continue;
      saveFile(path);
    }
  }, [saveFile, vaultId, workspace.dirtyPaths]);

  const createFile = useCallback(
    (parentPath: string) => {
      const path = createVaultFile(vaultId, parentPath, t("modal.file_manager.default.new_file"));
      if (!path) return;
      syncTree();
      dispatch({ type: "expand_folder", path: parentPath });
      dispatch({ type: "open_file", path });
      dispatch({ type: "start_rename", path });
    },
    [dispatch, syncTree, t, vaultId],
  );

  const createFolder = useCallback(
    (parentPath: string) => {
      const path = createVaultFolder(vaultId, parentPath, t("modal.file_manager.default.new_folder"));
      if (!path) return;
      syncTree();
      dispatch({ type: "expand_folder", path: parentPath });
      dispatch({ type: "start_rename", path });
    },
    [dispatch, syncTree, t, vaultId],
  );

  const nameErrorMessage = useCallback(
    (code: NonNullable<ReturnType<typeof validateFileName>> | "duplicate") => {
      if (code === "duplicate") return t("vault.name.duplicate");
      if (code === "too_long") return t("vault.name.too_long", { max: VAULT_DISPLAY_NAME_MAX_LENGTH });
      return t(`vault.name.${code}`);
    },
    [t],
  );

  const commitRename = useCallback(
    (path: string, rawName: string) => {
      const name = rawName.trim();
      const error = validateFileName(name);
      if (error) {
        dispatch({ type: "set_toast", message: nameErrorMessage(error) });
        window.setTimeout(() => dispatch({ type: "set_toast", message: null }), 2800);
        return;
      }
      if (fileBaseName(path) === name) {
        dispatch({ type: "cancel_rename" });
        return;
      }
      const parent = getParentPath(path);
      const siblings = siblingNames(getVaultFileTree(vaultId), parent).filter((n) => n !== fileBaseName(path));
      if (siblings.includes(name)) {
        dispatch({ type: "set_toast", message: nameErrorMessage("duplicate") });
        window.setTimeout(() => dispatch({ type: "set_toast", message: null }), 2800);
        return;
      }
      const newPath = renameVaultPath(vaultId, path, name);
      if (!newPath) return;
      syncTree();
      dispatch({ type: "remap_paths", map: { [path]: newPath } });
      dispatch({ type: "cancel_rename" });
    },
    [dispatch, nameErrorMessage, syncTree, vaultId],
  );

  const requestDelete = useCallback(
    (path: string) => {
      if (path === "/") return;
      const node = findTreeNode(getVaultFileTree(vaultId), path);
      if (!node) return;
      dispatch({
        type: "set_delete_target",
        target: { path, name: node.name, isFolder: node.type === "folder" },
      });
    },
    [dispatch, vaultId],
  );

  const confirmDelete = useCallback(() => {
    const target = workspace.deleteTarget;
    if (!target) return;
    const tree = getVaultFileTree(vaultId);
    const node = findTreeNode(tree, target.path);
    const pathsToRemove =
      node?.type === "folder" ? [...collectFilePaths(node, target.path), target.path] : [target.path];
    deleteVaultPath(vaultId, target.path);
    syncTree();
    dispatch({ type: "remove_paths", paths: pathsToRemove });
    dispatch({ type: "set_delete_target", target: null });
  }, [dispatch, syncTree, vaultId, workspace.deleteTarget]);

  const movePath = useCallback(
    (fromPath: string, toFolderPath: string) => {
      const newPath = moveVaultPath(vaultId, fromPath, toFolderPath);
      if (!newPath || newPath === fromPath) return;
      syncTree();
      dispatch({ type: "remap_paths", map: { [fromPath]: newPath } });
    },
    [dispatch, syncTree, vaultId],
  );

  const confirmUnsaved = useCallback(() => {
    if (!workspace.unsavedPrompt) return;
    dispatch({
      type: "discard_unsaved_and",
      next: resolveUnsavedPrompt(workspace, workspace.unsavedPrompt),
    });
  }, [dispatch, workspace]);

  return {
    vaultId,
    tree: getVaultFileTree(vaultId),
    workspace,
    getEditorContent,
    saveFile,
    saveAllFiles,
    createFile,
    createFolder,
    commitRename,
    requestDelete,
    confirmDelete,
    movePath,
    showMockToast,
    confirmUnsaved,
    dispatch,
  };
}
