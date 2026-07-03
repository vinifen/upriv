import { useCallback, useMemo } from "react";
import { VAULT_DISPLAY_NAME_MAX_LENGTH } from "@upriv/shared";
import { useVaultFileSystemService } from "@/platform/services";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/i18n";
import {
  collectFilePaths,
  fileBaseName,
  findNode,
  getParentPath,
  joinPath,
  siblingNames,
  validateFileName,
} from "@upriv/shared";
import type { FileManagerEntry } from "../fileManagerTypes";
import type { VaultWorkspaceAction } from "../lib/vaultWorkspaceReducer";
import type { DroppedImportFile } from "../lib/osFileDrop";
import { foldersToExpandOnImport, resolveImportDestination } from "@upriv/shared";
import { readImportFileContent } from "../lib/vaultFileImport";
import { resolveUnsavedPrompt } from "../lib/vaultWorkspaceReducer";

interface UseVaultFileManagerOptions {
  entry: FileManagerEntry;
  dispatch: (action: VaultWorkspaceAction) => void;
  onDismissConfirmed?: () => void;
}

export function useVaultFileManager({
  entry,
  dispatch,
  onDismissConfirmed,
}: UseVaultFileManagerOptions) {
  const { t } = useTranslation();
  const fs = useVaultFileSystemService();
  const vaultId = entry.vaultId;
  const workspace = entry.workspace;

  const syncTree = useCallback(() => {
    dispatch({ type: "tree_mutated", revision: fs.getTreeRevision(vaultId) });
  }, [dispatch, fs, vaultId]);

  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast(2800);

  const showMockToast = useCallback(
    (key: "open_system" | "open_terminal") => {
      showToast(t(`modal.file_manager.toast.${key}`));
    },
    [showToast, t],
  );

  const getEditorContent = useCallback(
    (path: string): string => {
      if (path in workspace.editorDrafts) return workspace.editorDrafts[path];
      return fs.getFileContent(vaultId, path)?.content ?? "";
    },
    [fs, vaultId, workspace.editorDrafts],
  );

  const saveFile = useCallback(
    (path: string) => {
      const content = getEditorContent(path);
      fs.setFileContent(vaultId, path, content);
      dispatch({ type: "mark_saved", path, content });
    },
    [dispatch, fs, getEditorContent, vaultId],
  );

  const saveAllFiles = useCallback(() => {
    for (const path of workspace.dirtyPaths) {
      if (!fs.isFileEditable(vaultId, path)) continue;
      saveFile(path);
    }
  }, [fs, saveFile, vaultId, workspace.dirtyPaths]);

  const createFile = useCallback(
    (parentPath: string) => {
      const path = fs.createFile(vaultId, parentPath, t("modal.file_manager.default.new_file"));
      if (!path) return;
      syncTree();
      dispatch({ type: "expand_folder", path: parentPath });
      dispatch({ type: "open_file", path });
      dispatch({ type: "start_rename", path });
    },
    [dispatch, fs, syncTree, t, vaultId],
  );

  const createFolder = useCallback(
    (parentPath: string) => {
      const path = fs.createFolder(vaultId, parentPath, t("modal.file_manager.default.new_folder"));
      if (!path) return;
      syncTree();
      dispatch({ type: "expand_folder", path: parentPath });
      dispatch({ type: "start_rename", path });
    },
    [dispatch, fs, syncTree, t, vaultId],
  );

  const canImportHostFolder = Boolean(fs.importHostFolder);

  const importHostFolder = useCallback(
    async (parentPath: string): Promise<boolean> => {
      if (!fs.importHostFolder) return false;
      const result = await fs.importHostFolder(vaultId, parentPath);
      if (result.cancelled) return true;
      syncTree();
      dispatch({ type: "expand_folder", path: parentPath });
      if (result.folderName) {
        const newPath = joinPath(parentPath, result.folderName);
        dispatch({ type: "expand_folder", path: newPath });
        dispatch({ type: "select_path", path: newPath });
      }
      showToast(t("modal.file_manager.toast.imported", { count: result.fileCount }));
      return true;
    },
    [dispatch, fs, showToast, syncTree, t, vaultId],
  );

  const nameErrorMessage = useCallback(
    (code: NonNullable<ReturnType<typeof validateFileName>> | "duplicate") => {
      if (code === "duplicate") return t("vault.name.duplicate");
      if (code === "too_long")
        return t("vault.name.too_long", { max: VAULT_DISPLAY_NAME_MAX_LENGTH });
      return t(`vault.name.${code}`);
    },
    [t],
  );

  const commitRename = useCallback(
    (path: string, rawName: string) => {
      const name = rawName.trim();
      const error = validateFileName(name);
      if (error) {
        showToast(nameErrorMessage(error));
        dispatch({ type: "cancel_rename" });
        return;
      }
      if (fileBaseName(path) === name) {
        dispatch({ type: "cancel_rename" });
        return;
      }
      const parent = getParentPath(path);
      const siblings = siblingNames(fs.getFileTree(vaultId), parent).filter(
        (n) => n !== fileBaseName(path),
      );
      if (siblings.includes(name)) {
        showToast(nameErrorMessage("duplicate"));
        dispatch({ type: "cancel_rename" });
        return;
      }
      const newPath = fs.renamePath(vaultId, path, name);
      if (!newPath) return;
      syncTree();
      dispatch({ type: "remap_paths", map: { [path]: newPath } });
      dispatch({ type: "cancel_rename" });
    },
    [dispatch, fs, nameErrorMessage, showToast, syncTree, vaultId],
  );

  const requestDelete = useCallback(
    (path: string) => {
      if (path === "/") return;
      const node = findNode(fs.getFileTree(vaultId), path);
      if (!node) return;
      dispatch({
        type: "set_delete_target",
        target: { path, name: node.name, isFolder: node.type === "folder" },
      });
    },
    [dispatch, fs, vaultId],
  );

  const confirmDelete = useCallback(() => {
    const target = workspace.deleteTarget;
    if (!target) return;
    const tree = fs.getFileTree(vaultId);
    const node = findNode(tree, target.path);
    const pathsToRemove =
      node?.type === "folder"
        ? [...collectFilePaths(node, target.path), target.path]
        : [target.path];
    fs.deletePath(vaultId, target.path);
    syncTree();
    dispatch({ type: "remove_paths", paths: pathsToRemove });
    dispatch({ type: "set_delete_target", target: null });
  }, [dispatch, fs, syncTree, vaultId, workspace.deleteTarget]);

  const movePath = useCallback(
    (fromPath: string, toFolderPath: string) => {
      const newPath = fs.movePath(vaultId, fromPath, toFolderPath);
      if (!newPath || newPath === fromPath) return;
      syncTree();
      dispatch({ type: "remap_paths", map: { [fromPath]: newPath } });
    },
    [dispatch, fs, syncTree, vaultId],
  );

  const importFiles = useCallback(
    async (
      parentPath: string,
      files: readonly DroppedImportFile[],
      options?: { openFirstViewable?: boolean },
    ) => {
      if (files.length === 0) return;

      const importedPaths: string[] = [];
      const foldersToExpand = new Set<string>();
      let skippedInvalid = 0;
      let readFailureName: string | null = null;

      for (const { file, relativePath } of files) {
        const destination = resolveImportDestination(
          vaultId,
          parentPath,
          relativePath,
          fs.ensureFolder,
        );
        if (!destination) {
          skippedInvalid += 1;
          continue;
        }

        let content = "";

        try {
          content = await readImportFileContent(file);
        } catch {
          readFailureName = file.name;
          continue;
        }

        const path = fs.importFile(vaultId, destination.parentPath, destination.fileName, content);
        if (!path) {
          skippedInvalid += 1;
          continue;
        }
        importedPaths.push(path);
        for (const folderPath of foldersToExpandOnImport(parentPath, relativePath)) {
          foldersToExpand.add(folderPath);
        }
      }

      if (importedPaths.length === 0) {
        if (readFailureName) {
          showToast(t("modal.file_manager.toast.import_failed", { name: readFailureName }));
        } else if (skippedInvalid > 0) {
          showToast(
            t("modal.file_manager.toast.import_skipped_invalid", { count: skippedInvalid }),
          );
        }
        return;
      }

      syncTree();
      for (const folderPath of foldersToExpand) {
        dispatch({ type: "expand_folder", path: folderPath });
      }

      if (options?.openFirstViewable) {
        const toOpen = importedPaths.find((path) => fs.isFileViewable(vaultId, path));
        if (toOpen) dispatch({ type: "open_file", path: toOpen });
      }

      let message = t("modal.file_manager.toast.imported", { count: importedPaths.length });
      if (skippedInvalid > 0) {
        message += ` ${t("modal.file_manager.toast.import_skipped_suffix", { count: skippedInvalid })}`;
      }
      showToast(message);
    },
    [dispatch, fs, showToast, syncTree, t, vaultId],
  );

  const confirmUnsaved = useCallback(() => {
    const prompt = workspace.unsavedPrompt;
    if (!prompt) return;

    switch (prompt.type) {
      case "close_tab":
        dispatch({
          type: "discard_unsaved_and",
          next: { type: "close_tab", path: prompt.path },
        });
        return;
      case "switch_tab":
        dispatch({
          type: "discard_unsaved_and",
          next: { type: "request_active_tab", path: prompt.toPath },
        });
        return;
      case "dismiss_workspace":
        dispatch({
          type: "discard_unsaved_and",
          next: { type: "set_unsaved_prompt", prompt: null },
        });
        onDismissConfirmed?.();
        return;
    }
  }, [dispatch, onDismissConfirmed, workspace.unsavedPrompt]);

  const confirmSaveUnsaved = useCallback(() => {
    const prompt = workspace.unsavedPrompt;
    if (!prompt) return;

    switch (prompt.type) {
      case "close_tab":
        saveFile(prompt.path);
        dispatch({
          type: "discard_unsaved_and",
          next: resolveUnsavedPrompt(workspace, prompt),
        });
        return;
      case "switch_tab":
        if (workspace.activeTabPath) saveFile(workspace.activeTabPath);
        dispatch({
          type: "discard_unsaved_and",
          next: resolveUnsavedPrompt(workspace, prompt),
        });
        return;
      case "dismiss_workspace":
        saveAllFiles();
        dispatch({
          type: "discard_unsaved_and",
          next: resolveUnsavedPrompt(workspace, prompt),
        });
        onDismissConfirmed?.();
        return;
    }
  }, [dispatch, onDismissConfirmed, saveAllFiles, saveFile, workspace]);

  const tree = useMemo(() => fs.getFileTree(vaultId), [fs, vaultId, workspace.treeRevision]);

  return {
    vaultId,
    tree,
    workspace,
    getEditorContent,
    isFileEditable: (path: string) => fs.isFileEditable(vaultId, path),
    isFileViewable: (path: string) => fs.isFileViewable(vaultId, path),
    isFileImage: (path: string) => fs.isFileImage(vaultId, path),
    saveFile,
    saveAllFiles,
    createFile,
    createFolder,
    canImportHostFolder,
    importHostFolder,
    commitRename,
    requestDelete,
    confirmDelete,
    movePath,
    importFiles,
    toastMessage,
    showMockToast,
    showToast,
    dismissToast,
    confirmUnsaved,
    confirmSaveUnsaved,
    dispatch,
  };
}

export type FileManagerApi = ReturnType<typeof useVaultFileManager>;
