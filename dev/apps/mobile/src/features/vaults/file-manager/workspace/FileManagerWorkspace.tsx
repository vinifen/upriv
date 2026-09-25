import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
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
import { useTheme } from "@/theme";
import { useVaultFileSystemService } from "@/platform/services";
import { useFileManager } from "../FileManagerContext";
import { FileManagerDialogs } from "../dialogs/FileManagerDialogs";
import { FileEditorPane } from "../editor/FileEditorPane";
import { FileManagerTabBar } from "../editor/FileManagerTabBar";
import { hasUnsavedEditableTabs, useVaultFileManager } from "../hooks/useVaultFileManager";
import { FileTreePanel } from "../tree/FileTreePanel";
import { PaneResizeHandle } from "./PaneResizeHandle";

/** Same breakpoint as desktop `md:` / `useMediaQuery("(max-width: 767px)")`. */
const NARROW_MAX_WIDTH = 767;

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
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isNarrow = windowWidth <= NARROW_MAX_WIDTH;
  const axis = isNarrow ? "y" : "x";
  const { dispatchWorkspace } = useFileManager();
  const { settings, patchSettings } = useAppSettingsContext();
  const layoutSize = useRef(0);
  const [containerSize, setContainerSize] = useState(0);

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

  const fs = useVaultFileSystemService();
  useWorkspacePersistence({
    vaultId: entry.vaultId,
    workspace: entry.workspace,
    fs,
    dispatch,
    suspend: fm.importBusy,
  });

  const applyContainerSize = useCallback((size: number) => {
    if (draggingRef.current) return;
    if (size <= 0) return;
    if (Math.abs(size - layoutSize.current) < 1) return;
    layoutSize.current = size;
    setContainerSize(size);
  }, []);

  const handleSplitDragStart = useCallback(() => {
    draggingRef.current = true;
    dragStartPercentRef.current = livePercentRef.current;
    const size = layoutSize.current;
    dragStartSizeRef.current = size;
    setDragSize(size > 0 ? size : null);
  }, []);

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

  const sizeForSplit = dragSize ?? containerSize;
  const splitPercent = displayTreeSplitPercent(livePercent, sizeForSplit, axis);
  const treeExtent = sizeForSplit > 0 ? Math.round((sizeForSplit * splitPercent) / 100) : undefined;

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
          applyContainerSize(axis === "y" ? height : width);
        }}
      >
        <FileTreePanel fm={fm} layout={isNarrow ? "column" : "row"} splitExtent={treeExtent} />
        <PaneResizeHandle
          axis={axis}
          onDragStart={handleSplitDragStart}
          onDrag={handleSplitDrag}
          onDragEnd={handleSplitDragEnd}
        />
        <View style={[styles.editorCol, { backgroundColor: colors.surfaceContainerHigh }]}>
          <FileManagerTabBar
            workspace={entry.workspace}
            onWorkspaceAction={dispatch}
            showSave={hasUnsavedEditableTabs(fm)}
            onSave={fm.saveAllFiles}
          />
          <FileEditorPane fm={fm} />
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
  editorCol: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" },
});
