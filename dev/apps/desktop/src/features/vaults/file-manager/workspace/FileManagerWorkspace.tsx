import { memo, useCallback, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useFileManager } from "../FileManagerContext";
import { FileEditorPane } from "../editor/FileEditorPane";
import { FileManagerDialogs } from "../dialogs/FileManagerDialogs";
import { FileManagerTabBar } from "../editor/FileManagerTabBar";
import { FileTreeContextMenu } from "../tree/FileTreeContextMenu";
import { ExplorerToggle, FileTreePanel } from "../tree/FileTreePanel";
import { PaneResizeHandle } from "./PaneResizeHandle";
import type { FileManagerEntry, VaultWorkspaceAction } from "@upriv/shared";
import {
  useFileManagerEntry,
  useTreeSplitDrag,
  useWorkspacePersistence,
} from "@upriv/shared/react";
import { hasUnsavedEditableTabs, useVaultFileManager } from "../hooks/useVaultFileManager";
import { useVaultFileSystemService } from "@/platform/services";
import { allowFileManagerDrop, beginOsFileImport } from "../lib/osFileDrop";
import { osFileImportParentPath } from "../lib/osFileImportTarget";
import { useNativeOsFileDrop } from "../hooks/useNativeOsFileDrop";

interface FileManagerWorkspaceProps {
  vaultId: string;
  active?: boolean;
  writesLocked?: boolean;
  onDismissConfirmed: (vaultId: string) => void;
  onVaultCloseConfirmed?: (vaultId: string) => void;
}

/** One vault's file manager. It draws again for that vault's changes only. */
export const FileManagerWorkspace = memo(function FileManagerWorkspace({
  vaultId,
  ...props
}: FileManagerWorkspaceProps) {
  const entry = useFileManagerEntry(vaultId);
  return entry ? <OpenFileManagerWorkspace entry={entry} {...props} /> : null;
});

function OpenFileManagerWorkspace({
  entry,
  active = true,
  writesLocked = false,
  onDismissConfirmed,
  onVaultCloseConfirmed,
}: Omit<FileManagerWorkspaceProps, "vaultId"> & { entry: FileManagerEntry }) {
  const vaultId = entry.vaultId;
  const { dispatchWorkspace } = useFileManager();
  const fs = useVaultFileSystemService();
  const containerRef = useRef<HTMLDivElement>(null);
  const explorerRef = useRef<HTMLElement>(null);
  const [containerSize, setContainerSize] = useState(0);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const axis = isMobile ? "y" : "x";

  const dispatch = useCallback(
    (action: VaultWorkspaceAction) => dispatchWorkspace(vaultId, action),
    [dispatchWorkspace, vaultId],
  );
  const handleDismissConfirmed = useCallback(
    () => onDismissConfirmed(vaultId),
    [onDismissConfirmed, vaultId],
  );
  const handleVaultCloseConfirmed = useCallback(
    () => onVaultCloseConfirmed?.(vaultId),
    [onVaultCloseConfirmed, vaultId],
  );

  const fm = useVaultFileManager({
    entry,
    dispatch,
    onDismissConfirmed: handleDismissConfirmed,
    onVaultCloseConfirmed: handleVaultCloseConfirmed,
    writesLocked,
  });

  useWorkspacePersistence({
    vaultId,
    workspace: entry.workspace,
    tree: fm.treeStatus === "ready" ? fm.tree : null,
    fs,
    dispatch,
    suspend: fm.importBusy,
  });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = axis === "y" ? rect.height : rect.width;
      setContainerSize((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [axis]);

  // A move sizes the explorer through its style: drawing the workspace on every move is too slow.
  const paintExplorerExtent = useCallback(
    (visualPercent: number) => {
      const explorer = explorerRef.current;
      if (!explorer) return;
      explorer.style.display = visualPercent === 0 ? "none" : "";
      explorer.style[axis === "y" ? "height" : "width"] = `${visualPercent}%`;
    },
    [axis],
  );

  const split = useTreeSplitDrag({
    savedPercent: entry.workspace.treeSplitPercent,
    containerSize,
    axis,
    dispatch,
    onDragFrame: paintExplorerExtent,
  });

  // A redraw during a drag would put the size from before the grab back.
  useLayoutEffect(() => {
    split.repaintDrag();
  });

  const explorerCollapsed = entry.workspace.explorerCollapsed;

  useNativeOsFileDrop({
    enabled: active,
    getParentPath: () => osFileImportParentPath(fm.tree, fm.workspace),
    isInternalDrag: () => Boolean(fm.workspace.dragSourcePath),
    importOsDrop: fm.importOsDrop,
    onImported: () => fm.dispatch({ type: "set_drag", source: null, target: null }),
    onError: fm.showError,
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
        fm.showError,
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
        {explorerCollapsed ? null : (
          <>
            <FileTreePanel
              fm={fm}
              paneRef={explorerRef}
              splitPercent={split.visualPercent}
              layout={isMobile ? "column" : "row"}
            />
            <PaneResizeHandle
              axis={axis}
              value={split.percent}
              onDragStart={split.onDragStart}
              onDrag={split.onDrag}
              onDragEnd={split.onDragEnd}
              onNudge={split.commit}
            />
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <FileManagerTabBar
            leading={explorerCollapsed ? <ExplorerToggle fm={fm} showLabel={false} /> : null}
            workspace={entry.workspace}
            onWorkspaceAction={dispatch}
            onDelete={fm.requestDelete}
            isPathPending={fm.isImportPending}
            showSave={hasUnsavedEditableTabs(fm)}
            onSave={fm.saveAllFiles}
          />
          <FileEditorPane fm={fm} vaultName={entry.displayName} active={active} />
        </div>
      </div>
      <FileTreeContextMenu fm={fm} tree={fm.tree} />
      <FileManagerDialogs fm={fm} promptsOpen={active} />
    </>
  );
}
