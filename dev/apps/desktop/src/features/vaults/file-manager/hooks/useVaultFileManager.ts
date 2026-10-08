import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectFilePaths,
  fileBaseName,
  fileNameErrorI18nKey,
  findNode,
  formatImportOutcomeToast,
  importLogicalFiles,
  importFileSlots,
  yieldToPaint,
  getParentPath,
  isInternalVaultPath,
  isInternalVaultFileName,
  resolveUnsavedPrompt,
  siblingNames,
  validateFileName,
  persistLogicalFileName,
  LOGICAL_FILE_NAME_MAX_LENGTH,
  FilePreviewTooLargeError,
  LOADING_APPEAR_DELAY_MS,
  LOADING_BUDGET_MS,
  attachImportedPath,
  dropResolvedPending,
  dropSessionPending,
  foldersToExpandForImportBatch,
  rememberLandedImportPaths,
  hasUnsavedWorkspaceChanges,
  MAX_DIRTY_DRAFT_SAVE_PASSES,
  withSavedDraftDiskContents,
  IMPORT_EXPLORER_SKELETON_FILES,
  isImportQueueSlotPath,
  isImportWalkPlaceholderPath,
  mergePendingIntoTree,
  pendingEntriesForExplorer,
  pendingEntriesFromRelativePaths,
  plannedImportPathMap,
  replaceSessionPending,
  walkPlaceholderEntries,
  upsertActiveImportWrite,
  dropActiveImportWritesForSession,
  dropActiveImportWritePath,
  activeImportWriteForPath,
  releaseLandedImportPaths,
  type ActiveImportWrite,
  type FileManagerEntry,
  type FileNameErrorCode,
  type FileTreeNode,
  type PendingImportEntry,
  type VaultWorkspaceAction,
} from "@upriv/shared";
import { useVaultFileSystemService } from "@/platform/services";
import { useToast, useLoadingBudget, useVaultFileTree } from "@upriv/shared/react";
import { useFileManager } from "../FileManagerContext";
import { useTranslation } from "@/i18n";
import { useAppSettingsContext } from "@/features/system/settings";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcOpenInTerminal, rpcRevealInFileManager, rpcVaultFsImportSeal } from "@/lib/rpc";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { revealFailureKey } from "@/lib/revealInOs";
import {
  listFilesFromOsDropSnapshot,
  type DroppedImportFile,
  type OsDropSnapshot,
} from "../lib/osFileDrop";
import { binarySourceFromDropped } from "../lib/vaultFileImport";

type ImportFileOptions = {
  openFirstViewable?: boolean;
  skippedUnsupported?: number;
};

interface UseVaultFileManagerOptions {
  entry: FileManagerEntry;
  dispatch: (action: VaultWorkspaceAction) => void;
  onDismissConfirmed?: () => void;
  /** Lock asked to close this vault: save or discard, then close it. */
  onVaultCloseConfirmed?: () => void;
  /** Queued close: keep the current files. New drafts and imports wait. */
  writesLocked?: boolean;
}

/** Cores for the import pool. The shell count matches the daemon; the page count is the fallback. */
function desktopProcessorCount(): number {
  const host = globalThis as {
    upriv?: { logicalProcessors?: () => number };
    navigator?: { hardwareConcurrency?: number };
  };
  const reported = host.upriv?.logicalProcessors?.();
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 1) {
    return Math.floor(reported);
  }
  const cores = host.navigator?.hardwareConcurrency;
  return typeof cores === "number" && Number.isFinite(cores) && cores >= 1 ? Math.floor(cores) : 1;
}

