import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import type { FileManagerEntry, VaultWorkspaceAction } from "@upriv/shared";
import { useTreeSplitDrag, useWorkspacePersistence } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import { useVaultFileSystemService } from "@/platform/services";
import { useFileManager } from "../FileManagerContext";
import { FileManagerDialogs } from "../dialogs/FileManagerDialogs";
import { FileEditorPane } from "../editor/FileEditorPane";
import { FileManagerTabBar } from "../editor/FileManagerTabBar";
import { hasUnsavedEditableTabs, useVaultFileManager } from "../hooks/useVaultFileManager";
import { ExplorerToggle, FileTreePanel } from "../tree/FileTreePanel";
import { PaneResizeHandle } from "./PaneResizeHandle";

/** Same breakpoint as desktop `md:` / `useMediaQuery("(max-width: 767px)")`. */
const NARROW_MAX_WIDTH = 767;

function treeSlotExtentStyle(extent: number | `${number}%`, narrow: boolean): ViewStyle {
  return narrow ? { height: extent, width: "100%" } : { width: extent, height: "100%" };
}

interface FileManagerWorkspaceProps {
  entry: FileManagerEntry;
  active?: boolean;
  writesLocked?: boolean;
  onDismissConfirmed: () => void;
  onVaultCloseConfirmed?: () => void;
}

export function FileManagerWorkspace({
  entry,
  active = true,
  writesLocked = false,
  onDismissConfirmed,
  onVaultCloseConfirmed,
}: FileManagerWorkspaceProps) {
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isNarrow = windowWidth <= NARROW_MAX_WIDTH;
  const axis = isNarrow ? "y" : "x";
  const { dispatchWorkspace } = useFileManager();
  const treeSlotRef = useRef<View>(null);
  const [containerSize, setContainerSize] = useState(0);

  const dispatch = useCallback(
    (action: VaultWorkspaceAction) => dispatchWorkspace(entry.vaultId, action),
    [dispatchWorkspace, entry.vaultId],
  );

  const fm = useVaultFileManager({
    entry,
    dispatch,
    onDismissConfirmed,
    onVaultCloseConfirmed,
    writesLocked,
  });

  const fs = useVaultFileSystemService();
  useWorkspacePersistence({
    vaultId: entry.vaultId,
    workspace: entry.workspace,
    fs,
    dispatch,
    suspend: fm.importBusy,
  });

  // Moves resize the explorer through native props: a re-render per move is too slow.
  const paintTreeExtent = useCallback(
    (visualPercent: number, size: number) => {
      treeSlotRef.current?.setNativeProps({
        style: treeSlotExtentStyle(Math.round((size * visualPercent) / 100), isNarrow),
      });
    },
    [isNarrow],
  );

  const split = useTreeSplitDrag({
    savedPercent: entry.workspace.treeSplitPercent,
    containerSize,
    axis,
    dispatch,
    onDragFrame: paintTreeExtent,
  });

  // A redraw while the finger is down would put the pre-drag size back.
  // Apply the live size again before paint.
  useLayoutEffect(() => {
    split.repaintDrag();
  });

  const explorerCollapsed = entry.workspace.explorerCollapsed;
  const treeSlotStyle: ViewStyle = {
    ...treeSlotExtentStyle(
      containerSize > 0
        ? Math.round((containerSize * split.visualPercent) / 100)
        : `${split.visualPercent}%`,
      isNarrow,
    ),
    display: split.visualPercent === 0 ? "none" : undefined,
  };

  return (
    <>
      <View
        collapsable={false}
        pointerEvents={active ? "auto" : "none"}
        style={[
          styles.root,
          isNarrow ? styles.rootColumn : styles.rootRow,
          { backgroundColor: colors.surfaceContainerHigh },
          active ? null : styles.inactive,
        ]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          const size = axis === "y" ? height : width;
          setContainerSize((prev) => (size <= 0 || Math.abs(prev - size) < 1 ? prev : size));
        }}
      >
        {explorerCollapsed ? null : (
          <>
            <View ref={treeSlotRef} collapsable={false} style={[styles.treeSlot, treeSlotStyle]}>
              <FileTreePanel fm={fm} />
            </View>
            <PaneResizeHandle
              axis={axis}
              onDragStart={split.onDragStart}
              onDrag={split.onDrag}
              onDragEnd={split.onDragEnd}
            />
          </>
        )}
        <View style={[styles.editorCol, { backgroundColor: colors.surfaceContainerHigh }]}>
          <FileManagerTabBar
            leading={explorerCollapsed ? <ExplorerToggle fm={fm} showLabel={false} /> : null}
            workspace={entry.workspace}
            onWorkspaceAction={dispatch}
            onDelete={fm.requestDelete}
            isPathPending={fm.isImportPending}
            showSave={hasUnsavedEditableTabs(fm)}
            onSave={fm.saveAllFiles}
          />
          <FileEditorPane fm={fm} vaultName={entry.displayName} />
        </View>
      </View>
      <FileManagerDialogs fm={fm} promptsOpen={active} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", position: "relative" },
  inactive: { display: "none" },
  rootColumn: { flexDirection: "column" },
  rootRow: { flexDirection: "row" },
  treeSlot: { flexGrow: 0, flexShrink: 0, minWidth: 0, minHeight: 0, overflow: "hidden" },
  editorCol: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" },
});
