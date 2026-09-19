import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clipboard,
  FlatList,
  PanResponder,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type ListRenderItem,
  type ViewStyle,
} from "react-native";
import {
  findNode,
  getParentPath,
  isDescendantPath,
  isPathDirty,
  joinPath,
  liveFileNameError,
  fileNameErrorI18nKey,
  LOGICAL_FILE_NAME_MAX_LENGTH,
  renameBasenameSelection,
  sessionPathKind,
  FILE_MANAGER_LONG_PRESS_MS,
  FILE_MANAGER_LONG_PRESS_MOVE_PX,
  FILE_MANAGER_DROP_EXPAND_MS,
  pointInHitRect,
  smallestContainingKey,
  type FileTreeNode,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { DropdownPanel, IconButton, MenuActionItem } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { colorAlpha, radii } from "@/theme/tokens";
import type { FileManagerApi } from "../hooks/useVaultFileManager";
import { measurePageRect, type PageRect } from "../lib/measurePageRect";
import {
  pickImportFiles,
  pickImportFolder,
  DocumentPickerUnavailableError,
  FolderPickerUnavailableError,
  type MobileImportPick,
} from "../lib/osFileImport";

interface FileTreePanelProps {
  fm: FileManagerApi;
  layout: "column" | "row";
  /** Pixel height (column) or width (row) from workspace split. */
  splitExtent?: number;
}

interface FlatEntry {
  path: string;
  node: FileTreeNode;
  depth: number;
}

const DEPTH_INDENT = 10;
const TWISTIE = 14;
const ROOT_DROP_KEY = "/";

function walkExpanded(
  node: FileTreeNode,
  path: string,
  depth: number,
  expandedPaths: readonly string[],
  out: FlatEntry[],
): void {
  for (const child of node.children ?? []) {
    const childPath = joinPath(path, child.name);
    out.push({ path: childPath, node: child, depth });
    if (child.type === "folder" && expandedPaths.includes(childPath)) {
      walkExpanded(child, childPath, depth + 1, expandedPaths, out);
    }
  }
}

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

export function FileTreePanel({ fm, layout, splitExtent }: FileTreePanelProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { workspace, dispatch, commitRename, movePath } = fm;

  const entries = useMemo(() => {
    const out: FlatEntry[] = [];
    if (fm.tree.type === "folder") {
      walkExpanded(fm.tree, "/", 0, workspace.expandedPaths, out);
    }
    return out;
  }, [fm.tree, workspace.expandedPaths]);

  const dropViewsRef = useRef(new Map<string, View>());
  const dropRectsRef = useRef(new Map<string, PageRect>());
  const dragSourceRef = useRef<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const folderPathsRef = useRef<Set<string>>(new Set());
  const expandedPathsRef = useRef(workspace.expandedPaths);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellFolderRef = useRef<string | null>(null);
  expandedPathsRef.current = workspace.expandedPaths;

  folderPathsRef.current = new Set(
    entries.filter((e) => e.node.type === "folder").map((e) => e.path),
  );

  const refreshDropRects = useCallback(() => {
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
    if (!workspace.dragSourcePath) return;
    refreshDropRects();
  }, [workspace.dragSourcePath, entries, refreshDropRects]);

  const clearExpandDwell = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    dwellFolderRef.current = null;
  }, []);

  const scheduleExpandDwell = useCallback(
    (folder: string | null) => {
      const canExpand = Boolean(
        folder && folder !== ROOT_DROP_KEY && !expandedPathsRef.current.includes(folder),
      );
      const next = canExpand ? folder : null;
      if (dwellFolderRef.current === next) return;
      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
      dwellFolderRef.current = next;
      if (!next) return;
      dwellTimerRef.current = setTimeout(() => {
        dwellTimerRef.current = null;
        if (dropTargetRef.current === next && dragSourceRef.current) {
          dispatch({ type: "expand_folder", path: next });
        }
      }, FILE_MANAGER_DROP_EXPAND_MS);
    },
    [dispatch],
  );

  useEffect(() => () => clearExpandDwell(), [clearExpandDwell]);

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
    clearExpandDwell();
    dragSourceRef.current = null;
    dropTargetRef.current = null;
    dispatch({ type: "set_drag", source: null, target: null });
  }, [clearExpandDwell, dispatch]);

  const onDragStart = useCallback(
    (path: string, _pageX: number, _pageY: number) => {
      dragSourceRef.current = path;
      dropTargetRef.current = null;
      dispatch({ type: "set_drag", source: path, target: null });
      refreshDropRects();
    },
    [dispatch, refreshDropRects],
  );

  const onDragMove = useCallback(
    (pageX: number, pageY: number) => {
      const source = dragSourceRef.current;
      if (!source) return;
      const target = hitDropFolder(pageX, pageY);
      if (dropTargetRef.current !== target) {
        dropTargetRef.current = target;
        dispatch({ type: "set_drag", source, target });
      }
      scheduleExpandDwell(target);
    },
    [dispatch, hitDropFolder, scheduleExpandDwell],
  );

  const onDragEnd = useCallback(
    (pageX: number, pageY: number) => {
      const source = dragSourceRef.current;
      const target = dropTargetRef.current ?? hitDropFolder(pageX, pageY);
      if (source && target && !isDescendantPath(source, target)) {
        if (!(target === ROOT_DROP_KEY && getParentPath(source) === "/")) {
          movePath(source, target);
        }
      }
      clearDrag();
    },
    [clearDrag, hitDropFolder, movePath],
  );

  const runImport = async (pick: () => Promise<MobileImportPick | null>) => {
    try {
      const result = await pick();
      if (!result) return;
      await fm.importFiles(createTargetPath(fm), result.files, {
        openFirstViewable: true,
        skippedUnsupported: result.skippedUnsupported,
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

  const isDragging = Boolean(workspace.dragSourcePath);
  const treeListExtraData = useMemo(
    () => ({
      dragSourcePath: workspace.dragSourcePath,
      dropTargetPath: workspace.dropTargetPath,
      selectedPath: workspace.selectedPath,
      activeTabPath: workspace.activeTabPath,
      renamingPath: workspace.renamingPath,
      expandedPaths: workspace.expandedPaths,
      dirtyPaths: workspace.dirtyPaths,
      sessionCreatedPaths: workspace.sessionCreatedPaths,
      sessionModifiedPaths: workspace.sessionModifiedPaths,
    }),
    [
      workspace.dragSourcePath,
      workspace.dropTargetPath,
      workspace.selectedPath,
      workspace.activeTabPath,
      workspace.renamingPath,
      workspace.expandedPaths,
      workspace.dirtyPaths,
      workspace.sessionCreatedPaths,
      workspace.sessionModifiedPaths,
    ],
  );
  const rootDropActive = workspace.dropTargetPath === ROOT_DROP_KEY;
  const setRootDropRef = useCallback(
    (node: View | null) => {
      registerDropTarget(ROOT_DROP_KEY, node);
    },
    [registerDropTarget],
  );
  const onRootDropLayout = useCallback(() => {
    remeasureDropTarget(ROOT_DROP_KEY);
  }, [remeasureDropTarget]);
  const dropTargetPath =
    workspace.dropTargetPath && workspace.dropTargetPath !== ROOT_DROP_KEY
      ? workspace.dropTargetPath
      : null;
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

  const renderItem: ListRenderItem<FlatEntry> = ({ item }) => {
    const isFolder = item.node.type === "folder";
    const isExpanded = isFolder && workspace.expandedPaths.includes(item.path);
    const isSelected = workspace.activeTabPath === item.path;
    const isDirty = !isFolder && isPathDirty(workspace, item.path);
    const pathKind = sessionPathKind(workspace, item.path);
    const isRenaming = workspace.renamingPath === item.path;
    const isRowDragging = workspace.dragSourcePath === item.path;
    const inDropZone = Boolean(
      dropTargetPath &&
      (item.path === dropTargetPath || isDescendantPath(dropTargetPath, item.path)),
    );

    return (
      <FileTreeRow
        path={item.path}
        name={item.node.name}
        isFolder={isFolder}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isDirty={isDirty}
        pathKind={pathKind}
        isRenaming={isRenaming}
        isDragging={isRowDragging}
        inDropZone={inDropZone}
        dropZoneStart={inDropZone && item.path === dropTargetPath}
        dropZoneEnd={inDropZone && item.path === dropZoneEndPath}
        depth={item.depth}
        fm={fm}
        dragActive={isDragging}
        registerDropTarget={registerDropTarget}
        remeasureDropTarget={remeasureDropTarget}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={clearDrag}
        onActivate={() => {
          if (isRenaming || isDragging) return;
          if (isFolder) {
            dispatch({ type: "toggle_folder", path: item.path });
            return;
          }
          fm.openFile(item.path);
        }}
        onCommitRename={(name) => commitRename(item.path, name)}
        onCancelRename={() => dispatch({ type: "cancel_rename" })}
      />
    );
  };

  const paneStyle: ViewStyle =
    layout === "column"
      ? {
          height: (splitExtent ?? "20%") as DimensionValue,
          width: "100%",
          flexShrink: 0,
        }
      : {
          width: (splitExtent ?? "20%") as DimensionValue,
          height: "100%",
          flexShrink: 0,
        };

  return (
    <View style={[styles.panel, paneStyle, { backgroundColor: colors.surfaceContainer }]}>
      <View style={styles.toolbar}>
        <Text
          style={[styles.toolbarLabel, { color: colors.onSurfaceVariant }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {t("modal.file_manager.explorer.title")}
        </Text>
        <View style={styles.toolbarActions}>
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
              void runImport(pickImportFolder);
            }}
            style={styles.toolBtn}
          />
        </View>
      </View>
      <View
        ref={setRootDropRef}
        onLayout={onRootDropLayout}
        collapsable={false}
        style={[styles.listShell, rootDropActive ? { borderColor: colors.accent } : null]}
      >
        <FlatList
          data={entries}
          extraData={treeListExtraData}
          keyExtractor={(item) => item.path}
          renderItem={renderItem}
          scrollEnabled={!isDragging}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          style={styles.list}
          contentContainerStyle={styles.listContent}
        />
      </View>
    </View>
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
  depth: number;
  fm: FileManagerApi;
  dragActive: boolean;
  registerDropTarget: (path: string, node: View | null) => void;
  remeasureDropTarget: (path: string) => void;
  onDragStart: (path: string, pageX: number, pageY: number) => void;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: (pageX: number, pageY: number) => void;
  onDragCancel: () => void;
  onActivate: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
}

function FileTreeRow({
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
  depth,
  fm,
  dragActive,
  registerDropTarget,
  remeasureDropTarget,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onActivate,
  onCommitRename,
  onCancelRename,
}: FileTreeRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [renameValue, setRenameValue] = useState(name);
  const [renameSelection, setRenameSelection] = useState<
    { start: number; end: number } | undefined
  >();
  const renameError = isRenaming ? liveFileNameError(renameValue) : null;
  const parentForCreate = isFolder ? path : getParentPath(path);

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
  const panGrantedRef = useRef(false);
  const movedRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const callbacksRef = useRef({
    path,
    isRenaming,
    dragActive,
    onActivate,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
  });
  callbacksRef.current = {
    path,
    isRenaming,
    dragActive,
    onActivate,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
  };

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      armedRef.current = false;
      panGrantedRef.current = false;
    };
  }, [clearLongPressTimer]);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(name);
      setRenameSelection(renameBasenameSelection(name));
      clearLongPressTimer();
      armedRef.current = false;
      panGrantedRef.current = false;
    } else {
      setRenameSelection(undefined);
    }
  }, [isRenaming, name, clearLongPressTimer]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => armedRef.current,
        onMoveShouldSetPanResponderCapture: () => armedRef.current,
        onPanResponderTerminationRequest: () => !armedRef.current,
        onShouldBlockNativeResponder: () => armedRef.current,
        onPanResponderGrant: (event) => {
          panGrantedRef.current = true;
          const { path: p, onDragStart: start } = callbacksRef.current;
          start(p, event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderMove: (event) => {
          callbacksRef.current.onDragMove(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderRelease: (event) => {
          armedRef.current = false;
          panGrantedRef.current = false;
          clearLongPressTimer();
          callbacksRef.current.onDragEnd(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderTerminate: () => {
          armedRef.current = false;
          panGrantedRef.current = false;
          clearLongPressTimer();
          callbacksRef.current.onDragCancel();
        },
      }),
    [clearLongPressTimer],
  );

  const onTouchStart = (event: GestureResponderEvent) => {
    if (callbacksRef.current.isRenaming || callbacksRef.current.dragActive) return;
    const { pageX, pageY } = event.nativeEvent;
    touchStartRef.current = { x: pageX, y: pageY };
    armedRef.current = false;
    panGrantedRef.current = false;
    movedRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      armedRef.current = true;
      const { path: p, onDragStart: start } = callbacksRef.current;
      start(p, pageX, pageY);
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

  const onTouchEndOrCancel = () => {
    const wasArmed = armedRef.current;
    const panHadGrant = panGrantedRef.current;
    const wasMoved = movedRef.current;
    clearLongPressTimer();
    touchStartRef.current = null;
    movedRef.current = false;

    if (panHadGrant) {
      // Release/terminate already finished the drag.
      return;
    }

    if (wasArmed) {
      armedRef.current = false;
      callbacksRef.current.onDragCancel();
      return;
    }

    armedRef.current = false;
    if (!wasMoved && !callbacksRef.current.isRenaming && !callbacksRef.current.dragActive) {
      callbacksRef.current.onActivate();
    }
  };

  const copyPath = () => {
    try {
      Clipboard.setString(path);
      fm.showToast(t("modal.file_manager.toast.copied"));
    } catch {
      fm.showToast(t("modal.file_manager.toast.copy_failed"));
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
          opacity: isDragging ? 0.5 : 1,
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
        {...pan.panHandlers}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEndOrCancel}
        onTouchCancel={onTouchEndOrCancel}
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
              onChangeText={setRenameValue}
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
            <Text
              style={[
                styles.rowName,
                { color: isSelected ? colors.onSurface : colors.onSurfaceVariant },
              ]}
              numberOfLines={1}
            >
              {name}
            </Text>
            {isDirty ? <View style={styles.dirtyDot} /> : null}
          </View>
        )}
      </View>
      {!isRenaming && !dragActive ? (
        // No “open in terminal” on mobile — desktop-only (SDD §9.5).
        <DropdownPanel
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
                onPress={() => fm.createFile(parentForCreate)}
              />
              <MenuActionItem
                icon="folder"
                label={t("modal.file_manager.context.new_folder")}
                onPress={() => fm.createFolder(parentForCreate)}
              />
            </>
          ) : null}
          <MenuActionItem
            icon="pencil"
            label={t("modal.file_manager.context.rename")}
            onPress={() => fm.dispatch({ type: "start_rename", path })}
          />
          <MenuActionItem
            icon="copy"
            label={t("modal.file_manager.context.copy_path")}
            onPress={copyPath}
          />
          <MenuActionItem
            icon="file-manager"
            label={t("modal.file_manager.context.open_system")}
            onPress={() => fm.showMockToast("open_system")}
          />
          <MenuActionItem
            icon="trash"
            label={t("modal.file_manager.context.delete")}
            danger
            onPress={() => fm.requestDelete(path)}
          />
        </DropdownPanel>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { minHeight: 0, minWidth: 0, overflow: "hidden" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    flexShrink: 0,
  },
  toolbarLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    fontWeight: "500",
    fontFamily: "monospace",
    textTransform: "uppercase",
    letterSpacing: 1.6,
    includeFontPadding: false,
  },
  toolbarActions: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
  toolBtn: { width: 24, height: 24, minWidth: 24, minHeight: 24, padding: 0 },
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
  renameWrap: { flex: 1, minWidth: 0 },
  renameError: { marginTop: 2, fontSize: 10, lineHeight: 13 },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ffffff",
    flexShrink: 0,
  },
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