export function useVaultFileManager({
  entry,
  dispatch,
  onDismissConfirmed,
  onVaultCloseConfirmed,
  writesLocked = false,
}: UseVaultFileManagerOptions) {
  const { t } = useTranslation();
  const fs = useVaultFileSystemService();
  const { setImportInFlight } = useFileManager();
  const { getSettingsSnapshot } = useAppSettingsContext();
  const vaultId = entry.vaultId;
  const writesLockedRef = useRef(writesLocked);
  writesLockedRef.current = writesLocked;
  const workspace = entry.workspace;
  const {
    tree,
    setTree,
    status: treeStatus,
    retry: retryTree,
  } = useVaultFileTree(fs, vaultId, workspace.treeRevision);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const [diskContents, setDiskContents] = useState<Record<string, string>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, true>>({});
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const diskContentsRef = useRef(diskContents);
  diskContentsRef.current = diskContents;
  const loadErrorsRef = useRef(loadErrors);
  loadErrorsRef.current = loadErrors;
  const [previewBlocked, setPreviewBlocked] = useState<Record<string, true>>({});
  const previewBlockedRef = useRef(previewBlocked);
  previewBlockedRef.current = previewBlocked;
  const [importBusy, setImportBusy] = useState(false);
  const importSessionSeqRef = useRef(0);
  const importInFlightRef = useRef(new Set<number>());
  const importAbortRef = useRef(new AbortController());
  /** Lock confirmed "close and cancel import"; close the vault once writes stop. */
  const closeVaultAfterImportRef = useRef(false);
  const importPeekRef = useRef<string | null>(null);
  const [pendingImports, setPendingImports] = useState<PendingImportEntry[]>([]);
  const [activeImportWrites, setActiveImportWrites] = useState<ActiveImportWrite[]>([]);
  const pendingImportsRef = useRef(pendingImports);
  pendingImportsRef.current = pendingImports;
  const pendingPathSet = useMemo(
    () => new Set(pendingImports.map((entry) => entry.path)),
    [pendingImports],
  );
  const [landedImportPaths, setLandedImportPaths] = useState<ReadonlySet<string>>(() => new Set());
  const landedImportPathsRef = useRef(landedImportPaths);
  const commitLandedImportPaths = useCallback((next: ReadonlySet<string>) => {
    landedImportPathsRef.current = next;
    setLandedImportPaths(next);
  }, []);
  const unresolvedImportPaths = useMemo(() => {
    const next = new Set<string>();
    for (const path of pendingPathSet) {
      if (!landedImportPaths.has(path)) next.add(path);
    }
    return next;
  }, [landedImportPaths, pendingPathSet]);
  const processingPathSet = useMemo(
    () => new Set(activeImportWrites.map((write) => write.path)),
    [activeImportWrites],
  );
  const editorImportWrite = activeImportWriteForPath(activeImportWrites, workspace.activeTabPath);
  const importBudget = useLoadingBudget(
    Boolean(editorImportWrite),
    LOADING_BUDGET_MS.vaultFsImport,
    {
      appearDelayMs: LOADING_APPEAR_DELAY_MS,
      startedAt: editorImportWrite?.startedAt,
    },
  );
  const displayTree = useMemo(
    () =>
      mergePendingIntoTree(
        tree,
        pendingEntriesForExplorer(pendingImports, processingPathSet, landedImportPaths),
      ),
    [landedImportPaths, pendingImports, processingPathSet, tree],
  );

  useEffect(() => {
    setImportInFlight(vaultId, importBusy);
    const inFlight = importInFlightRef.current.size;
    return () => {
      if (inFlight === 0) setImportInFlight(vaultId, false);
    };
  }, [importBusy, setImportInFlight, vaultId]);

  useEffect(() => {
    setDiskContents((current) => withSavedDraftDiskContents(current, workspace));
  }, [workspace]);

  useEffect(() => {
    if (importBusy) return;
    const promptType = workspace.unsavedPrompt?.type;
    if (promptType === "import_in_progress" || promptType === "close_vault_import") {
      dispatch({ type: "set_unsaved_prompt", prompt: null });
    }
    // Save/discard of a vault lock is still on screen. Closing waits for that answer.
    if (!closeVaultAfterImportRef.current || promptType === "close_vault") return;
    closeVaultAfterImportRef.current = false;
    onVaultCloseConfirmed?.();
  }, [dispatch, importBusy, onVaultCloseConfirmed, workspace.unsavedPrompt]);

  const beginImportSession = useCallback(() => {
    if (importAbortRef.current.signal.aborted) {
      importAbortRef.current = new AbortController();
    }
    const sessionId = importSessionSeqRef.current + 1;
    importSessionSeqRef.current = sessionId;
    importInFlightRef.current.add(sessionId);
    setImportBusy(true);
    return sessionId;
  }, []);

  const endImportSession = useCallback(
    (sessionId: number) => {
      importInFlightRef.current.delete(sessionId);
      setImportInFlight(vaultId, importInFlightRef.current.size > 0);
      setActiveImportWrites((prev) => dropActiveImportWritesForSession(prev, sessionId));
      setImportBusy(importInFlightRef.current.size > 0);
    },
    [setImportInFlight, vaultId],
  );

  const clearImportSession = useCallback(
    (sessionId: number) => {
      setPendingImports((prev) => dropSessionPending(prev, sessionId));
      commitLandedImportPaths(
        releaseLandedImportPaths(
          landedImportPathsRef.current,
          pendingImportsRef.current,
          sessionId,
        ),
      );
    },
    [commitLandedImportPaths],
  );

  const syncTree = useCallback(async () => {
    const revision = await fs.getTreeRevision(vaultId);
    dispatch({ type: "tree_mutated", revision });
  }, [dispatch, fs, vaultId]);

  const publishImportedTree = useCallback(async () => {
    try {
      const nextTree = await fs.getFileTree(vaultId);
      const revision = await fs.getTreeRevision(vaultId);
      setTree(nextTree);
      dispatch({ type: "tree_mutated", revision });
    } catch {
      try {
        await syncTree();
      } catch {
        /* The caller still drops this batch's placeholders. */
      }
    }
  }, [dispatch, fs, setTree, syncTree, vaultId]);

  const { toast, show: showToast, dismiss: dismissToast } = useToast(2800);

  useEffect(() => {
    let cancelled = false;
    const paths = [...new Set(workspace.openTabs.filter(Boolean))];
    void Promise.all(
      paths.map(async (path) => {
        if (
          unresolvedImportPaths.has(path) ||
          isImportWalkPlaceholderPath(path) ||
          isImportQueueSlotPath(path)
        ) {
          return null;
        }
        if (!fs.isFileViewable(vaultId, path)) {
          return { path, content: "", error: false as const };
        }
        if (previewBlockedRef.current[path]) {
          return { path, content: "", error: false as const, previewBlocked: true as const };
        }
        try {
          const file = await fs.getFileContent(vaultId, path);
          return { path, content: file?.content ?? "", error: false as const };
        } catch (error) {
          if (error instanceof FilePreviewTooLargeError) {
            return { path, content: "", error: false as const, previewBlocked: true as const };
          }
          return { path, content: "", error: true as const };
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const nextContents: Record<string, string> = {};
      const nextErrors: Record<string, true> = {};
      const nextBlocked: Record<string, true> = {};
      let failed = false;
      for (const entry of entries) {
        if (!entry) continue;
        if (entry.error) {
          nextErrors[entry.path] = true;
          failed = true;
        } else if ("previewBlocked" in entry && entry.previewBlocked) {
          nextBlocked[entry.path] = true;
        } else {
          nextContents[entry.path] = entry.content;
        }
      }
      setDiskContents(nextContents);
      setLoadErrors(nextErrors);
      setPreviewBlocked(nextBlocked);
      if (failed) showToast(t("modal.file_manager.toast.read_failed"));
    });
    return () => {
      cancelled = true;
    };
  }, [
    fs,
    showToast,
    t,
    unresolvedImportPaths,
    vaultId,
    workspace.openTabs,
    workspace.treeRevision,
  ]);

  const openInSystemFileManager = useCallback(
    async (logicalPath: string) => {
      const failure = await revealFailureKey(() => rpcRevealInFileManager(vaultId, logicalPath));
      if (failure) showToast(t(failure));
    },
    [showToast, t, vaultId],
  );

  const openInTerminal = useCallback(
    async (logicalPath: string) => {
      if (!isElectronRenderer()) {
        showToast(t("modal.file_manager.toast.open_terminal_unavailable"));
        return;
      }
      try {
        await rpcOpenInTerminal(vaultId, logicalPath);
      } catch (error) {
        showToast(t(desktopErrorI18nKey(error, "modal.file_manager.toast.open_terminal_failed")));
      }
    },
    [showToast, t, vaultId],
  );

  const getEditorContent = useCallback(
    (path: string): string => {
      if (path in workspace.editorDrafts) return workspace.editorDrafts[path];
      return diskContents[path] ?? "";
    },
    [diskContents, workspace.editorDrafts],
  );

  const saveFile = useCallback(
    async (path: string): Promise<boolean> => {
      for (let pass = 0; pass < MAX_DIRTY_DRAFT_SAVE_PASSES; pass++) {
        const current = workspaceRef.current;
        if (!current.dirtyPaths.includes(path)) return true;
        if (loadErrorsRef.current[path] || !(path in diskContentsRef.current)) {
          showToast(t("modal.file_manager.toast.read_failed"));
          return false;
        }
        const content =
          path in current.editorDrafts
            ? current.editorDrafts[path]
            : (diskContentsRef.current[path] ?? "");
        try {
          await fs.setFileContent(vaultId, path, content);
        } catch {
          showToast(t("modal.file_manager.toast.save_failed"));
          return false;
        }
        const fresh = workspaceRef.current;
        if (!fresh.dirtyPaths.includes(path)) return true;
        const freshContent = fresh.editorDrafts[path];
        if (freshContent !== undefined && freshContent !== content) continue;
        const stored = freshContent ?? content;
        setDiskContents((prev) => (prev[path] === stored ? prev : { ...prev, [path]: stored }));
        dispatch({ type: "mark_saved", path, content: stored });
        return true;
      }
      showToast(t("modal.file_manager.toast.save_failed"));
      return false;
    },
    [dispatch, fs, showToast, t, vaultId],
  );

  const saveFiles = useCallback(
    async (paths: readonly string[]): Promise<boolean> => {
      let blocked = false;
      for (const path of paths) {
        if (!workspaceRef.current.dirtyPaths.includes(path) || !fs.isFileEditable(vaultId, path)) {
          continue;
        }
        if (loadErrorsRef.current[path] || !(path in diskContentsRef.current)) {
          blocked = true;
          continue;
        }
        const ok = await saveFile(path);
        if (!ok) return false;
      }
      if (blocked) {
        showToast(t("modal.file_manager.toast.read_failed"));
        return false;
      }
      return true;
    },
    [fs, saveFile, showToast, t, vaultId],
  );

  const saveAllFiles = useCallback(() => saveFiles(workspaceRef.current.dirtyPaths), [saveFiles]);

  /** VS Code-style: click a file in the explorer → open/activate it in the editor. */
  const openFile = useCallback(
    (path: string) => {
      if (
        isInternalVaultPath(path) ||
        isImportWalkPlaceholderPath(path) ||
        isImportQueueSlotPath(path)
      )
        return;
      if (unresolvedImportPaths.has(path)) importPeekRef.current = path;
      dispatch({ type: "open_file", path });
    },
    [dispatch, unresolvedImportPaths],
  );

  const createFile = useCallback(
    (parentPath: string) => {
      void fs
        .createFile(vaultId, parentPath, t("modal.file_manager.default.new_file"))
        .then(async (path) => {
          if (!path) return;
          await syncTree();
          dispatch({ type: "expand_folder", path: parentPath, force: true });
          dispatch({ type: "mark_session_created", paths: [path] });
          dispatch({ type: "open_file", path });
          dispatch({ type: "start_rename", path });
        });
    },
    [dispatch, fs, syncTree, t, vaultId],
  );

  const createFolder = useCallback(
    (parentPath: string) => {
      void fs
        .createFolder(vaultId, parentPath, t("modal.file_manager.default.new_folder"))
        .then(async (path) => {
          if (!path) return;
          await syncTree();
          dispatch({ type: "expand_folder", path: parentPath, force: true });
          dispatch({ type: "mark_session_created", paths: [path] });
          dispatch({ type: "start_rename", path });
        });
    },
    [dispatch, fs, syncTree, t, vaultId],
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
      void (async () => {
        const siblings = siblingNames(await fs.getFileTree(vaultId), getParentPath(path)).filter(
          (n) => n !== fileBaseName(path),
        );
        if (siblings.includes(name)) {
          showToast(nameErrorMessage("duplicate"));
          dispatch({ type: "cancel_rename" });
          return;
        }
        const newPath = await fs.renamePath(vaultId, path, name);
        if (!newPath) {
          showToast(t("modal.file_manager.toast.rename_failed"));
          dispatch({ type: "cancel_rename" });
          return;
        }
        await syncTree();
        dispatch({ type: "remap_paths", map: { [path]: newPath } });
        dispatch({ type: "cancel_rename" });
      })();
    },
    [dispatch, fs, nameErrorMessage, showToast, syncTree, t, vaultId],
  );

  const requestDelete = useCallback(
    (path: string) => {
      if (path === "/") return;
      void (async () => {
        const currentTree = await fs.getFileTree(vaultId);
        const node = findNode(currentTree, path);
        if (!node) return;
        if (getSettingsSnapshot().ui.file_manager_confirm_delete === false) {
          const pathsToRemove =
            node.type === "folder" ? [...collectFilePaths(node, path), path] : [path];
          await fs.deletePath(vaultId, path);
          await syncTree();
          dispatch({ type: "remove_paths", paths: pathsToRemove });
          return;
        }
        dispatch({
          type: "set_delete_target",
          target: { path, name: node.name, isFolder: node.type === "folder" },
        });
      })();
    },
    [dispatch, fs, getSettingsSnapshot, syncTree, vaultId],
  );

  const confirmDelete = useCallback(() => {
    const target = workspace.deleteTarget;
    if (!target) return;
    void (async () => {
      const currentTree = await fs.getFileTree(vaultId);
      const node = findNode(currentTree, target.path);
      const pathsToRemove =
        node?.type === "folder"
          ? [...collectFilePaths(node, target.path), target.path]
          : [target.path];
      await fs.deletePath(vaultId, target.path);
      await syncTree();
      dispatch({ type: "remove_paths", paths: pathsToRemove });
      dispatch({ type: "set_delete_target", target: null });
    })();
  }, [dispatch, fs, syncTree, vaultId, workspace.deleteTarget]);

  const movePath = useCallback(
    (fromPath: string, toFolderPath: string) => {
      void fs.movePath(vaultId, fromPath, toFolderPath).then(async (newPath) => {
        if (!newPath || newPath === fromPath) return;
        await syncTree();
        dispatch({ type: "remap_paths", map: { [fromPath]: newPath } });
      });
    },
    [dispatch, fs, syncTree, vaultId],
  );

  const revealPendingImport = useCallback(
    (
      sessionId: number,
      parentPath: string,
      relativePaths: readonly string[],
      planTree: FileTreeNode,
    ) => {
      setPendingImports((prev) =>
        replaceSessionPending(
          prev,
          sessionId,
          pendingEntriesFromRelativePaths(parentPath, relativePaths, sessionId, planTree),
        ),
      );
      for (const folder of foldersToExpandForImportBatch(parentPath, relativePaths)) {
        dispatch({ type: "expand_folder", path: folder });
      }
    },
    [dispatch],
  );

  const applyImportedBatch = useCallback(
    async (
      sessionId: number,
      parentPath: string,
      files: readonly DroppedImportFile[],
      options: ImportFileOptions | undefined,
      signal: AbortSignal,
      planTree: FileTreeNode,
    ) => {
      const plannedByRelative = plannedImportPathMap(
        parentPath,
        files.map((file) => file.relativePath),
        planTree,
      );
      const skeleton = files.length > IMPORT_EXPLORER_SKELETON_FILES;
      const result = await importLogicalFiles(
        files.map(({ file, relativePath, osPath, byteSize }) => ({
          name: file.name,
          relativePath,
          file,
          osPath,
          byteSize,
          mime: file.type,
        })),
        {
          vaultId,
          parentPath,
          skippedUnsupported: options?.skippedUnsupported,
          readContent: async () => "",
          ensureFolder: fs.ensureFolder,
          importFile: fs.importFile,
          signal,
          importSlots: importFileSlots(desktopProcessorCount(), false),
          sealImports: () => rpcVaultFsImportSeal(vaultId).then(() => undefined),
          importBinaryFile: async (id, parent, name, logical) => {
            if (logical.osPath) {
              return fs.importFileFromOsPath(id, parent, name, logical.osPath, true);
            }
            return fs.importFileFromBytes(
              id,
              parent,
              name,
              binarySourceFromDropped(logical.file, logical.osPath, logical.byteSize),
            );
          },
          onImportStart: (path, relativePath) => {
            if (signal.aborted) return;
            const planned = plannedByRelative.get(relativePath) ?? path;
            setActiveImportWrites((prev) =>
              upsertActiveImportWrite(prev, {
                sessionId,
                path: planned,
                startedAt: Date.now(),
              }),
            );
          },
          onImported: (path, relativePath) => {
            const planned = plannedByRelative.get(relativePath) ?? null;
            const marked = planned && planned !== path ? [path, planned] : [path];
            dispatch({ type: "mark_session_created", paths: marked });
            if (skeleton) {
              commitLandedImportPaths(
                rememberLandedImportPaths(landedImportPathsRef.current, marked),
              );
            } else {
              setTree((prev) => attachImportedPath(prev, path));
              setPendingImports((prev) => dropResolvedPending(prev, path, planned, sessionId));
            }
            setActiveImportWrites((prev) =>
              dropActiveImportWritePath(prev, planned ?? path, sessionId),
            );
          },
        },
      );

      if (signal.aborted && result.importedPaths.length === 0) {
        clearImportSession(sessionId);
        return;
      }

      if (!signal.aborted && options?.openFirstViewable && !importPeekRef.current) {
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
      if (result.readFailureName) {
        showToast(t("modal.file_manager.toast.import_failed", { name: result.readFailureName }));
      }
      if (result.writeFailureName) {
        showToast(
          t("modal.file_manager.toast.import_write_failed", { name: result.writeFailureName }),
        );
      }

      if (result.importedPaths.length === 0) {
        try {
          await syncTree();
        } catch {
          /* Placeholders for this batch are still cleared. */
        }
        clearImportSession(sessionId);
        return;
      }

      await publishImportedTree();
      clearImportSession(sessionId);
      for (const folder of result.foldersToExpand) {
        dispatch({ type: "expand_folder", path: folder });
      }
      dispatch({ type: "mark_session_created", paths: result.importedPaths });
    },
    [
      clearImportSession,
      commitLandedImportPaths,
      dispatch,
      fs,
      publishImportedTree,
      showToast,
      syncTree,
      t,
      vaultId,
    ],
  );

  const importFiles = useCallback(
    async (
      parentPath: string,
      files: readonly DroppedImportFile[],
      options?: ImportFileOptions,
    ) => {
      if (writesLockedRef.current) {
        showToast(t("modal.file_manager.toast.close_queued"));
        return;
      }
      const sessionId = beginImportSession();
      const signal = importAbortRef.current.signal;
      const planTree = treeRef.current;
      const relativePaths = files.map((file) => file.relativePath);
      importPeekRef.current = null;
      if (files.length > IMPORT_EXPLORER_SKELETON_FILES) {
        setPendingImports((prev) =>
          replaceSessionPending(prev, sessionId, walkPlaceholderEntries(parentPath, sessionId)),
        );
        dispatch({ type: "expand_folder", path: parentPath });
        await yieldToPaint();
      }
      revealPendingImport(sessionId, parentPath, relativePaths, planTree);
      await yieldToPaint();
      try {
        await applyImportedBatch(sessionId, parentPath, files, options, signal, planTree);
      } catch {
        await publishImportedTree();
        clearImportSession(sessionId);
        if (!signal.aborted) {
          showToast(t("modal.file_manager.toast.import_seal_failed"));
        }
      } finally {
        endImportSession(sessionId);
      }
    },
    [
      applyImportedBatch,
      beginImportSession,
      clearImportSession,
      dispatch,
      endImportSession,
      publishImportedTree,
      revealPendingImport,
      showToast,
      t,
    ],
  );

  const importOsDrop = useCallback(
    async (parentPath: string, snapshot: OsDropSnapshot, options?: ImportFileOptions) => {
      if (writesLockedRef.current) {
        showToast(t("modal.file_manager.toast.close_queued"));
        return;
      }
      const sessionId = beginImportSession();
      const signal = importAbortRef.current.signal;
      importPeekRef.current = null;
      setPendingImports((prev) =>
        replaceSessionPending(prev, sessionId, walkPlaceholderEntries(parentPath, sessionId)),
      );
      dispatch({ type: "expand_folder", path: parentPath });
      try {
        const listed = await listFilesFromOsDropSnapshot(snapshot);
        if (signal.aborted || !importInFlightRef.current.has(sessionId)) return;
        if (listed.truncated) {
          showToast(t("modal.file_manager.toast.import_truncated"));
        }
        const files = listed.files;
        if (files.length === 0) {
          clearImportSession(sessionId);
          if (!listed.truncated) showToast(t("modal.file_manager.toast.import_drop_empty"));
          return;
        }
        const planTree = treeRef.current;
        revealPendingImport(
          sessionId,
          parentPath,
          files.map((file) => file.relativePath),
          planTree,
        );
        await yieldToPaint();
        await applyImportedBatch(sessionId, parentPath, files, options, signal, planTree);
      } catch {
        await publishImportedTree();
        clearImportSession(sessionId);
        if (!signal.aborted) {
          showToast(t("modal.file_manager.toast.import_seal_failed"));
        }
      } finally {
        endImportSession(sessionId);
      }
    },
    [
      applyImportedBatch,
      beginImportSession,
      clearImportSession,
      dispatch,
      endImportSession,
      publishImportedTree,
      revealPendingImport,
      showToast,
      t,
    ],
  );

  const continueVaultClose = useCallback(() => {
    if (importInFlightRef.current.size > 0) {
      closeVaultAfterImportRef.current = true;
      return;
    }
    closeVaultAfterImportRef.current = false;
    onVaultCloseConfirmed?.();
  }, [onVaultCloseConfirmed]);

  const cancelImportAndClose = useCallback(() => {
    const closingVault = workspace.unsavedPrompt?.type === "close_vault_import";
    importAbortRef.current.abort();
    setPendingImports([]);
    commitLandedImportPaths(new Set());
    setActiveImportWrites([]);
    if (hasUnsavedWorkspaceChanges(workspace)) {
      dispatch({
        type: "set_unsaved_prompt",
        prompt: { type: closingVault ? "close_vault" : "dismiss_workspace" },
      });
      return;
    }
    dispatch({ type: "set_unsaved_prompt", prompt: null });
    if (!closingVault) {
      onDismissConfirmed?.();
      return;
    }
    continueVaultClose();
  }, [commitLandedImportPaths, continueVaultClose, dispatch, onDismissConfirmed, workspace]);

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
      case "close_tabs":
        dispatch({
          type: "discard_unsaved_and",
          next: { type: "close_tabs", paths: prompt.paths },
        });
        return;
      case "dismiss_workspace":
        dispatch({
          type: "discard_unsaved_and",
          next: { type: "set_unsaved_prompt", prompt: null },
        });
        onDismissConfirmed?.();
        return;
      case "close_vault":
        dispatch({
          type: "discard_unsaved_and",
          next: { type: "set_unsaved_prompt", prompt: null },
        });
        continueVaultClose();
        return;
      case "import_in_progress":
      case "close_vault_import":
        cancelImportAndClose();
        return;
    }
  }, [
    cancelImportAndClose,
    continueVaultClose,
    dispatch,
    onDismissConfirmed,
    workspace.unsavedPrompt,
  ]);

  const confirmSaveUnsaved = useCallback(() => {
    const prompt = workspace.unsavedPrompt;
    if (!prompt) return;

    void (async () => {
      switch (prompt.type) {
        case "close_tab": {
          const ok = await saveFile(prompt.path);
          if (!ok) return;
          dispatch({
            type: "discard_unsaved_and",
            next: resolveUnsavedPrompt(workspace, prompt),
          });
          return;
        }
        case "close_tabs": {
          const ok = await saveFiles(prompt.paths);
          if (!ok) return;
          dispatch({
            type: "discard_unsaved_and",
            next: resolveUnsavedPrompt(workspace, prompt),
          });
          return;
        }
        case "dismiss_workspace": {
          const ok = await saveAllFiles();
          if (!ok) return;
          dispatch({
            type: "discard_unsaved_and",
            next: resolveUnsavedPrompt(workspace, prompt),
          });
          onDismissConfirmed?.();
          return;
        }
        case "close_vault": {
          const ok = await saveAllFiles();
          if (!ok) return;
          dispatch({
            type: "discard_unsaved_and",
            next: resolveUnsavedPrompt(workspace, prompt),
          });
          continueVaultClose();
          return;
        }
        case "import_in_progress":
        case "close_vault_import":
          dispatch({ type: "set_unsaved_prompt", prompt: null });
      }
    })();
  }, [
    continueVaultClose,
    dispatch,
    onDismissConfirmed,
    saveAllFiles,
    saveFile,
    saveFiles,
    workspace,
  ]);

  return {
    vaultId,
    writesLocked,
    tree,
    displayTree,
    treeStatus,
    retryTree,
    workspace,
    getEditorContent,
    fileLoadError: (path: string) =>
      loadErrors[path]
        ? t("modal.file_manager.viewer.read_failed_body", { name: fileBaseName(path) })
        : null,
    isFileContentReady: (path: string) =>
      !unresolvedImportPaths.has(path) &&
      (path in diskContents || Boolean(loadErrors[path]) || Boolean(previewBlocked[path])),
    isFileEditable: (path: string) =>
      !writesLocked &&
      fs.isFileEditable(vaultId, path) &&
      !loadErrors[path] &&
      path in diskContents &&
      !unresolvedImportPaths.has(path),
    isFileViewable: (path: string) => fs.isFileViewable(vaultId, path) && !previewBlocked[path],
    isFileImage: (path: string) => fs.isFileImage(vaultId, path),
    isImportPending: (path: string) => unresolvedImportPaths.has(path),
    isImportProcessing: (path: string) => processingPathSet.has(path),
    isImportWalkPlaceholder: isImportWalkPlaceholderPath,
    isImportQueueSlot: isImportQueueSlotPath,
    saveFile,
    saveAllFiles,
    openFile,
    createFile,
    createFolder,
    commitRename,
    requestDelete,
    confirmDelete,
    movePath,
    importFiles,
    importOsDrop,
    importBusy,
    importBudget,
    cancelImportAndClose,
    toast,
    openInSystemFileManager,
    openInTerminal,
    showToast,
    dismissToast,
    confirmUnsaved,
    confirmSaveUnsaved,
    dispatch,
  };
}

export type FileManagerApi = ReturnType<typeof useVaultFileManager>;

export function hasUnsavedEditableTabs(fm: FileManagerApi): boolean {
  return fm.workspace.dirtyPaths.some(
    (path) =>
      fm.isFileEditable(path) || !fm.isFileContentReady(path) || Boolean(fm.fileLoadError(path)),
  );
}
