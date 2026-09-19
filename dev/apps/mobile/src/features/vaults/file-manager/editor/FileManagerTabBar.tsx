import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from "react-native";
import {
  fileBaseName,
  FILE_MANAGER_LONG_PRESS_MS,
  FILE_MANAGER_LONG_PRESS_MOVE_PX,
  isPathDirty,
  sessionPathKind,
  type VaultWorkspaceAction,
  type VaultWorkspaceState,
} from "@upriv/shared";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import { measurePageRect, type PageRect } from "../lib/measurePageRect";

interface FileManagerTabBarProps {
  workspace: VaultWorkspaceState;
  onWorkspaceAction: (action: VaultWorkspaceAction) => void;
  onSave?: () => void;
  showSave?: boolean;
}

/** Same breakpoint as desktop `md:` / `useMediaQuery("(max-width: 767px)")`. */
const NARROW_MAX_WIDTH = 767;
const TAB_MAX_WIDTH = 180;
const TAB_LABEL_MAX = 132;

export function FileManagerTabBar({
  workspace,
  onWorkspaceAction,
  onSave,
  showSave = false,
}: FileManagerTabBarProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const compact = windowWidth > NARROW_MAX_WIDTH;
  const { openTabs, activeTabPath } = workspace;
  const barHeight = compact ? 32 : 36;

  const tabViewsRef = useRef(new Map<string, View>());
  const tabRectsRef = useRef(new Map<string, PageRect>());
  const dragSourceRef = useRef<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const refreshTabRects = useCallback(() => {
    tabViewsRef.current.forEach((view, key) => {
      measurePageRect(view, (rect) => {
        tabRectsRef.current.set(key, rect);
      });
    });
  }, []);

  const bindTabRef = useCallback((path: string) => {
    return {
      ref: (node: View | null) => {
        if (node) {
          tabViewsRef.current.set(path, node);
          measurePageRect(node, (rect) => {
            tabRectsRef.current.set(path, rect);
          });
        } else {
          tabViewsRef.current.delete(path);
          tabRectsRef.current.delete(path);
        }
      },
      onLayout: () => {
        const view = tabViewsRef.current.get(path);
        if (!view) return;
        measurePageRect(view, (rect) => {
          tabRectsRef.current.set(path, rect);
        });
      },
      collapsable: false as const,
    };
  }, []);

  const hitTabPath = useCallback((pageX: number, pageY: number): string | null => {
    const source = dragSourceRef.current;
    let best: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    tabRectsRef.current.forEach((rect, key) => {
      if (key === source) return;
      if (pageX < rect.x || pageX > rect.x + rect.w) return;
      if (pageY < rect.y - 8 || pageY > rect.y + rect.h + 8) return;
      const centerX = rect.x + rect.w / 2;
      const dist = Math.abs(pageX - centerX);
      if (dist < bestDist) {
        bestDist = dist;
        best = key;
      }
    });
    return best;
  }, []);

  const clearDrag = useCallback(() => {
    dragSourceRef.current = null;
    dropTargetRef.current = null;
    setDragSourcePath(null);
    setDropTargetPath(null);
  }, []);

  const onDragStart = useCallback(
    (path: string) => {
      dragSourceRef.current = path;
      dropTargetRef.current = null;
      setDragSourcePath(path);
      setDropTargetPath(null);
      refreshTabRects();
    },
    [refreshTabRects],
  );

  const onDragMove = useCallback(
    (pageX: number, pageY: number) => {
      if (!dragSourceRef.current) return;
      const target = hitTabPath(pageX, pageY);
      if (dropTargetRef.current === target) return;
      dropTargetRef.current = target;
      setDropTargetPath(target);
    },
    [hitTabPath],
  );

  const onDragEnd = useCallback(
    (pageX: number, pageY: number) => {
      const source = dragSourceRef.current;
      const target = dropTargetRef.current ?? hitTabPath(pageX, pageY);
      if (source && target && source !== target) {
        onWorkspaceAction({ type: "reorder_tabs", fromPath: source, toPath: target });
      }
      clearDrag();
    },
    [clearDrag, hitTabPath, onWorkspaceAction],
  );

  if (openTabs.length === 0) {
    return (
      <View
        style={[
          styles.emptyBar,
          { height: barHeight, backgroundColor: colors.surfaceContainer },
        ]}
      >
        <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
          {t("modal.file_manager.tabs.empty")}
        </Text>
      </View>
    );
  }

  const isDragging = Boolean(dragSourcePath);

  return (
    <View
      style={[
        styles.bar,
        { height: barHeight, backgroundColor: colors.surfaceContainer },
      ]}
    >
      <ScrollView
        horizontal
        scrollEnabled={!isDragging}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        accessibilityRole="tablist"
        accessibilityLabel={t("modal.file_manager.tabs.label")}
      >
        {openTabs.map((path) => {
          const isActive = path === activeTabPath;
          const dirty = isPathDirty(workspace, path);
          const pathKind = sessionPathKind(workspace, path);
          const name = fileBaseName(path);
          const tabBind = bindTabRef(path);
          return (
            <TabChip
              key={path}
              path={path}
              name={name}
              barHeight={barHeight}
              isActive={isActive}
              isDirty={dirty}
              pathKind={pathKind}
              isDragging={dragSourcePath === path}
              isDropTarget={dropTargetPath === path && dragSourcePath !== path}
              dragActive={isDragging}
              colors={colors}
              typography={typography}
              tabBind={tabBind}
              onActivate={() => onWorkspaceAction({ type: "set_active_tab", path })}
              onClose={() => onWorkspaceAction({ type: "request_close_tab", path })}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={clearDrag}
              closeLabel={t("modal.file_manager.tabs.close", { name })}
            />
          );
        })}
      </ScrollView>
      {showSave && onSave ? (
        <View
          style={[
            styles.saveWrap,
            { height: barHeight, backgroundColor: colors.surfaceContainerHigh },
          ]}
        >
          <IconButton
            label={t("modal.file_manager.viewer.save")}
            icon="save"
            size={16}
            tone="muted"
            onPress={onSave}
            style={styles.saveButton}
          />
        </View>
      ) : null}
    </View>
  );
}

