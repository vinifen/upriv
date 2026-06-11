import { useCallback, useRef } from "react";
import { VAULT_DISPLAY_NAME_MAX_LENGTH } from "@/constants/vault";
import { useTranslation } from "@/i18n";
import { validateFileName } from "./fileNameValidation";
import type { FileManagerEntry } from "./fileManagerTypes";
import { collectFilePaths, getParentPath, siblingNames } from "./fileTreeOps";
import { fileBaseName, findNode } from "./fileTreeUtils";
import {
  createVaultFile,
  createVaultFolder,
  deleteVaultPath,
  getVaultFileContent,
  getVaultFileTree,
  getVaultTreeRevision,
  importVaultFile,
  isVaultFileEditable,
  isVaultFileViewable,
  moveVaultPath,
  renameVaultPath,
  setVaultFileContent,
} from "./mockVaultFileSystem";
import type { VaultWorkspaceAction } from "./vaultWorkspaceReducer";
import type { DroppedImportFile } from "./osFileDrop";
import { foldersToExpandOnImport, resolveImportDestination } from "./vaultImportPaths";
import { readImportFileContent } from "./vaultFileImport";
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

  const toastTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    dispatch({ type: "set_toast", message: null });
  }, [dispatch]);

  const showToast = useCallback(
    (message: string | null, duration = 2800) => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      dispatch({ type: "set_toast", message });
      if (message && duration > 0) {
        toastTimerRef.current = window.setTimeout(() => {
          dispatch({ type: "set_toast", message: null });
          toastTimerRef.current = null;
        }, duration);
      }
    },
    [dispatch],
  );

  const showMockToast = useCallback(
    (key: "open_system" | "open_terminal") => {
      showToast(t(`modal.file_manager.toast.${key}`));
    },
    [showToast, t],
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
      const path = createVaultFolder(
        vaultId,
        parentPath,
        t("modal.file_manager.default.new_folder"),
      );
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
      const siblings = siblingNames(getVaultFileTree(vaultId), parent).filter(
        (n) => n !== fileBaseName(path),
      );
      if (siblings.includes(name)) {
        showToast(nameErrorMessage("duplicate"));
        dispatch({ type: "cancel_rename" });
        return;
      }
      const newPath = renameVaultPath(vaultId, path, name);
      if (!newPath) return;
      syncTree();
      dispatch({ type: "remap_paths", map: { [path]: newPath } });
      dispatch({ type: "cancel_rename" });
    },
    [dispatch, nameErrorMessage, showToast, syncTree, vaultId],
  );

  const requestDelete = useCallback(
    (path: string) => {
      if (path === "/") return;
      const node = findNode(getVaultFileTree(vaultId), path);
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
    const node = findNode(tree, target.path);
    const pathsToRemove =
      node?.type === "folder"
        ? [...collectFilePaths(node, target.path), target.path]
        : [target.path];
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
        const destination = resolveImportDestination(vaultId, parentPath, relativePath);
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

        const path = importVaultFile(
          vaultId,
          destination.parentPath,
          destination.fileName,
          content,
        );
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
        const toOpen = importedPaths.find((path) => isVaultFileViewable(vaultId, path));
        if (toOpen) dispatch({ type: "open_file", path: toOpen });
      }

      let message = t("modal.file_manager.toast.imported", { count: importedPaths.length });
      if (skippedInvalid > 0) {
        message += ` ${t("modal.file_manager.toast.import_skipped_suffix", { count: skippedInvalid })}`;
      }
      showToast(message);
    },
    [dispatch, showToast, syncTree, t, vaultId],
  );

  const confirmUnsaved = useCallback(() => {
    if (!workspace.unsavedPrompt) return;
    dispatch({
      type: "discard_unsaved_and",
      next: resolveUnsavedPrompt(workspace, workspace.unsavedPrompt),
    });
  }, [dispatch, workspace]);

  const confirmSaveUnsaved = useCallback(() => {
    const prompt = workspace.unsavedPrompt;
    if (!prompt) return;
    saveFile(prompt.path);
    dispatch(resolveUnsavedPrompt(workspace, prompt));
  }, [dispatch, saveFile, workspace]);

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
    importFiles,
    showMockToast,
    showToast,
    dismissToast,
    confirmUnsaved,
    confirmSaveUnsaved,
    dispatch,
  };
}
