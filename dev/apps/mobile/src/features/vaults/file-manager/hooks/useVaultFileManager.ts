import { useCallback, useMemo } from "react";
import {
  collectFilePaths,
  fileBaseName,
  fileNameErrorI18nKey,
  findNode,
  formatImportOutcomeToast,
  applyImportedFilesToWorkspace,
  importBatchIsReadFailure,
  importLogicalFiles,
  getParentPath,
  isInternalVaultPath,
  isInternalVaultFileName,
  resolveUnsavedPrompt,
  siblingNames,
  validateFileName,
  persistLogicalFileName,
  LOGICAL_FILE_NAME_MAX_LENGTH,
  type FileManagerEntry,
  type FileNameErrorCode,
  type VaultWorkspaceAction,
} from "@upriv/shared";
import { useToast } from "@upriv/shared/react";
import { useVaultFileSystemService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { useAppSettingsContext } from "@/features/system/settings";
import type { MobileImportFile } from "../lib/osFileImport";

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
  const { getSettingsSnapshot } = useAppSettingsContext();
  const vaultId = entry.vaultId;
  const workspace = entry.workspace;

  const syncTree = useCallback(() => {
    dispatch({ type: "tree_mutated", revision: fs.getTreeRevision(vaultId) });
  }, [dispatch, fs, vaultId]);

  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast(2800);

  const showMockToast = useCallback(
    (key: "open_system") => {
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

  /** VS Code-style: tap a file in the explorer → open/activate it in the editor. */
  const openFile = useCallback(
    (path: string) => {
      if (isInternalVaultPath(path)) return;
      dispatch({ type: "open_file", path });
    },
    [dispatch],
  );

  const createFile = useCallback(
    (parentPath: string) => {
      const path = fs.createFile(vaultId, parentPath, t("modal.file_manager.default.new_file"));
      if (!path) return;
      syncTree();
      dispatch({ type: "expand_folder", path: parentPath });
      dispatch({ type: "mark_session_created", paths: [path] });
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
      dispatch({ type: "mark_session_created", paths: [path] });
      dispatch({ type: "start_rename", path });
    },
    [dispatch, fs, syncTree, t, vaultId],
  );

  const importFiles = useCallback(
    async (
      parentPath: string,
      files: readonly MobileImportFile[],
      options?: { openFirstViewable?: boolean; skippedUnsupported?: number },
    ) => {
      const result = await importLogicalFiles(files, {
        vaultId,
        parentPath,
        skippedUnsupported: options?.skippedUnsupported,
        readContent: async (file) => file.content,
        ensureFolder: fs.ensureFolder,
        importFile: fs.importFile,
      });

      if (result.importedPaths.length === 0) {
        if (importBatchIsReadFailure(result) && result.readFailureName) {
          showToast(t("modal.file_manager.toast.import_failed", { name: result.readFailureName }));
          return;
        }
        const message = formatImportOutcomeToast(
          0,
          result.skippedInvalid,
          result.skippedUnsupported,
          (key, vars) => t(key, vars),
        );
        if (message) showToast(message);
        return;
      }

      applyImportedFilesToWorkspace(result, dispatch, syncTree);

      if (options?.openFirstViewable) {
        const toOpen = result.importedPaths.find((path) => fs.isFileViewable(vaultId, path));
        if (toOpen) dispatch({ type: "open_file", path: toOpen });
      }

      const message = formatImportOutcomeToast(
        result.importedPaths.length,
        result.skippedInvalid,
        result.skippedUnsupported,
        (key, vars) => t(key, vars),
      );
      if (message) showToast(message);
    },
    [dispatch, fs, showToast, syncTree, t, vaultId],
  );

  const nameErrorMessage = useCallback(
    (code: FileNameErrorCode) => {
      const key = fileNameErrorI18nKey(code);
      if (code === "too_long") return t(key, { max: LOGICAL_FILE_NAME_MAX_LENGTH });
      return t(key);
    },
    [t],
  );

  const commitRename = useCallback(
    (path: string, rawName: string) => {
      const name = persistLogicalFileName(rawName);
      if (isInternalVaultFileName(name)) {
        showToast(t("modal.file_manager.toast.rename_reserved"));
        dispatch({ type: "cancel_rename" });
        return;
      }
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
      if (!newPath) {
        showToast(t("modal.file_manager.toast.rename_failed"));
        dispatch({ type: "cancel_rename" });
        return;
      }
      syncTree();
      dispatch({ type: "remap_paths", map: { [path]: newPath } });
      dispatch({ type: "cancel_rename" });
    },
    [dispatch, fs, nameErrorMessage, showToast, syncTree, t, vaultId],
  );

  const movePath = useCallback(
    (fromPath: string, toFolderPath: string) => {
      const newPath = fs.movePath(vaultId, fromPath, toFolderPath);
      if (!newPath || newPath === fromPath) return;
      syncTree();
      dispatch({ type: "remap_paths", map: { [fromPath]: newPath } });
    },
    [dispatch, fs, syncTree, vaultId],
  );

  const requestDelete = useCallback(
    (path: string) => {
      if (path === "/") return;
      const node = findNode(fs.getFileTree(vaultId), path);
      if (!node) return;
      if (getSettingsSnapshot().ui.file_manager_confirm_delete === false) {
        const pathsToRemove =
          node.type === "folder" ? [...collectFilePaths(node, path), path] : [path];
        fs.deletePath(vaultId, path);
        syncTree();
        dispatch({ type: "remove_paths", paths: pathsToRemove });
        return;
      }
      dispatch({
        type: "set_delete_target",
        target: { path, name: node.name, isFolder: node.type === "folder" },
      });
    },
    [dispatch, fs, getSettingsSnapshot, syncTree, vaultId],
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

  const tree = useMemo(() => {
    void workspace.treeRevision;
    return fs.getFileTree(vaultId);
  }, [fs, vaultId, workspace.treeRevision]);

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
    openFile,
    createFile,
    createFolder,
    importFiles,
    commitRename,
    movePath,
    requestDelete,
    confirmDelete,
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

export function hasUnsavedEditableTabs(fm: FileManagerApi): boolean {
  return fm.workspace.dirtyPaths.some((path) => fm.isFileEditable(path));
}
