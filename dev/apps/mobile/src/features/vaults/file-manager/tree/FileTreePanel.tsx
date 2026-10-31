import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Clipboard,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from "react-native";
import {
  findNode,
  getParentPath,
  isDescendantPath,
  isImportQueueSlotPath,
  isImportWalkPlaceholderPath,
  liveFileNameError,
  fileNameErrorI18nKey,
  LOGICAL_FILE_NAME_MAX_LENGTH,
  renameBasenameSelection,
  searchTreeRows,
  sessionPathKind,
  FILE_MANAGER_LONG_PRESS_MS,
  FILE_MANAGER_LONG_PRESS_MOVE_PX,
  pointInHitRect,
  smallestContainingKey,
  visibleTreeRows,
  type FolderPresence,
  type VisibleTreeRow,
} from "@upriv/shared";
import { useSearchCollapsedFolders } from "@upriv/shared/react";
import { Icon } from "@/components/icons";
import { noteIdleActivity } from "@/lib/idleActivity";
import {
  Button,
  DropdownPanel,
  IconButton,
  MenuActionItem,
  type DropdownPanelHandle,
} from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { colorAlpha, radii } from "@/theme/tokens";
import { useDoubleTap } from "../hooks/useDoubleTap";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import { measurePageRect, type PageRect } from "../lib/measurePageRect";
import {
  pickImportFiles,
  DocumentPickerUnavailableError,
  FolderPickerUnavailableError,
  type MobileImportPick,
} from "../lib/osFileImport";
import { ExplorerSearch, ExplorerSearchToggle } from "./ExplorerSearch";

interface FileTreePanelProps {
  fm: FileManagerApi;
}

