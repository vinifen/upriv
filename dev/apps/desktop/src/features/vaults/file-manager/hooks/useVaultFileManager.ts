import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectFilePaths,
  fileBaseName,
  fileNameErrorI18nKey,
  findNode,
  formatImportOutcomeToast,
  importBatchNeedsRetry,
  importLogicalFiles,
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
  filesStillPendingImport,
  releaseLandedImportPaths,
  isPendingImportTimedOut,
  type ActiveImportWrite,
  type FileManagerEntry,
  type FileNameErrorCode,
  type FileTreeNode,
  type PendingImportEntry,
  type VaultWorkspaceAction,
} from "@upriv/shared";
import { useVaultFileSystemService } from "@/platform/services";
import { useToast, useLoadingBudget } from "@upriv/shared/react";
import { useFileManager } from "../FileManagerContext";
import { useTranslation } from "@/i18n";
import { useAppSettingsContext } from "@/features/system/settings";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcOpenInTerminal, rpcRevealInFileManager } from "@/lib/rpc";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
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

type LastDesktopImport =
  | {
      kind: "files";
      parentPath: string;
      files: readonly DroppedImportFile[];
      options?: ImportFileOptions;
      planTree: FileTreeNode;
    }
  | {
      kind: "drop";
      parentPath: string;
      snapshot: OsDropSnapshot;
      options?: ImportFileOptions;
    };

interface UseVaultFileManagerOptions {
  entry: FileManagerEntry;
  dispatch: (action: VaultWorkspaceAction) => void;
  onDismissConfirmed?: () => void;
  /** Queued close: keep the current files. New drafts and imports wait. */
  writesLocked?: boolean;
}

const EMPTY_TREE: FileTreeNode = { name: "", type: "folder", children: [] };

