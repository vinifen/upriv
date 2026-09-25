import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useFileManager } from "../FileManagerContext";
import { FileEditorPane } from "../editor/FileEditorPane";
import { FileManagerDialogs } from "../dialogs/FileManagerDialogs";
import { FileManagerTabBar } from "../editor/FileManagerTabBar";
import { FileTreeContextMenu } from "../tree/FileTreeContextMenu";
import { FileTreePanel } from "../tree/FileTreePanel";
import { PaneResizeHandle } from "./PaneResizeHandle";
import {
  clampCanonicalTreeSplitPercent,
  persistableTreeSplitPercent,
  displayTreeSplitPercent,
  percentFromDelta,
  TREE_SPLIT_DEFAULT_PERCENT,
  type FileManagerEntry,
  type VaultWorkspaceAction,
} from "@upriv/shared";
import { useWorkspacePersistence } from "@upriv/shared/react";
import { useAppSettingsContext } from "@/features/system/settings";
import { hasUnsavedEditableTabs, useVaultFileManager } from "../hooks/useVaultFileManager";
import { useVaultFileSystemService } from "@/platform/services";
import { allowFileManagerDrop, beginOsFileImport } from "../lib/osFileDrop";
import { osFileImportParentPath } from "../lib/osFileImportTarget";
import { useNativeOsFileDrop } from "../hooks/useNativeOsFileDrop";

interface FileManagerWorkspaceProps {
  entry: FileManagerEntry;
  active?: boolean;
  writesLocked?: boolean;
  onDismissConfirmed: () => void;
}

export function FileManagerWorkspace({
  entry,
  active = true,
  writesLocked = false,
  onDismissConfirmed,
}: FileManagerWorkspaceProps) {
  const { dispatchWorkspace } = useFileManager();
  const { settings, patchSettings } = useAppSettingsContext();
  const fs = useVaultFileSystemService();
  const { showError } = useErrorToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState(0);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const axis = isMobile ? "y" : "x";

  const settingsPercent = clampCanonicalTreeSplitPercent(
    settings.ui.file_manager_tree_split_percent ?? TREE_SPLIT_DEFAULT_PERCENT,
  );
  const [livePercent, setLivePercent] = useState(settingsPercent);
  const livePercentRef = useRef(settingsPercent);
  const draggingRef = useRef(false);
  const dragStartPercentRef = useRef(settingsPercent);
  const dragStartSizeRef = useRef(0);
  const [dragSize, setDragSize] = useState<number | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    livePercentRef.current = settingsPercent;
    setLivePercent(settingsPercent);
  }, [settingsPercent]);

  const dispatch = useCallback(
    (action: VaultWorkspaceAction) => dispatchWorkspace(entry.vaultId, action),
    [dispatchWorkspace, entry.vaultId],
  );

  const fm = useVaultFileManager({
    entry,
    dispatch,
    onDismissConfirmed,
    writesLocked,
  });

  useWorkspacePersistence({
    vaultId: entry.vaultId,
    workspace: entry.workspace,
    fs,
    dispatch,
    suspend: fm.importBusy,
  });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      if (draggingRef.current) return;
      const rect = el.getBoundingClientRect();
      const next = axis === "y" ? rect.height : rect.width;
      setContainerSize((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [axis]);

  const handleSplitDragStart = useCallback(() => {
    const measured = containerRef.current
      ? axis === "y"
        ? containerRef.current.getBoundingClientRect().height
        : containerRef.current.getBoundingClientRect().width
      : 0;
    const size = containerSize > 0 ? containerSize : measured;
    draggingRef.current = true;
    dragStartPercentRef.current = livePercentRef.current;
    dragStartSizeRef.current = size;
    setDragSize(size > 0 ? size : null);
  }, [axis, containerSize]);

  const handleSplitDrag = useCallback(
    (deltaPx: number) => {
      const percent = percentFromDelta(
        dragStartPercentRef.current,
        deltaPx,
        dragStartSizeRef.current,
        axis,
      );
      livePercentRef.current = percent;
      setLivePercent(percent);
    },
    [axis],
  );

  const persistSplitPercent = useCallback(
    (next: number) => {
      const percent = persistableTreeSplitPercent(next);
      livePercentRef.current = percent;
      setLivePercent(percent);
      if (percent === settingsPercent) return;
      void patchSettings({ ui: { file_manager_tree_split_percent: percent } });
    },
    [patchSettings, settingsPercent],
  );

  const handleSplitDragEnd = useCallback(() => {
    draggingRef.current = false;
    setDragSize(null);
    persistSplitPercent(livePercentRef.current);
  }, [persistSplitPercent]);

  const splitPercent = displayTreeSplitPercent(livePercent, dragSize ?? containerSize, axis);

  useNativeOsFileDrop({
    enabled: active,
    getParentPath: () => osFileImportParentPath(fm.tree, fm.workspace),
    isInternalDrag: () => Boolean(fm.workspace.dragSourcePath),
    importOsDrop: fm.importOsDrop,
    onImported: () => fm.dispatch({ type: "set_drag", source: null, target: null }),
    onError: (error) => showError(error, "error.unexpected"),
  });

  const handleWorkspaceDragOver = (event: DragEvent) => {
    allowFileManagerDrop(event, fm.workspace.dragSourcePath ? "move" : "copy");
  };

  const handleWorkspaceDrop = (event: DragEvent) => {
    if (
      beginOsFileImport(
        event,
        osFileImportParentPath(fm.tree, fm.workspace),
        fm.importOsDrop,
        (error) => showError(error, "error.unexpected"),
        { openFirstViewable: true },
      )
    ) {
      fm.dispatch({ type: "set_drag", source: null, target: null });
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-container-high md:flex-row"
        onDragEnter={active ? handleWorkspaceDragOver : undefined}
        onDragOver={active ? handleWorkspaceDragOver : undefined}
        onDrop={active ? handleWorkspaceDrop : undefined}
      >
        <FileTreePanel fm={fm} splitPercent={splitPercent} layout={isMobile ? "column" : "row"} />
        <PaneResizeHandle
          axis={axis}
          value={livePercent}
          onDragStart={handleSplitDragStart}
          onDrag={handleSplitDrag}
          onDragEnd={handleSplitDragEnd}
          onNudge={persistSplitPercent}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <FileManagerTabBar
            workspace={entry.workspace}
            onWorkspaceAction={dispatch}
            showSave={hasUnsavedEditableTabs(fm)}
            onSave={fm.saveAllFiles}
          />
          <FileEditorPane fm={fm} />
        </div>
      </div>
      <FileTreeContextMenu fm={fm} tree={fm.tree} />
      <FileManagerDialogs fm={fm} promptsOpen={active} />
    </>
  );
}