/** Icon + "Explorer" hide the explorer; the icon alone (in the tab bar) shows it again. */
export function ExplorerToggle({ fm, showLabel }: { fm: FileManagerApi; showLabel: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const collapsed = fm.workspace.explorerCollapsed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        collapsed ? "modal.file_manager.explorer.show" : "modal.file_manager.explorer.hide",
      )}
      accessibilityState={{ expanded: !collapsed }}
      hitSlop={6}
      onPress={() => fm.dispatch({ type: "set_explorer_collapsed", collapsed: !collapsed })}
      style={({ pressed }) => [
        styles.explorerToggle,
        showLabel ? styles.explorerToggleLabeled : styles.explorerToggleBare,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.explorerToggleIcon}>
        <Icon name="sidebar" size={14} color={colors.onSurfaceVariant} />
      </View>
      {showLabel ? (
        <Text
          style={[styles.toolbarLabel, { color: colors.onSurfaceVariant }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {t("modal.file_manager.explorer.title")}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * What every row may do. One object for the explorer's life, so a row draws
 * again only when its own marks change, not when the file manager does.
 */
interface FileTreeRowActions {
  activate: (path: string, isFolder: boolean) => void;
  commitRename: (path: string, name: string) => void;
  cancelRename: () => void;
  startRename: (path: string) => void;
  createFile: (parentPath: string) => void;
  createFolder: (parentPath: string) => void;
  openInSystemFileManager: (path: string) => void;
  sendToFolder: (path: string) => void;
  removeFromFolder: (path: string) => void;
  requestDelete: (path: string) => void;
  showToast: (message: string) => void;
  /** A drag is running, so a touch on a row is not a tap. */
  isDragging: () => boolean;
}

const DEPTH_INDENT = 10;
const TWISTIE = 14;
const ROOT_DROP_KEY = "/";

const treeRowKey = (row: VisibleTreeRow) => row.path;

function createTargetPath(fm: FileManagerApi): string {
  const selected = fm.workspace.selectedPath;
  if (!selected || selected === "/") return "/";
  const node = findNode(fm.tree, selected);
  if (node?.type === "folder") return selected;
  return getParentPath(selected);
}

function dropFolderForRow(path: string, folderPaths: Set<string>): string {
  return folderPaths.has(path) ? path : getParentPath(path);
}

/** Explorer toggle icon and each toolbar action are this square. */
const TOOL_BUTTON_SIZE = 24;
/** Toolbar content that fits the label icon and all five actions on one row. */
const TOOLBAR_ONE_ROW_MIN_WIDTH = TOOL_BUTTON_SIZE * 6;
const TOOLBAR_PADDING_X = 4;

export function FileTreePanel({ fm }: FileTreePanelProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { workspace, movePath } = fm;
  // Below the one-row width the actions get their own rows and spread across them.
  const [toolbarWrapped, setToolbarWrapped] = useState(false);
  const fmRef = useRef(fm);
  fmRef.current = fm;
  const dragSourceRef = useRef<string | null>(null);
  /** Held here, not in the workspace: a drop target change draws the explorer, not the editor. */
  const [drag, setDrag] = useState<{ source: string | null; target: string | null }>({
    source: null,
    target: null,
  });
  const toggleFolderRef = useRef<(path: string) => void>(() => undefined);
  const [rowActions] = useState<FileTreeRowActions>(() => ({
    activate: (path, isFolder) => {
      if (isImportWalkPlaceholderPath(path) || isImportQueueSlotPath(path)) return;
      if (isFolder) {
        toggleFolderRef.current(path);
        return;
      }
      fmRef.current.openFile(path);
    },
    commitRename: (path, name) => fmRef.current.commitRename(path, name),
    cancelRename: () => fmRef.current.dispatch({ type: "cancel_rename" }),
    startRename: (path) => fmRef.current.dispatch({ type: "start_rename", path }),
    createFile: (parentPath) => fmRef.current.createFile(parentPath),
    createFolder: (parentPath) => fmRef.current.createFolder(parentPath),
    openInSystemFileManager: (path) => {
      void fmRef.current.openInSystemFileManager(path);
    },
    sendToFolder: (path) => {
      void fmRef.current.sendToFolder(path);
    },
    removeFromFolder: (path) => {
      void fmRef.current.removeFromFolder(path);
    },
    requestDelete: (path) => fmRef.current.requestDelete(path),
    showToast: (message) => fmRef.current.showToast(message),
    isDragging: () => dragSourceRef.current !== null,
  }));

  const { explorerSearchOpen: searchOpen, explorerSearchQuery: search } = workspace;
  // A large vault filters behind the typing, not in its way.
  const deferredSearch = useDeferredValue(search);
  const searching = deferredSearch.trim().length > 0;
  // Folders collapse for this search only; the saved ones stay as they are.
  const { collapsed: searchCollapsed, toggle: toggleSearchFolder } = useSearchCollapsedFolders(
    fm.vaultId,
    deferredSearch,
  );
  toggleFolderRef.current = (path) => {
    if (searching) toggleSearchFolder(path);
    else fm.dispatch({ type: "toggle_folder", path });
  };
  const searchInputRef = useRef<TextInput>(null);
  /** The button opened the bar, so typing starts there. A restored bar leaves the keyboard down. */
  const focusSearchRef = useRef(false);
  useEffect(() => {
    if (searchOpen && focusSearchRef.current) searchInputRef.current?.focus();
    focusSearchRef.current = false;
  }, [searchOpen]);

  const entries = useMemo(
    () =>
      searching
        ? searchTreeRows(fm.displayTree, deferredSearch, {
            renamingPath: workspace.renamingPath,
            collapsed: searchCollapsed,
          })
        : visibleTreeRows(fm.displayTree, workspace.expandedPaths),
    [
      deferredSearch,
      fm.displayTree,
      searchCollapsed,
      searching,
      workspace.expandedPaths,
      workspace.renamingPath,
    ],
  );

  const listRef = useRef<FlatList<VisibleTreeRow>>(null);
  /** Content offset and drag state while a finger is down, so a scroll is not a tap. */
  const listOffsetRef = useRef(0);
  const listScrollingRef = useRef(false);
  const onListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    listOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);
  const onListScrollStart = useCallback(() => {
    listScrollingRef.current = true;
  }, []);
  const onListScrollEnd = useCallback(() => {
    listScrollingRef.current = false;
  }, []);
  const onScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) =>
      listRef.current?.scrollToOffset({ offset: index * averageItemLength }),
    [],
  );
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /* Rename can start from a tab, where the row may be scrolled out of view. */
  useEffect(() => {
    const path = workspace.renamingPath;
    if (!path) return;
    const index = entriesRef.current.findIndex((entry) => entry.path === path);
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5 });
  }, [workspace.renamingPath]);

  const dropViewsRef = useRef(new Map<string, View>());
  const dropRectsRef = useRef(new Map<string, PageRect>());
  const dropTargetRef = useRef<string | null>(null);
  const dragMovedRef = useRef(false);
  const folderPathsRef = useRef<Set<string>>(new Set());

  const folderPaths = useMemo(
    () => new Set(entries.filter((e) => e.node.type === "folder").map((e) => e.path)),
    [entries],
  );
  folderPathsRef.current = folderPaths;

  // Android detaches rows scrolled out of the list, and a detached row does not
  // answer `measure`. Its last rect would sit over a row now in that spot, so
  // each refresh starts empty and only rows on screen count.
  const refreshDropRects = useCallback(() => {
    dropRectsRef.current.clear();
    dropViewsRef.current.forEach((view, key) => {
      measurePageRect(view, (rect) => {
        dropRectsRef.current.set(key, rect);
      });
    });
  }, []);

  const registerDropTarget = useCallback((key: string, node: View | null) => {
    if (node) {
      dropViewsRef.current.set(key, node);
      measurePageRect(node, (rect) => {
        dropRectsRef.current.set(key, rect);
      });
      return;
    }
    dropViewsRef.current.delete(key);
    dropRectsRef.current.delete(key);
  }, []);

  const remeasureDropTarget = useCallback((key: string) => {
    const view = dropViewsRef.current.get(key);
    if (!view) return;
    measurePageRect(view, (rect) => {
      dropRectsRef.current.set(key, rect);
    });
  }, []);

  useEffect(() => {
    if (!drag.source) return;
    refreshDropRects();
  }, [drag.source, entries, refreshDropRects]);

  const hitDropFolder = useCallback((pageX: number, pageY: number): string | null => {
    const source = dragSourceRef.current;
    if (!source) return null;

    const bestKey = smallestContainingKey(
      dropRectsRef.current.entries(),
      pageX,
      pageY,
      (key) => key === ROOT_DROP_KEY,
    );

    let folder: string | null = null;
    if (bestKey) {
      folder = dropFolderForRow(bestKey, folderPathsRef.current);
    } else {
      const rootRect = dropRectsRef.current.get(ROOT_DROP_KEY);
      if (rootRect && pointInHitRect(pageX, pageY, rootRect)) folder = ROOT_DROP_KEY;
    }

    if (!folder || isDescendantPath(source, folder)) return null;
    return folder;
  }, []);

  const clearDrag = useCallback(() => {
    dragSourceRef.current = null;
    dropTargetRef.current = null;
    dragMovedRef.current = false;
    setDrag({ source: null, target: null });
  }, []);

  const onDragStart = useCallback(
    (path: string) => {
      dragSourceRef.current = path;
      dropTargetRef.current = null;
      dragMovedRef.current = false;
      setDrag({ source: path, target: null });
      refreshDropRects();
    },
    [refreshDropRects],
  );

  const onDragMove = useCallback(
    (event: GestureResponderEvent) => {
      const source = dragSourceRef.current;
      if (!source) return;
      dragMovedRef.current = true;
      const target = hitDropFolder(event.nativeEvent.pageX, event.nativeEvent.pageY);
      if (dropTargetRef.current !== target) {
        dropTargetRef.current = target;
        setDrag({ source, target });
      }
    },
    [hitDropFolder],
  );

  /**
   * The finger left the screen. Release and touch end both land here, whichever
   * comes first ends the drag. A long press that never moved is not a drop.
   */
  const onDragLift = useCallback(
    (event: GestureResponderEvent) => {
      const source = dragSourceRef.current;
      if (!source) return;
      if (dragMovedRef.current) {
        const { pageX, pageY } = event.nativeEvent;
        const target = dropTargetRef.current ?? hitDropFolder(pageX, pageY);
        if (target && !isDescendantPath(source, target) && getParentPath(source) !== target) {
          movePath(source, target);
        }
      }
      clearDrag();
    },
    [clearDrag, hitDropFolder, movePath],
  );

  /** A new touch during a drag means the last one's end never arrived. */
  const dropUnfinishedDrag = useCallback(() => {
    if (dragSourceRef.current) clearDrag();
    return false;
  }, [clearDrag]);

  const captureDragMove = useCallback(() => dragSourceRef.current !== null, []);

  const runImport = async (pick: () => Promise<MobileImportPick | null>) => {
    try {
      const result = await pick();
      if (!result) return;
      await fm.importFiles(createTargetPath(fm), result.files, {
        openFirstViewable: true,
        skippedUnsupported: result.skippedUnsupported,
        releaseSafTree: result.releaseSafTree,
      });
    } catch (error) {
      if (error instanceof FolderPickerUnavailableError) {
        fm.showToast(t("modal.file_manager.toast.import_folder_unavailable"));
        return;
      }
      if (error instanceof DocumentPickerUnavailableError) {
        fm.showToast(t("modal.file_manager.toast.import_unavailable"));
        return;
      }
      const failedName =
        error instanceof Error && error.name === "ImportReadError" ? error.message : "file";
      fm.showToast(t("modal.file_manager.toast.import_failed", { name: failedName }));
    }
  };

  const isDragging = drag.source !== null;
  const rootDropActive = drag.target === ROOT_DROP_KEY;
  const setRootDropRef = useCallback(
    (node: View | null) => {
      registerDropTarget(ROOT_DROP_KEY, node);
    },
    [registerDropTarget],
  );
  const onRootDropLayout = useCallback(() => {
    remeasureDropTarget(ROOT_DROP_KEY);
  }, [remeasureDropTarget]);
  const dropTargetPath = drag.target && drag.target !== ROOT_DROP_KEY ? drag.target : null;
  const dragSourcePath = drag.source;
  const dropZoneEndPath = useMemo(() => {
    if (!dropTargetPath) return null;
    let last: string | null = null;
    for (const entry of entries) {
      if (entry.path === dropTargetPath || isDescendantPath(dropTargetPath, entry.path)) {
        last = entry.path;
      }
    }
    return last;
  }, [dropTargetPath, entries]);

  const expanded = useMemo(() => new Set(workspace.expandedPaths), [workspace.expandedPaths]);
  const dirty = useMemo(() => new Set(workspace.dirtyPaths), [workspace.dirtyPaths]);
  const { activeTabPath, renamingPath, sessionCreatedPaths, sessionModifiedPaths, dirtyPaths } =
    workspace;
  const { folderPresence, pendingImportPaths, processingImportPaths, osFolderAvailable } = fm;

  // Stable while nothing a row shows changed, so typing does not draw the list.
  const renderItem = useCallback<ListRenderItem<VisibleTreeRow>>(
    ({ item }) => {
      const isFolder = item.node.type === "folder";
      const inDropZone = Boolean(
        dropTargetPath &&
        (item.path === dropTargetPath || isDescendantPath(dropTargetPath, item.path)),
      );
      const isWalkPlaceholder = isImportWalkPlaceholderPath(item.path);
      const isQueueSlot = isImportQueueSlotPath(item.path);

      return (
        <FileTreeRow
          path={item.path}
          name={item.node.name}
          isFolder={isFolder}
          isExpanded={
            isFolder && (searching ? !searchCollapsed.has(item.path) : expanded.has(item.path))
          }
          isSelected={activeTabPath === item.path}
          isDirty={!isFolder && dirty.has(item.path)}
          pathKind={sessionPathKind(
            { sessionCreatedPaths, sessionModifiedPaths, dirtyPaths },
            item.path,
          )}
          isRenaming={renamingPath === item.path}
          isDragging={dragSourcePath === item.path}
          inDropZone={inDropZone}
          dropZoneStart={inDropZone && item.path === dropTargetPath}
          dropZoneEnd={inDropZone && item.path === dropZoneEndPath}
          isPending={pendingImportPaths.has(item.path)}
          isWalkPlaceholder={isWalkPlaceholder}
          isQueueSlot={isQueueSlot}
          isProcessing={processingImportPaths.has(item.path) || isWalkPlaceholder || isQueueSlot}
          osFolderAvailable={osFolderAvailable}
          folderMark={folderPresence?.get(item.path) ?? null}
          depth={item.depth}
          actions={rowActions}
          registerDropTarget={registerDropTarget}
          remeasureDropTarget={remeasureDropTarget}
          onDragStart={onDragStart}
          onDragCancel={clearDrag}
          listOffsetRef={listOffsetRef}
          listScrollingRef={listScrollingRef}
        />
      );
    },
    [
      activeTabPath,
      clearDrag,
      dirty,
      dirtyPaths,
      dragSourcePath,
      dropTargetPath,
      dropZoneEndPath,
      expanded,
      folderPresence,
      onDragStart,
      osFolderAvailable,
      pendingImportPaths,
      processingImportPaths,
      registerDropTarget,
      remeasureDropTarget,
      renamingPath,
      rowActions,
      searchCollapsed,
      searching,
      sessionCreatedPaths,
      sessionModifiedPaths,
    ],
  );

  const paneStyle: ViewStyle = { flex: 1, minHeight: 0, minWidth: 0 };

  return (
    <View style={[styles.panel, paneStyle, { backgroundColor: colors.surfaceContainer }]}>
      {/* Label truncates first; once only the icon is left, the actions wrap by group (create, import, search). */}
      <View
        style={styles.toolbar}
        onLayout={(event) =>
          setToolbarWrapped(
            event.nativeEvent.layout.width - TOOLBAR_PADDING_X * 2 < TOOLBAR_ONE_ROW_MIN_WIDTH,
          )
        }
      >
        <ExplorerToggle fm={fm} showLabel />
        <View style={[styles.toolbarActions, toolbarWrapped && styles.toolbarActionsWrapped]}>
          <View style={[styles.toolbarPair, toolbarWrapped && styles.toolbarPairWrapped]}>
            <IconButton
              label={t("modal.file_manager.context.new_file")}
              icon="file"
              size={14}
              tone="muted"
              onPress={() => fm.createFile(createTargetPath(fm))}
              style={styles.toolBtn}
            />
            <IconButton
              label={t("modal.file_manager.context.new_folder")}
              icon="folder"
              size={14}
              tone="muted"
              onPress={() => fm.createFolder(createTargetPath(fm))}
              style={styles.toolBtn}
            />
          </View>
          <View style={[styles.toolbarPair, toolbarWrapped && styles.toolbarPairWrapped]}>
            <IconButton
              label={t("modal.file_manager.explorer.import_files")}
              icon="arrow-up"
              size={14}
              tone="muted"
              onPress={() => {
                void runImport(pickImportFiles);
              }}
              style={styles.toolBtn}
            />
            <IconButton
              label={t("modal.file_manager.explorer.import_folder")}
              icon="archive"
              size={14}
              tone="muted"
              onPress={() => {
                void fm.importPickedFolder(createTargetPath(fm));
              }}
              style={styles.toolBtn}
            />
          </View>
          <View style={[styles.toolbarPair, toolbarWrapped && styles.toolbarPairWrapped]}>
            <ExplorerSearchToggle
              open={searchOpen}
              atWork={!searchOpen && search.trim().length > 0}
              onToggle={() => {
                focusSearchRef.current = !searchOpen;
                fm.dispatch({ type: "set_explorer_search_open", open: !searchOpen });
              }}
            />
          </View>
        </View>
      </View>
      {searchOpen ? (
        <ExplorerSearch
          inputRef={searchInputRef}
          query={search}
          onQueryChange={(query) => fm.dispatch({ type: "set_explorer_search_query", query })}
        />
      ) : null}
      {folderPresence?.get("/") === "none" ? (
        <Text style={[styles.folderEmpty, { color: colors.onSurfaceVariant }]}>
          {t("modal.file_manager.explorer.folder_empty")}
        </Text>
      ) : null}
      {/*
        A long press on a row starts the drag; from then on this view owns the
        gesture, so a row drawing again or leaving the list cannot strand it.
      */}
      <View
        ref={setRootDropRef}
        onLayout={onRootDropLayout}
        collapsable={false}
        onStartShouldSetResponderCapture={dropUnfinishedDrag}
        onMoveShouldSetResponderCapture={captureDragMove}
        // `true` keeps the list's native scroll out of the gesture.
        onResponderGrant={() => true}
        onResponderMove={onDragMove}
        onResponderRelease={onDragLift}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={clearDrag}
        onTouchEnd={onDragLift}
        onTouchCancel={clearDrag}
        style={[styles.listShell, rootDropActive ? { borderColor: colors.accent } : null]}
      >
        {fm.treeStatus === "loading" ? (
          <FileTreeSkeleton label={t("modal.file_manager.explorer.loading")} />
        ) : fm.treeStatus === "error" ? (
          <View accessibilityRole="alert" style={styles.loadError}>
            <Text style={[styles.loadErrorText, { color: colors.onSurfaceVariant }]}>
              {t("modal.file_manager.explorer.load_failed")}
            </Text>
            <Button label={t("action.retry")} variant="ghost" size="sm" onPress={fm.retryTree} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={entries}
            onScrollToIndexFailed={onScrollToIndexFailed}
            extraData={renderItem}
            keyExtractor={treeRowKey}
            renderItem={renderItem}
            scrollEnabled={!isDragging}
            onScroll={onListScroll}
            onScrollBeginDrag={onListScrollStart}
            onScrollEndDrag={onListScrollEnd}
            onMomentumScrollEnd={onListScrollEnd}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              searching ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.searchEmpty, { color: colors.onSurfaceVariant }]}
                >
                  {t("modal.file_manager.explorer.search_empty")}
                </Text>
              ) : null
            }
          />
        )}
      </View>
    </View>
  );
}