function TabChip({
  path,
  name,
  barHeight,
  isActive,
  isDirty,
  pathKind,
  isDragging,
  isDropTarget,
  dragActive,
  colors,
  typography,
  tabBind,
  onActivate,
  onClose,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  closeLabel,
}: {
  path: string;
  name: string;
  barHeight: number;
  isActive: boolean;
  isDirty: boolean;
  pathKind: ReturnType<typeof sessionPathKind>;
  isDragging: boolean;
  isDropTarget: boolean;
  dragActive: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
  tabBind: {
    ref: (node: View | null) => void;
    onLayout: () => void;
    collapsable: false;
  };
  onActivate: () => void;
  onClose: () => void;
  onDragStart: (path: string) => void;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: (pageX: number, pageY: number) => void;
  onDragCancel: () => void;
  closeLabel: string;
}) {
  const armedRef = useRef(false);
  const panGrantedRef = useRef(false);
  const movedRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const callbacksRef = useRef({
    path,
    dragActive,
    onActivate,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
  });
  callbacksRef.current = {
    path,
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

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => armedRef.current,
        onMoveShouldSetPanResponderCapture: () => armedRef.current,
        onPanResponderTerminationRequest: () => !armedRef.current,
        onShouldBlockNativeResponder: () => armedRef.current,
        onPanResponderGrant: () => {
          panGrantedRef.current = true;
          callbacksRef.current.onDragStart(callbacksRef.current.path);
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
    if (callbacksRef.current.dragActive) return;
    const { pageX, pageY } = event.nativeEvent;
    touchStartRef.current = { x: pageX, y: pageY };
    armedRef.current = false;
    panGrantedRef.current = false;
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

  const onTouchEndOrCancel = () => {
    const wasArmed = armedRef.current;
    const panHadGrant = panGrantedRef.current;
    const wasMoved = movedRef.current;
    clearLongPressTimer();
    touchStartRef.current = null;
    movedRef.current = false;

    if (panHadGrant) return;

    if (wasArmed) {
      armedRef.current = false;
      callbacksRef.current.onDragCancel();
      return;
    }

    armedRef.current = false;
    if (!wasMoved && !callbacksRef.current.dragActive) {
      callbacksRef.current.onActivate();
    }
  };

  return (
    <View
      ref={tabBind.ref}
      onLayout={tabBind.onLayout}
      collapsable={tabBind.collapsable}
      {...pan.panHandlers}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEndOrCancel}
      onTouchCancel={onTouchEndOrCancel}
      style={[
        styles.tab,
        {
          height: barHeight,
          backgroundColor: isActive ? colors.surfaceContainerHigh : colors.surfaceContainer,
          opacity: isDragging ? 0.5 : 1,
          borderColor: isDropTarget ? colors.accent : "transparent",
          borderWidth: isDropTarget ? 1 : 0,
        },
      ]}
    >
      <View
        style={styles.tabMain}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={name}
      >
        <Icon
          name="file"
          size={12}
          color={
            pathKind === "created"
              ? colors.vaultStatusOpen
              : pathKind === "modified"
                ? colors.accent
                : colors.onSurfaceVariant
          }
        />
        <Text
          style={[
            styles.tabLabel,
            typography.caption,
            {
              color: isActive ? colors.onSurface : colors.onSurfaceVariant,
              fontWeight: isActive ? "600" : "400",
            },
          ]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {name}
        </Text>
        {isDirty ? <View style={styles.dirtyDot} /> : null}
      </View>
      {!dragActive ? (
        <View
          onStartShouldSetResponder={() => true}
          onTouchEnd={(event) => {
            event.stopPropagation();
            onClose();
          }}
          style={styles.tabClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        >
          <Text style={{ color: colors.onSurfaceVariant, fontSize: 14 }}>×</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyBar: {
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  bar: {
    flexDirection: "row",
    alignItems: "stretch",
    flexShrink: 0,
  },
  tabs: {
    alignItems: "center",
    flexGrow: 0,
  },
  tab: {
    maxWidth: TAB_MAX_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  tabMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 10,
    paddingRight: 4,
    maxWidth: TAB_LABEL_MAX + 22,
  },
  tabLabel: {
    maxWidth: TAB_LABEL_MAX,
    flexShrink: 1,
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ffffff",
    flexShrink: 0,
  },
  tabClose: {
    width: 28,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  saveWrap: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    flexShrink: 0,
  },
  saveButton: {
    width: 36,
    height: 32,
    minWidth: 36,
    minHeight: 32,
    padding: 0,
  },
});