export function useVaultFileManager({
  entry,
  dispatch,
  onDismissConfirmed,
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
  const [tree, setTree] = useState<FileTreeNode>(EMPTY_TREE);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const [diskContents, setDiskContents] = useState<Record<string, string>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, true>>({});
  const [previewBlocked, setPreviewBlocked] = useState<Record<string, true>>({});
  const previewBlockedRef = useRef(previewBlocked);
  previewBlockedRef.current = previewBlocked;
  const [importBusy, setImportBusy] = useState(false);
  const [timedOutSessionIds, setTimedOutSessionIds] = useState<number[]>([]);
  const [inFlightIds, setInFlightIds] = useState<number[]>([]);
  const importSessionSeqRef = useRef(0);
  const importInFlightRef = useRef(new Set<number>());
  const importAbortRef = useRef(new AbortController());
  const lastBySessionRef = useRef(new Map<number, LastDesktopImport>());
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
  const importTimedOut = timedOutSessionIds.length > 0;
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
    if (importBusy) return;
    if (workspace.unsavedPrompt?.type !== "import_in_progress") return;
    dispatch({ type: "set_unsaved_prompt", prompt: null });
  }, [dispatch, importBusy, workspace.unsavedPrompt]);

  const beginImportSession = useCallback(() => {
    if (importAbortRef.current.signal.aborted) {
      importAbortRef.current = new AbortController();
    }
    const sessionId = importSessionSeqRef.current + 1;
    importSessionSeqRef.current = sessionId;
    importInFlightRef.current.add(sessionId);
    setInFlightIds([...importInFlightRef.current]);
    setImportBusy(true);
    return sessionId;
  }, []);

  const endImportSession = useCallback(
    (sessionId: number, failed: boolean) => {
      importInFlightRef.current.delete(sessionId);
      setImportInFlight(vaultId, importInFlightRef.current.size > 0);
      setInFlightIds([...importInFlightRef.current]);
      setActiveImportWrites((prev) => dropActiveImportWritesForSession(prev, sessionId));
      setImportBusy(importInFlightRef.current.size > 0);
      setTimedOutSessionIds((prev) =>
        failed
          ? prev.includes(sessionId)
            ? prev
            : [...prev, sessionId]
          : prev.filter((id) => id !== sessionId),
      );
      if (!failed) lastBySessionRef.current.delete(sessionId);
    },
    [setImportInFlight, vaultId],
  );

  const syncTree = useCallback(async () => {
    const revision = await fs.getTreeRevision(vaultId);
    dispatch({ type: "tree_mutated", revision });
  }, [dispatch, fs, vaultId]);

  useEffect(() => {
    let cancelled = false;
    void fs
      .getFileTree(vaultId)
      .then((next) => {
        if (!cancelled) setTree(next);
      })
      .catch(() => {
        if (!cancelled) setTree(EMPTY_TREE);
      });
    return () => {
      cancelled = true;
    };
  }, [fs, vaultId, workspace.treeRevision]);

  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast(2800);

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
      if (!isElectronRenderer()) {
        showToast(t("modal.file_manager.toast.open_system_unavailable"));
        return;
      }
      try {
        await rpcRevealInFileManager(vaultId, logicalPath);
      } catch (error) {
        showToast(t(desktopErrorI18nKey(error, "modal.file_manager.toast.open_system_failed")));
      }
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
      if (!workspace.dirtyPaths.includes(path)) return true;
      if (loadErrors[path] || !(path in diskContents)) {
        showToast(t("modal.file_manager.toast.read_failed"));
        return false;
      }
      const content = getEditorContent(path);
      try {
        await fs.setFileContent(vaultId, path, content);
        setDiskContents((prev) => ({ ...prev, [path]: content }));
        dispatch({ type: "mark_saved", path, content });
        return true;
      } catch {
        showToast(t("modal.file_manager.toast.save_failed"));
        return false;
      }
    },
    [
      diskContents,
      dispatch,
      fs,
      getEditorContent,
      loadErrors,
      showToast,
      t,
      vaultId,
      workspace.dirtyPaths,
    ],
  );

  const saveAllFiles = useCallback(async (): Promise<boolean> => {
    let blocked = false;
    for (const path of workspace.dirtyPaths) {
      if (!fs.isFileEditable(vaultId, path)) continue;
      if (loadErrors[path] || !(path in diskContents)) {
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
  }, [diskContents, fs, loadErrors, saveFile, showToast, t, vaultId, workspace.dirtyPaths]);

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
          importBinaryFile: async (id, parent, name, logical) => {
            if (logical.osPath) {
              return fs.importFileFromOsPath(id, parent, name, logical.osPath);
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

      if (signal.aborted) {
        setPendingImports((prev) => dropSessionPending(prev, sessionId));
        commitLandedImportPaths(
          releaseLandedImportPaths(
            landedImportPathsRef.current,
            pendingImportsRef.current,
            sessionId,
          ),
        );
        return;
      }

      if (options?.openFirstViewable && !importPeekRef.current) {
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

      if (importBatchNeedsRetry(result)) {
        if (result.readFailureName) {
          showToast(t("modal.file_manager.toast.import_failed", { name: result.readFailureName }));
        }
        if (result.writeFailureName) {
          showToast(
            t("modal.file_manager.toast.import_write_failed", { name: result.writeFailureName }),
          );
        }
        throw new Error("import-batch-failed");
      }

      if (result.importedPaths.length === 0) {
        await syncTree();
        setPendingImports((prev) => dropSessionPending(prev, sessionId));
        commitLandedImportPaths(
          releaseLandedImportPaths(
            landedImportPathsRef.current,
            pendingImportsRef.current,
            sessionId,
          ),
        );
        return;
      }

      const nextTree = await fs.getFileTree(vaultId);
      const revision = await fs.getTreeRevision(vaultId);
      setTree(nextTree);
      setPendingImports((prev) => dropSessionPending(prev, sessionId));
      commitLandedImportPaths(
        releaseLandedImportPaths(
          landedImportPathsRef.current,
          pendingImportsRef.current,
          sessionId,
        ),
      );
      dispatch({ type: "tree_mutated", revision });
      for (const folder of result.foldersToExpand) {
        dispatch({ type: "expand_folder", path: folder });
      }
      dispatch({ type: "mark_session_created", paths: result.importedPaths });
    },
    [commitLandedImportPaths, dispatch, fs, showToast, syncTree, t, vaultId],
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
      lastBySessionRef.current.set(sessionId, {
        kind: "files",
        parentPath,
        files,
        options,
        planTree,
      });
      importPeekRef.current = null;
      revealPendingImport(
        sessionId,
        parentPath,
        files.map((file) => file.relativePath),
        planTree,
      );
      let failed = false;
      try {
        await applyImportedBatch(sessionId, parentPath, files, options, signal, planTree);
      } catch {
        if (signal.aborted) return;
        failed = true;
        await syncTree();
      } finally {
        endImportSession(sessionId, failed);
      }
    },
    [
      applyImportedBatch,
      beginImportSession,
      endImportSession,
      revealPendingImport,
      showToast,
      syncTree,
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
      lastBySessionRef.current.set(sessionId, { kind: "drop", parentPath, snapshot, options });
      importPeekRef.current = null;
      setPendingImports((prev) =>
        replaceSessionPending(prev, sessionId, walkPlaceholderEntries(parentPath, sessionId)),
      );
      dispatch({ type: "expand_folder", path: parentPath });
      let failed = false;
      try {
        const listed = await listFilesFromOsDropSnapshot(snapshot);
        if (signal.aborted || !importInFlightRef.current.has(sessionId)) return;
        if (listed.truncated) {
          showToast(t("modal.file_manager.toast.import_truncated"));
        }
        const files = listed.files;
        if (files.length === 0) {
          setPendingImports((prev) => dropSessionPending(prev, sessionId));
          if (!listed.truncated) showToast(t("modal.file_manager.toast.import_drop_empty"));
          return;
        }
        const planTree = treeRef.current;
        lastBySessionRef.current.set(sessionId, {
          kind: "files",
          parentPath,
          files,
          options,
          planTree,
        });
        revealPendingImport(
          sessionId,
          parentPath,
          files.map((file) => file.relativePath),
          planTree,
        );
        await applyImportedBatch(sessionId, parentPath, files, options, signal, planTree);
      } catch {
        if (signal.aborted) return;
        failed = true;
        await syncTree();
      } finally {
        endImportSession(sessionId, failed);
      }
    },
    [
      applyImportedBatch,
      beginImportSession,
      dispatch,
      endImportSession,
      revealPendingImport,
      showToast,
      syncTree,
      t,
    ],
  );

  const retryImport = useCallback(() => {
    const timedOut = [...lastBySessionRef.current.entries()].filter(
      ([id]) => !importInFlightRef.current.has(id),
    );
    for (const [sessionId, last] of timedOut) {
      const leftover = pendingImportsRef.current.filter((entry) => entry.sessionId === sessionId);
      const landedNow = landedImportPathsRef.current;
      lastBySessionRef.current.delete(sessionId);
      setTimedOutSessionIds((prev) => prev.filter((id) => id !== sessionId));
      const kept = leftover.filter((entry) => entry.type === "file" && landedNow.has(entry.path));
      if (kept.length > 0) {
        setTree((prev) => kept.reduce((next, entry) => attachImportedPath(next, entry.path), prev));
      }
      setPendingImports((prev) => dropSessionPending(prev, sessionId));
      commitLandedImportPaths(releaseLandedImportPaths(landedNow, leftover, sessionId));
      if (last.kind === "drop") {
        void importOsDrop(last.parentPath, last.snapshot, last.options);
        continue;
      }
      const remaining = filesStillPendingImport(
        last.files,
        last.parentPath,
        leftover,
        last.planTree,
        landedNow,
      );
      if (remaining.length === 0) continue;
      void importFiles(last.parentPath, remaining, last.options);
    }
  }, [commitLandedImportPaths, importFiles, importOsDrop]);

  const cancelImportAndClose = useCallback(() => {
    importAbortRef.current.abort();
    lastBySessionRef.current.clear();
    setPendingImports([]);
    commitLandedImportPaths(new Set());
    setActiveImportWrites([]);
    setTimedOutSessionIds([]);
    if (hasUnsavedWorkspaceChanges(workspace)) {
      dispatch({ type: "set_unsaved_prompt", prompt: { type: "dismiss_workspace" } });
      return;
    }
    dispatch({ type: "set_unsaved_prompt", prompt: null });
    onDismissConfirmed?.();
  }, [commitLandedImportPaths, dispatch, onDismissConfirmed, workspace]);

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
      case "import_in_progress":
        cancelImportAndClose();
        return;
    }
  }, [cancelImportAndClose, dispatch, onDismissConfirmed, workspace.unsavedPrompt]);

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
        case "import_in_progress":
          dispatch({ type: "set_unsaved_prompt", prompt: null });
      }
    })();
  }, [dispatch, onDismissConfirmed, saveAllFiles, saveFile, workspace]);

  return {
    vaultId,
    writesLocked,
    tree,
    displayTree,
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
    isImportTimedOut: (path: string) =>
      isPendingImportTimedOut(
        path,
        pendingImports,
        timedOutSessionIds,
        inFlightIds,
        processingPathSet,
      ),
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
    importTimedOut,
    importBudget,
    retryImport,
    cancelImportAndClose,
    toastMessage,
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