const TREE_SKELETON_ROWS = [
  { depth: 0, width: 96 },
  { depth: 0, width: 128 },
  { depth: 1, width: 80 },
  { depth: 1, width: 112 },
  { depth: 0, width: 64 },
  { depth: 0, width: 96 },
] as const;

/** Desktop `animate-pulse`: opacity 1 → 0.5 → 1 every 2 s, off with Reduce Motion. */
function useSkeletonPulse() {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    const step = (toValue: number) =>
      Animated.timing(pulse, {
        toValue,
        duration: 1000,
        easing: Easing.bezier(0.4, 0, 0.6, 1),
        useNativeDriver: true,
      });
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      loop = Animated.loop(Animated.sequence([step(0.5), step(1)]));
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

  return pulse;
}

function FileTreeSkeleton({ label }: { label: string }) {
  const { colors } = useTheme();
  const pulse = useSkeletonPulse();
  const fill = { backgroundColor: colorAlpha(colors.onSurfaceVariant, 0.2) };
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ opacity: pulse }}
    >
      {TREE_SKELETON_ROWS.map((row, index) => (
        <View key={index} style={[styles.row, { paddingLeft: row.depth * DEPTH_INDENT + 2 }]}>
          <View style={{ width: TWISTIE }} />
          <View style={[styles.skeletonIcon, fill]} />
          <View style={[styles.skeletonBar, fill, { width: row.width }]} />
        </View>
      ))}
    </Animated.View>
  );
}

