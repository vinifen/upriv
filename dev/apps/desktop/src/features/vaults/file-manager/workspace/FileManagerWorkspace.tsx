import { useCallback, useRef } from "react";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { FileManagerEntry } from "../fileManagerTypes";
import { useFileManager } from "../FileManagerContext";
import { FileEditorPane, hasUnsavedEditableTabs } from "../editor/FileEditorPane";
import { FileManagerDialogs } from "../dialogs/FileManagerDialogs";
import { FileManagerTabBar } from "../editor/FileManagerTabBar";
import { FileTreeContextMenu } from "../tree/FileTreeContextMenu";
import { FileTreePanel } from "../tree/FileTreePanel";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { percentFromPointer, TREE_SPLIT_DEFAULT_PERCENT } from "@upriv/shared";
import { useVaultFileManager } from "../hooks/useVaultFileManager";

interface FileManagerWorkspaceProps {
  entry: FileManagerEntry;
}

export function FileManagerWorkspace({ entry }: FileManagerWorkspaceProps) {
  const { dispatchWorkspace } = useFileManager();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const fm = useVaultFileManager({
    entry,
    dispatch: (action) => dispatchWorkspace(entry.vaultId, action),
  });

  const handleSplitDrag = useCallback(
    (clientPos: number) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const percent = isMobile
        ? percentFromPointer(clientPos, rect.top, rect.height)
        : percentFromPointer(clientPos, rect.left, rect.width);

      dispatchWorkspace(entry.vaultId, { type: "set_tree_split", percent });
    },
    [dispatchWorkspace, entry.vaultId, isMobile],
  );

  const splitPercent = entry.workspace.treeSplitPercent ?? TREE_SPLIT_DEFAULT_PERCENT;

  return (
    <>
      <div
        ref={containerRef}
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-container-high md:flex-row"
      >
        <FileTreePanel fm={fm} splitPercent={splitPercent} layout={isMobile ? "column" : "row"} />
        <PaneResizeHandle axis={isMobile ? "y" : "x"} onDrag={handleSplitDrag} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <FileManagerTabBar
            workspace={entry.workspace}
            onWorkspaceAction={(action) => dispatchWorkspace(entry.vaultId, action)}
            showSave={hasUnsavedEditableTabs(fm)}
            onSave={fm.saveAllFiles}
          />
          <FileEditorPane fm={fm} />
        </div>
      </div>
      <FileTreeContextMenu fm={fm} tree={fm.tree} />
      <FileManagerDialogs fm={fm} />
    </>
  );
}