interface FileTreeRowProps {
  path: string;
  name: string;
  isFolder: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isDirty: boolean;
  pathKind: ReturnType<typeof sessionPathKind>;
  isRenaming: boolean;
  isDragging: boolean;
  inDropZone: boolean;
  dropZoneStart: boolean;
  dropZoneEnd: boolean;
  isPending: boolean;
  isWalkPlaceholder: boolean;
  isQueueSlot: boolean;
  isProcessing: boolean;
  osFolderAvailable: boolean;
  /** How much of this entry is in a chosen-files vault's folder. */
  folderMark: FolderPresence | null;
  depth: number;
  actions: FileTreeRowActions;
  registerDropTarget: (path: string, node: View | null) => void;
  remeasureDropTarget: (path: string) => void;
  onDragStart: (path: string) => void;
  onDragCancel: () => void;
  listOffsetRef: MutableRefObject<number>;
  listScrollingRef: MutableRefObject<boolean>;
}

const FileTreeRow = memo(function FileTreeRow({
  path,
  name,
  isFolder,
  isExpanded,
  isSelected,
  isDirty,
  pathKind,
  isRenaming,
  isDragging,
  inDropZone,
  dropZoneStart,
  dropZoneEnd,
  isPending,
  isWalkPlaceholder,
  isQueueSlot,
  isProcessing,
  osFolderAvailable,
  folderMark,
  depth,
  actions,
  registerDropTarget,
  remeasureDropTarget,
  onDragStart,
  onDragCancel,
  listOffsetRef,
  listScrollingRef,
}: FileTreeRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [renameValue, setRenameValue] = useState(name);
  const [renameSelection, setRenameSelection] = useState<
    { start: number; end: number } | undefined
  >();
  const renameError = isRenaming ? liveFileNameError(renameValue) : null;
  const parentForCreate = isFolder ? path : getParentPath(path);
  const onActivate = () => {
    if (isRenaming || actions.isDragging()) return;
    actions.activate(path, isFolder);
  };
  const onCommitRename = (nextName: string) => actions.commitRename(path, nextName);
  const onCancelRename = actions.cancelRename;

  const setDropRef = useCallback(
    (node: View | null) => {
      registerDropTarget(path, node);
    },
    [path, registerDropTarget],
  );
  const onDropLayout = useCallback(() => {
    remeasureDropTarget(path);
  }, [path, remeasureDropTarget]);

  const armedRef = useRef(false);
  const movedRef = useRef(false);
  const offsetAtTouchRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const menuRef = useRef<DropdownPanelHandle>(null);
  const isDoubleTap = useDoubleTap();
  const callbacksRef = useRef({ path, isRenaming, onActivate, onDragStart, onDragCancel });
  callbacksRef.current = { path, isRenaming, onActivate, onDragStart, onDragCancel };

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      // Its own touch end will not arrive, so that touch cannot finish a held press.
      if (armedRef.current) callbacksRef.current.onDragCancel();
      armedRef.current = false;
    };
  }, [clearLongPressTimer]);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(name);
      setRenameSelection(renameBasenameSelection(name));
      clearLongPressTimer();
      armedRef.current = false;
    } else {
      setRenameSelection(undefined);
    }
  }, [isRenaming, name, clearLongPressTimer]);

  const onTouchStart = (event: GestureResponderEvent) => {
    if (callbacksRef.current.isRenaming || actions.isDragging() || isPending || isQueueSlot) return;
    const { pageX, pageY } = event.nativeEvent;
    touchStartRef.current = { x: pageX, y: pageY };
    offsetAtTouchRef.current = listOffsetRef.current;
    armedRef.current = false;
    movedRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      armedRef.current = true;
      callbacksRef.current.onDragStart(callbacksRef.current.path);
    }, FILE_MANAGER_LONG_PRESS_MS);
  };

  const onTouchMove = (event: GestureResponderEvent) => {
    if (armedRef.current) return;
    const start = touchStartRef.current;
    if (!start) return;
    const { pageX, pageY } = event.nativeEvent;
    if (
      Math.abs(pageX - start.x) > FILE_MANAGER_LONG_PRESS_MOVE_PX ||
      Math.abs(pageY - start.y) > FILE_MANAGER_LONG_PRESS_MOVE_PX
    ) {
      movedRef.current = true;
      clearLongPressTimer();
    }
  };

  const finishTouch = (cancelled: boolean, pageX: number | null, pageY: number | null) => {
    const wasArmed = armedRef.current;
    const start = touchStartRef.current;
    let wasMoved = movedRef.current;
    if (
      start &&
      pageX != null &&
      pageY != null &&
      (Math.abs(pageX - start.x) > FILE_MANAGER_LONG_PRESS_MOVE_PX ||
        Math.abs(pageY - start.y) > FILE_MANAGER_LONG_PRESS_MOVE_PX)
    ) {
      wasMoved = true;
    }
    if (Math.abs(listOffsetRef.current - offsetAtTouchRef.current) > 1) {
      wasMoved = true;
    }
    clearLongPressTimer();
    touchStartRef.current = null;
    movedRef.current = false;
    armedRef.current = false;

    // The press became a drag, and the explorer ends that.
    if (wasArmed) return;

    // A scroll steals the touch. That cancel is not a tap, so the file stays closed.
    if (
      cancelled ||
      wasMoved ||
      listScrollingRef.current ||
      callbacksRef.current.isRenaming ||
      actions.isDragging()
    ) {
      return;
    }
    if (start && isDoubleTap()) {
      menuRef.current?.open({ pageX: start.x, pageY: start.y });
      return;
    }
    callbacksRef.current.onActivate();
  };

  const copyPath = () => {
    try {
      Clipboard.setString(path);
      actions.showToast(t("modal.file_manager.toast.copied"));
    } catch {
      actions.showToast(t("modal.file_manager.toast.copy_failed"));
    }
  };

  const iconColor =
    pathKind === "created"
      ? colors.vaultStatusOpen
      : pathKind === "modified"
        ? colors.accent
        : colors.onSurfaceVariant;
  const selectedBg = colorAlpha(colors.onSurface, 0.06);

  return (
    <View
      ref={setDropRef}
      onLayout={onDropLayout}
      collapsable={false}
      style={[
        styles.row,
        {
          paddingLeft: depth * DEPTH_INDENT + 2,
          backgroundColor: isSelected ? selectedBg : "transparent",
          opacity: isDragging ? 0.5 : isProcessing ? 0.75 : isPending ? 0.45 : 1,
        },
      ]}
    >
      {inDropZone ? (
        <View
          pointerEvents="none"
          style={[
            styles.dropOverlay,
            {
              borderColor: colors.accent,
              borderTopWidth: dropZoneStart ? 1 : 0,
              borderBottomWidth: dropZoneEnd ? 1 : 0,
            },
          ]}
        />
      ) : null}
      <View
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={(event) => finishTouch(false, event.nativeEvent.pageX, event.nativeEvent.pageY)}
        onTouchCancel={() => finishTouch(true, null, null)}
        style={styles.rowMain}
        accessibilityRole="button"
        accessibilityState={isFolder ? { expanded: isExpanded } : undefined}
        accessibilityLabel={path}
      >
        {isFolder ? (
          <View style={{ transform: [{ rotate: isExpanded ? "0deg" : "-90deg" }], width: TWISTIE }}>
            <Icon name="chevron-down" size={13} color={colors.onSurfaceVariant} />
          </View>
        ) : (
          <View style={{ width: TWISTIE }} />
        )}
        <Icon name={isFolder ? "folder" : "file"} size={14} color={iconColor} />
        {isRenaming ? (
          <View style={styles.renameWrap}>
            <TextInput
              autoFocus
              value={renameValue}
              maxLength={LOGICAL_FILE_NAME_MAX_LENGTH}
              onChangeText={(text) => {
                noteIdleActivity();
                setRenameValue(text);
              }}
              selection={renameSelection}
              onSelectionChange={(event) => setRenameSelection(event.nativeEvent.selection)}
              onFocus={() => setRenameSelection(renameBasenameSelection(renameValue || name))}
              onBlur={() => {
                if (liveFileNameError(renameValue)) {
                  onCancelRename();
                  return;
                }
                onCommitRename(renameValue);
              }}
              onSubmitEditing={() => {
                if (liveFileNameError(renameValue)) return;
                onCommitRename(renameValue);
              }}
              autoCorrect={false}
              spellCheck={false}
              onTouchStart={(event) => event.stopPropagation()}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === "Escape") onCancelRename();
              }}
              style={[
                styles.renameInput,
                {
                  color: colors.onSurface,
                  backgroundColor: colors.surfaceContainerHighest,
                  borderColor: colors.accent,
                },
              ]}
            />
            {renameError ? (
              <Text style={[styles.renameError, { color: colors.onErrorContainer }]}>
                {t(
                  fileNameErrorI18nKey(renameError),
                  renameError === "too_long"
                    ? { max: String(LOGICAL_FILE_NAME_MAX_LENGTH) }
                    : undefined,
                )}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.nameRow}>
            {isQueueSlot ? (
              <Text
                style={[styles.rowName, { color: colors.onSurfaceVariant, fontStyle: "italic" }]}
                numberOfLines={1}
              >
                {t("modal.file_manager.import.folder_pending")}
              </Text>
            ) : isWalkPlaceholder ? (
              <View
                style={[
                  styles.skeletonBar,
                  { backgroundColor: colorAlpha(colors.onSurfaceVariant, 0.2) },
                ]}
              />
            ) : (
              <Text
                style={[
                  styles.rowName,
                  { color: isSelected ? colors.onSurface : colors.onSurfaceVariant },
                ]}
                numberOfLines={1}
              >
                {name}
              </Text>
            )}
            {isDirty ? <View style={styles.dirtyDot} /> : null}
            {folderMark === "all" || folderMark === "some" ? (
              <View
                accessibilityRole="image"
                accessibilityLabel={t(
                  folderMark === "some"
                    ? "modal.file_manager.explorer.partly_in_folder"
                    : "modal.file_manager.explorer.in_folder",
                )}
                style={folderMark === "some" ? styles.folderMarkPartial : null}
              >
                <Icon name="plaintext" size={11} color={colors.onSurfaceVariant} />
              </View>
            ) : null}
          </View>
        )}
      </View>
      {!isRenaming && !isPending && !isQueueSlot ? (
        // No “open in terminal” on mobile — desktop-only (SDD §9.5).
        <DropdownPanel
          ref={menuRef}
          label={name}
          heading={name}
          align="right"
          minWidth={200}
          maxWidth={240}
          trigger={
            <IconButton
              label={t("app.menu.more")}
              icon="more-horizontal"
              size={14}
              tone="muted"
              style={styles.rowMoreBtn}
            />
          }
        >
          {isFolder ? (
            <>
              <MenuActionItem
                icon="file"
                label={t("modal.file_manager.context.new_file")}
                onPress={() => actions.createFile(parentForCreate)}
              />
              <MenuActionItem
                icon="folder"
                label={t("modal.file_manager.context.new_folder")}
                onPress={() => actions.createFolder(parentForCreate)}
              />
            </>
          ) : null}
          <MenuActionItem
            icon="pencil"
            label={t("modal.file_manager.context.rename")}
            onPress={() => actions.startRename(path)}
          />
          <MenuActionItem
            icon="copy"
            label={t("modal.file_manager.context.copy_path")}
            onPress={copyPath}
          />
          {folderMark === "none" || folderMark === "some" ? (
            <MenuActionItem
              icon="arrow-up"
              label={t("modal.file_manager.context.send_to_folder")}
              onPress={() => actions.sendToFolder(path)}
            />
          ) : null}
          {folderMark === "all" || folderMark === "some" ? (
            <MenuActionItem
              icon="arrow-down"
              label={t("modal.file_manager.context.remove_from_folder")}
              onPress={() => actions.removeFromFolder(path)}
            />
          ) : null}
          {osFolderAvailable && folderMark !== "none" ? (
            <MenuActionItem
              icon="file-manager"
              label={t("modal.file_manager.context.open_system")}
              onPress={() => actions.openInSystemFileManager(path)}
            />
          ) : null}
          <MenuActionItem
            icon="trash"
            label={t("modal.file_manager.context.delete")}
            danger
            onPress={() => actions.requestDelete(path)}
          />
        </DropdownPanel>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { minHeight: 0, minWidth: 0, overflow: "hidden" },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: 2,
    paddingHorizontal: TOOLBAR_PADDING_X,
    paddingTop: 4,
    paddingBottom: 2,
    flexShrink: 0,
  },
  explorerToggle: {
    flexDirection: "row",
    alignItems: "center",
    height: 24,
    borderRadius: 4,
  },
  explorerToggleLabeled: {
    // Wrapping is decided on the icon-only basis, so the label truncates away entirely before the actions wrap.
    flexBasis: TOOL_BUTTON_SIZE,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: TOOL_BUTTON_SIZE,
  },
  explorerToggleBare: {
    width: 32,
    height: "100%",
    justifyContent: "center",
    borderRadius: 0,
    flexShrink: 0,
  },
  explorerToggleIcon: {
    width: TOOL_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toolbarLabel: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "500",
    fontFamily: "monospace",
    textTransform: "uppercase",
    letterSpacing: 1.6,
    includeFontPadding: false,
  },
  toolbarActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    flexShrink: 0,
    marginLeft: "auto",
    maxWidth: "100%",
  },
  toolbarActionsWrapped: { flexGrow: 1 },
  toolbarPair: { flexDirection: "row", flexShrink: 0 },
  toolbarPairWrapped: { flexGrow: 1, justifyContent: "space-around" },
  toolBtn: {
    width: TOOL_BUTTON_SIZE,
    height: TOOL_BUTTON_SIZE,
    minWidth: TOOL_BUTTON_SIZE,
    minHeight: TOOL_BUTTON_SIZE,
    padding: 0,
  },
  listShell: { flex: 1, minHeight: 0, borderWidth: 1, borderColor: "transparent" },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: 4, paddingTop: 0, flexGrow: 1 },
  row: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 26,
    paddingVertical: 3,
    paddingRight: 4,
  },
  dropOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  rowName: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    includeFontPadding: false,
  },
  nameRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  skeletonBar: { height: 10, width: 96, borderRadius: 4 },
  skeletonIcon: { width: 14, height: 14, borderRadius: 3 },
  loadError: { alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  loadErrorText: { fontSize: 12, lineHeight: 16 },
  renameWrap: { flex: 1, minWidth: 0 },
  renameError: { marginTop: 2, fontSize: 10, lineHeight: 13 },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ffffff",
    flexShrink: 0,
  },
  folderMarkPartial: { opacity: 0.5 },
  folderEmpty: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingBottom: 4,
    fontSize: 11,
    lineHeight: 14,
  },
  searchEmpty: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, lineHeight: 16 },
  rowMoreBtn: { width: 24, height: 24, minWidth: 24, minHeight: 24, padding: 0, flexShrink: 0 },
  renameInput: {
    minWidth: 0,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
  },
});
