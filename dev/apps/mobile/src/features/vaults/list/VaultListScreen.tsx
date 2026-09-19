import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from "react-native";
import {
  canReorderGroupedVaults,
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromBackup,
  normalizeStoredName,
  draggingGroupedVaultSourceGroupId as resolveDraggingGroupedVaultSourceGroupId,
  groupedVaultDragKey,
  isGroupedVaultDragKey,
  appConfigEditAllowed,
  groupedVaultSortOf,
  hiddenUngroupedRootVaults,
  hiddenOmittedRootGroups,
  hexWithAlpha,
  listDropHighlight,
  isListUngroupDragKey,
  listUngroupDragKey,
  GROUP_COLLAPSE_MS,
  GROUP_EXPAND_MS,
  parseGroupedVaultDragKey,
  pickListDropTarget,
  pointInHitRect,
  reorderGroupedVaults,
  reorderRootRows,
  resolveListDrop,
  validateDisplayName,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  GROUPED_VAULT_SORT_MODES,
  vaultBlocksGroupInnerColumns,
  SORT_DIRECTION_ICON,
  SORT_MODE_ICON,
  VIEW_MODE_ICON,
  type VaultGroup,
  type VaultListItem,
  type VaultListSortDirection,
  type VaultListSortMode,
  type VaultListViewMode,
} from "@upriv/shared";
import { type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useTheme } from "@/theme";
import {
  CONTROL_HEIGHT_MD,
  CONTROL_WIDTH_CHROME,
  MAX_WIDTH_VAULT_LIST,
  radii,
  spacing,
  touchMin,
  vaultRowBoxShadow,
} from "@/theme/tokens";
import { AppSettingsModal } from "@/features/system/settings/AppSettingsModal";
import { VaultRootDataFolderModal } from "@/features/system/settings/VaultRootDataFolderModal";
import { LogsModal } from "@/features/system/logs/LogsModal";
import { HelpModal } from "@/features/system/help/HelpModal";
import { SystemInfoModal } from "@/features/system/info/SystemInfoModal";
import { VaultInfoModal } from "@/features/vaults/info/VaultInfoModal";
import { CreateVaultModal } from "@/features/vaults/create/CreateVaultModal";
import { ExportVaultModal } from "@/features/vaults/list/ExportVaultModal";
import { VaultGroupsModal } from "@/features/vaults/list/VaultGroupsModal";
import { VaultNoteModal } from "@/features/vaults/list/VaultNoteModal";
import { GroupedVaultPicker } from "@/features/vaults/list/GroupedVaultPicker";
import {
  VaultLifecycleModal,
  VaultRecoveryModal,
  WorkspaceSetupModal,
} from "@/features/vaults/lifecycle";
import { VaultSettingsModal } from "@/features/vaults/settings/VaultSettingsModal";
import { VaultBackupsModal } from "@/features/vaults/backups/VaultBackupsModal";
import { FileManagerLayer } from "@/features/vaults/file-manager";
import { UprivWordmark } from "@/components/brand/UprivWordmark";
import { CenteredPanel } from "@/components/layout/CenteredPanel";
import {
  Button,
  Collapse,
  DropdownPanel,
  IconButton,
  LoadingBudgetHint,
  MenuActionItem,
  MenuGroupLabel,
  Modal,
  ModalFooterActions,
  Toast,
} from "@/components/ui";
import {
  FieldHint,
  FieldLabel,
  PolicyRadioOption,
  SettingsAccordionSection,
  SwitchRow,
  ThemedInput,
  DisplayNameFieldError,
} from "@/components/settings";
import { RadioGroup } from "@/components/settings/settingsFields";
import { Icon } from "@/components/icons";
import { DropOverRing } from "./DropOverRing";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultListEmptyState } from "./VaultListEmptyState";
import { VaultListSearch } from "./VaultListSearch";
import { VaultRow } from "./VaultRow";
import { useVaultListScreen } from "./hooks";
import { type BlocksGroupCell, type FlatHierarchyRow } from "./lib/hierarchyRows";

const SORT_MODES: VaultListSortMode[] = ["order", "name", "state", "last_accessed", "groups"];
const SORT_DIRS: VaultListSortDirection[] = ["asc", "desc"];
const VIEW_MODES: VaultListViewMode[] = ["default", "large", "compact", "blocks"];
/** Desktop `AppShell` main `py-10`. */
const MAIN_PAD_TOP = 40;
/** Outer gutter — a step tighter than desktop `px-margin-mobile` (16). */
const PAGE_PAD_H = spacing.md;

function StickyAppHeader({
  insetTop,
  background,
  onHeight,
  children,
}: {
  insetTop: number;
  background: string;
  onHeight: (height: number) => void;
  children: ReactNode;
}) {
  return (
    <View
      style={[styles.header, { paddingTop: insetTop, backgroundColor: background }]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      {children}
    </View>
  );
}

function GroupChevron({ collapsed, color }: { collapsed: boolean; color: string }) {
  const rotation = useRef(new Animated.Value(collapsed ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: collapsed ? 1 : 0,
      duration: collapsed ? GROUP_COLLAPSE_MS : GROUP_EXPAND_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [collapsed, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-90deg"],
  });

  return (
    <Animated.View style={[styles.groupChevronWrap, { transform: [{ rotate }] }]}>
      <Icon name="chevron-down" size={18} color={color} />
    </Animated.View>
  );
}

export function VaultListScreen() {
  const {
    t,
    settings,
    patchSettings,
    show,
    dismiss,
    message,
    openFromVault,
    setMeasuredHeaderHeight,
    listSearch,
    setListSearch,
    vaultListSearchRef,
    blurVaultListSearchIfOutside,
    vaults,
    setVaults,
    groups,
    setGroups,
    groupsInvalid,
    groupsInvalidDismissed,
    setGroupsInvalidDismissed,
    groupsSanitizeNotice,
    setGroupsSanitizeNotice,
    refreshing,
    draggingId,
    setDraggingId,
    draggingIdRef,
    dragOverId,
    setDragOverId,
    dragOverIdRef,
    dragPointer,
    setDragPointer,
    dragScrollLock,
    setDragScrollLock,
    dropViewsRef,
    dropRectsRef,
    settingsOpen,
    setSettingsOpen,
    settingsDirty,
    setSettingsDirty,
    dataFolderOpen,
    setDataFolderOpen,
    dataFolderDirty,
    setDataFolderDirty,
    groupsOpen,
    setGroupsOpen,
    groupsDirty,
    setGroupsDirty,
    logsOpen,
    setLogsOpen,
    helpOpen,
    setHelpOpen,
    systemInfoOpen,
    setSystemInfoOpen,
    vaultInfoVaultId,
    setVaultInfoVaultId,
    createOpen,
    createDraft,
    createStep,
    lifecycleRequest,
    settingsVault,
    setSettingsVault,
    settingsArea,
    setSettingsArea,
    noteVaultId,
    setNoteVaultId,
    exportVault,
    setExportVault,
    exportSubmitting,
    backupsVault,
    setBackupsVault,
    settingsGroup,
    setSettingsGroup,
    groupDraftName,
    setGroupDraftName,
    groupDraftOrder,
    setGroupDraftOrder,
    groupDraftGroupedVaults,
    setGroupDraftGroupedVaults,
    groupDraftGroupedVaultSort,
    setGroupDraftGroupedVaultSort,
    groupDraftGroupedVaultSortDirection,
    setGroupDraftGroupedVaultSortDirection,
    groupDraftHidden,
    setGroupDraftHidden,
    groupDeleteOpen,
    setGroupDeleteOpen,
    groupFormError,
    setGroupFormError,
    groupBusy,
    repairBusy,
    setRepairBusy,
    insets,
    appHeaderHeight,
    groupsRef,
    groupBusyGenRef,
    repairGenRef,
    groupBudget,
    repairBudget,
    sortMode,
    sortDirection,
    viewMode,
    showHidden,
    searchActive,
    vaultListShowDrag,
    showHeaderMore,
    showGroupSettings,
    vaultListAllowDragIntoGroup,
    canReorder,
    existingVaultIds,
    existingOrders,
    noteVault,
    vaultInfoVault,
    displayRowsRef,
    searchNoMatches,
    visibleVaults,
    allVaultsHidden,
    lifecycle,
    reload,
    openCreate,
    closeCreate,
    pipelineStatus,
    handleConfirmExportVault,
    handleRowExport,
    handleExportTimeout,
    isVaultPipelineBusy,
    rowDensity,
    rowPaddingY,
    rowPaddingX,
    blockColumns,
    listData,
    blockCellWidth,
    displayNameMessage,
    applyListedIfCurrent,
    showGroupErr,
    runWithGroupBusy,
    persistRootOrders,
    persistVaultRootOrders,
    assignVaultToGroupByDrag,
    ungroupVaultFromGroup,
    handleCreateGroup,
    handleCommitGroupAssignment,
    handleVaultDelete,
    handleNoteChange,
    vaultsRef,
    handleVaultSettingsSaved,
    handlePersistBusyChange,
    handleCreateVault,
    vaultGroupService,
  } = useVaultListScreen();
  const { colors, typography, theme } = useTheme();

  const dropRefCbs = useRef(new Map<string, (node: View | null) => void>());
  const bindDropTarget = (key: string) => {
    let cb = dropRefCbs.current.get(key);
    if (!cb) {
      cb = (node: View | null) => {
        if (node) dropViewsRef.current.set(key, node);
        else {
          dropViewsRef.current.delete(key);
          dropRectsRef.current.delete(key);
        }
      };
      dropRefCbs.current.set(key, cb);
    }
    return {
      ref: cb,
      onLayout: () => {
        dropViewsRef.current.get(key)?.measureInWindow((x, y, w, h) => {
          dropRectsRef.current.set(key, { x, y, w, h });
        });
      },
      collapsable: false as const,
    };
  };

  const refreshDropRects = useCallback(() => {
    dropViewsRef.current.forEach((view, key) => {
      view.measureInWindow((x, y, w, h) => {
        dropRectsRef.current.set(key, { x, y, w, h });
      });
    });
  }, [dropRectsRef, dropViewsRef]);

  const hitDropKey = (pageX: number, pageY: number): string | null => {
    const source = draggingIdRef.current;
    const matches: string[] = [];
    dropRectsRef.current.forEach((rect, key) => {
      if (key === source || !pointInHitRect(pageX, pageY, rect)) return;
      matches.push(key);
    });
    return pickListDropTarget(matches, source);
  };

  const isUngroupDropKey = isListUngroupDragKey;

  const clearDrag = () => {
    draggingIdRef.current = null;
    dragOverIdRef.current = null;
    setDragScrollLock(false);
    setDraggingId(null);
    setDragOverId(null);
    setDragPointer(null);
  };

  const applyListDrop = (sourceKey: string, targetKey: string | null) => {
    const action = resolveListDrop({
      sourceKey,
      targetKey,
      canReorderRoot: canReorder,
      allowDragIntoGroup: vaultListAllowDragIntoGroup,
      canReorderGrouped: (groupId) => {
        const group = groupsRef.current.find((g) => g.id === groupId);
        return Boolean(
          group && vaultListShowDrag && canReorderGroupedVaults(groupedVaultSortOf(group)),
        );
      },
    });

    if (action.kind === "reorder-grouped") {
      const group = groupsRef.current.find((g) => g.id === action.groupId);
      if (group) {
        const nextGroup = reorderGroupedVaults(group, action.draggedVaultId, action.targetVaultId);
        setGroups((current) => current.map((g) => (g.id === group.id ? nextGroup : g)));
        void runWithGroupBusy(
          async (generation) => {
            await vaultGroupService.reorderGroupedVaults(group.id, nextGroup.groupedVaults);
            await applyListedIfCurrent(generation);
          },
          { ui: false },
        ).catch(() => undefined);
      }
      clearDrag();
      return;
    }

    if (action.kind === "ungroup") {
      void ungroupVaultFromGroup(action.vaultId, action.beforeVaultId).catch(() => undefined);
      clearDrag();
      return;
    }

    if (action.kind === "assign-to-group") {
      void assignVaultToGroupByDrag(
        action.vaultId,
        action.targetGroupId,
        action.beforeVaultId,
      ).catch(() => undefined);
      clearDrag();
      return;
    }

    if (action.kind === "reorder-root") {
      const previous = groupsRef.current;
      const previousVaults = vaultsRef.current;
      const hiddenTail = hiddenUngroupedRootVaults(
        previousVaults,
        previous,
        displayRowsRef.current,
      );
      const hiddenGroups = hiddenOmittedRootGroups(previous, displayRowsRef.current);
      const nextRows = reorderRootRows(
        displayRowsRef.current,
        sourceKey,
        targetKey!,
        sortDirection,
        hiddenTail,
        hiddenGroups,
      );
      const nextVaults = previousVaults.map((vault) => {
        const row = nextRows.find((r) => r.kind === "vault" && r.vault.id === vault.id);
        return row && row.kind === "vault" ? { ...vault, order: row.vault.order } : vault;
      });
      const nextGroups = previous.map((group) => {
        const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
        return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
      });
      setVaults(nextVaults);
      setGroups(nextGroups);
      persistVaultRootOrders(nextVaults, previousVaults);
      persistRootOrders(nextGroups, previous);
      clearDrag();
      return;
    }

    if (action.kind === "blocked-reorder-root") {
      show(
        t(
          searchActive
            ? "toast.vault_list_reorder_needs_clear_search"
            : "toast.vault_list_reorder_needs_position_sort",
        ),
      );
    } else if (action.kind === "blocked-reorder-grouped") {
      show(
        t(
          searchActive
            ? "toast.vault_list_reorder_needs_clear_search"
            : "toast.vault_group_reorder_needs_position_sort",
        ),
      );
    }

    clearDrag();
  };

  const onRowDragStart = (key: string, pageX: number, pageY: number) => {
    setDragScrollLock(true);
    draggingIdRef.current = key;
    dragOverIdRef.current = null;
    setDraggingId(key);
    setDragOverId(null);
    setDragPointer({ x: pageX, y: pageY });
    refreshDropRects();
  };

  const onRowDragMove = (pageX: number, pageY: number) => {
    setDragPointer({ x: pageX, y: pageY });
    refreshDropRects();
    const over = hitDropKey(pageX, pageY);
    dragOverIdRef.current = over;
    setDragOverId(over);
  };

  const onRowDragEnd = (pageX: number, pageY: number) => {
    const over = dragOverIdRef.current ?? hitDropKey(pageX, pageY);
    const source = draggingIdRef.current;
    if (source) applyListDrop(source, over);
    else clearDrag();
  };

  const dragChipLabel = (() => {
    if (!draggingId) return "";
    if (draggingId.startsWith("group:")) {
      const id = draggingId.slice("group:".length);
      return groups.find((g) => g.id === id)?.displayName ?? "";
    }
    const vaultId = isGroupedVaultDragKey(draggingId)
      ? (parseGroupedVaultDragKey(draggingId)?.vaultId ?? null)
      : draggingId.startsWith("vault:")
        ? draggingId.slice("vault:".length)
        : null;
    return vaultId ? (vaults.find((v) => v.id === vaultId)?.displayName ?? "") : "";
  })();
  const draggingGroupedVaultSourceGroupId = resolveDraggingGroupedVaultSourceGroupId(
    draggingId,
    vaultListAllowDragIntoGroup,
  );

  const dropResolution =
    draggingId && dragOverId
      ? resolveListDrop({
          sourceKey: draggingId,
          targetKey: dragOverId,
          canReorderRoot: canReorder,
          allowDragIntoGroup: vaultListAllowDragIntoGroup,
          canReorderGrouped: (groupId) => {
            const group = groups.find((g) => g.id === groupId);
            return Boolean(
              group && vaultListShowDrag && canReorderGroupedVaults(groupedVaultSortOf(group)),
            );
          },
        })
      : { kind: "noop" as const };
  const dropHighlight = listDropHighlight(dropResolution.kind);
  const dropOverBlocked = dropHighlight === "blocked";
  const isDropOver = (key: string) =>
    dragOverId === key && draggingId !== key && dropHighlight !== "none";

  useEffect(() => {
    if (!draggingId) return;
    const frame = requestAnimationFrame(() => {
      refreshDropRects();
      requestAnimationFrame(refreshDropRects);
    });
    const timer = setTimeout(refreshDropRects, 64);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [draggingId, draggingGroupedVaultSourceGroupId, refreshDropRects]);

  const renderVaultRow = (
    vault: VaultListItem,
    opts?: { nested?: boolean; blocks?: boolean; group?: VaultGroup; dropKey?: string },
  ) => {
    const blocks = opts?.blocks === true;
    const dropKey =
      opts?.dropKey ??
      (opts?.group ? groupedVaultDragKey(opts.group.id, vault.id) : `vault:${vault.id}`);
    const dragEnabled = vaultListShowDrag
      ? opts?.group
        ? canReorderGroupedVaults(groupedVaultSortOf(opts.group)) || vaultListAllowDragIntoGroup
        : canReorder || vaultListAllowDragIntoGroup
      : false;
    const row = (
      <VaultRow
        vault={vault}
        variant={blocks ? "block" : "row"}
        viewMode={viewMode}
        nested={opts?.nested === true}
        pipelineListStatus={pipelineStatus}
        dragEnabled={dragEnabled}
        dragHandleLabel={
          dragEnabled
            ? opts?.group
              ? canReorderGroupedVaults(groupedVaultSortOf(opts.group))
                ? t("action.drag_reorder")
                : t("action.drag_to_group")
              : canReorder
                ? t("action.drag_reorder")
                : t("action.drag_to_group")
            : undefined
        }
        isDragging={draggingId === dropKey}
        isDragOver={isDropOver(dropKey)}
        isDropBlocked={dropOverBlocked}
        isPipelineBusy={isVaultPipelineBusy(vault.id)}
        dropTargetProps={bindDropTarget(dropKey)}
        onDragStart={(x, y) => onRowDragStart(dropKey, x, y)}
        onDragMove={onRowDragMove}
        onDragEnd={onRowDragEnd}
        onDragCancel={clearDrag}
        onOpenFileManager={openFromVault}
        onOpenSettings={(rowVault, area) => {
          setSettingsVault(rowVault);
          setSettingsArea(area);
        }}
        onUnlock={(rowVault) => lifecycle.requestLifecycle(rowVault.id, "unlock")}
        onLock={(rowVault) => lifecycle.requestLifecycle(rowVault.id, "close")}
        onExport={handleRowExport}
        onOpenBackups={(rowVault) => setBackupsVault(rowVault)}
        onOpenNote={(rowVault) => setNoteVaultId(rowVault.id)}
        onOpenVaultInfo={(rowVault) => setVaultInfoVaultId(rowVault.id)}
      />
    );
    return row;
  };

  const toggleGroupCollapsed = (group: VaultGroup) => {
    const nextCollapsed = !group.collapsed;
    setGroups((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, collapsed: nextCollapsed } : g)),
    );
    void vaultGroupService.setCollapsed(group.id, nextCollapsed).catch(() => {
      setGroups((prev) =>
        prev.map((g) => (g.id === group.id ? { ...g, collapsed: group.collapsed } : g)),
      );
    });
  };

  const openGroupSettings = (group: VaultGroup) => {
    setSettingsGroup(group);
    setGroupDraftName(group.displayName);
    setGroupDraftOrder(group.order);
    setGroupDraftGroupedVaults([...group.groupedVaults]);
    setGroupDraftGroupedVaultSort(group.groupedVaultSort);
    setGroupDraftGroupedVaultSortDirection(group.groupedVaultSortDirection);
    setGroupDraftHidden(group.hidden);
    setGroupDeleteOpen(false);
    setGroupFormError(null);
  };

  const renderUngroupDrop = (groupId: string, opts?: { fullWidth?: boolean }) => {
    const dropKey = listUngroupDragKey(groupId);
    const active = isUngroupDropKey(dragOverId) && dragOverId === dropKey;
    return (
      <View
        {...bindDropTarget(dropKey)}
        style={[
          styles.ungroupDrop,
          opts?.fullWidth ? styles.ungroupDropFullWidth : null,
          {
            borderColor: active ? colors.accent : colors.outlineVariant,
            backgroundColor: active ? colors.surfaceContainerHigh : "transparent",
          },
        ]}
      >
        <Text
          style={[typography.caption, styles.ungroupDropLabel, { color: colors.onSurfaceVariant }]}
        >
          {t("vault.group.drop_to_ungroup")}
        </Text>
      </View>
    );
  };

  const renderBlocksGroup = (pack: BlocksGroupCell, layout: "cell" | "wide" = "wide") => {
    const fillMemberGrid = layout === "wide";
    const groupedVaultCount = pack.memberCount;
    const groupInnerColumns =
      viewMode === "blocks" ? vaultBlocksGroupInnerColumns(groupedVaultCount, blockColumns) : 1;
    const wrapGroupMembers = viewMode === "blocks" && fillMemberGrid && groupInnerColumns > 1;
    const showUngroupInThisGroup = draggingGroupedVaultSourceGroupId === pack.group.id;
    const childrenVisible = !pack.group.collapsed && pack.groupedVaults.length > 0;
    const expanded = childrenVisible || showUngroupInThisGroup;
    const groupKey = pack.key;
    const isDragging = draggingId === groupKey;
    const isDragOver = isDropOver(groupKey);
    const groupDropTarget = bindDropTarget(groupKey);
    return (
      <View
        {...groupDropTarget}
        style={[
          styles.groupBox,
          layout === "cell" ? styles.groupBoxInCell : null,
          {
            backgroundColor: expanded ? colors.surfaceContainerLow : colors.surfaceContainer,
            borderColor: expanded ? colors.outlineVariant : "transparent",
            borderWidth: 1,
            opacity: isDragging ? 0.45 : 1,
            boxShadow: vaultRowBoxShadow(theme),
          },
        ]}
      >
        <DropOverRing
          visible={isDragOver}
          blocked={dropOverBlocked}
          accent={colors.accent}
          recovery={colors.vaultStatusRecovery}
        />
        <View
          style={[
            styles.groupHeader,
            {
              // Vertical pad on toggle/sides — header padY leaves dead bands in large mode.
              alignItems: "stretch",
              paddingRight: rowPaddingX,
              paddingLeft:
                vaultListShowDrag && canReorder
                  ? Math.max(rowPaddingX - 8, spacing.sm)
                  : rowPaddingX,
            },
          ]}
        >
          {vaultListShowDrag && canReorder ? (
            <View style={[styles.groupHeaderSide, { paddingVertical: rowPaddingY }]}>
              <VaultDragHandle
                disabled={!canReorder}
                onDragStart={(x, y) => onRowDragStart(groupKey, x, y)}
                onDragMove={onRowDragMove}
                onDragEnd={onRowDragEnd}
                onDragCancel={clearDrag}
              />
            </View>
          ) : null}
          <Pressable
            style={[styles.rowPress, { paddingVertical: rowPaddingY }]}
            onPress={() => toggleGroupCollapsed(pack.group)}
            onLongPress={showGroupSettings ? () => openGroupSettings(pack.group) : undefined}
            accessibilityRole="button"
            accessibilityState={{ expanded: childrenVisible }}
            accessibilityLabel={pack.group.displayName}
          >
            <GroupChevron collapsed={pack.group.collapsed} color={colors.onSurfaceVariant} />
            <View style={styles.rowText}>
              <View style={styles.groupTitleRow}>
                <Text
                  style={[
                    typography.body,
                    styles.rowTitle,
                    styles.groupTitle,
                    {
                      fontSize: rowDensity.titleSize,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {pack.group.displayName}
                </Text>
                <VaultHiddenIndicator
                  hidden={pack.group.hidden}
                  labelKey="vault.group.hidden.badge"
                />
              </View>
              <Text style={typography.caption}>
                {groupedVaultCount === 1
                  ? t("vault.group.count_one")
                  : t("vault.group.count", { count: String(groupedVaultCount) })}
              </Text>
            </View>
          </Pressable>
          {showGroupSettings ? (
            <View style={[styles.groupHeaderSide, { paddingVertical: rowPaddingY }]}>
              <IconButton
                label={t("vault.group.open_settings")}
                icon="settings"
                size={18}
                onPress={() => openGroupSettings(pack.group)}
              />
            </View>
          ) : null}
        </View>
        <Collapse open={childrenVisible}>
          <View style={[styles.groupGroupedVaults, wrapGroupMembers ? styles.blockRowWrap : null]}>
            {pack.groupedVaults.map((vault) => (
              <View
                key={vault.id}
                style={
                  viewMode === "blocks" && fillMemberGrid
                    ? wrapGroupMembers && blockCellWidth != null
                      ? { width: blockCellWidth, minWidth: 0 }
                      : { width: "100%", minWidth: 0 }
                    : { width: "100%", minWidth: 0 }
                }
              >
                {renderVaultRow(vault, {
                  nested: true,
                  blocks: viewMode === "blocks",
                  group: pack.group,
                })}
              </View>
            ))}
            {showUngroupInThisGroup
              ? renderUngroupDrop(pack.group.id, {
                  fullWidth: viewMode === "blocks" && fillMemberGrid,
                })
              : null}
          </View>
        </Collapse>
        {showUngroupInThisGroup && !childrenVisible
          ? renderUngroupDrop(pack.group.id, {
              fullWidth: viewMode === "blocks" && fillMemberGrid,
            })
          : null}
      </View>
    );
  };

  const renderItem: ListRenderItem<FlatHierarchyRow> = ({ item }) => {
    if (item.kind === "cell_row") {
      return (
        <View style={styles.blockRowWrap}>
          {item.cells.map((cell) => (
            <View
              key={cell.key}
              style={blockCellWidth != null ? { width: blockCellWidth } : styles.blockCellFill}
            >
              {cell.kind === "vault"
                ? renderVaultRow(cell.vault, { blocks: true, dropKey: cell.key })
                : renderBlocksGroup(cell, "cell")}
            </View>
          ))}
        </View>
      );
    }
    if (item.kind === "group_block") {
      return renderBlocksGroup(item, "wide");
    }

    const groupedVaultParts = isGroupedVaultDragKey(item.key)
      ? parseGroupedVaultDragKey(item.key)
      : null;
    const groupedVaultGroup = groupedVaultParts
      ? groups.find((g) => g.id === groupedVaultParts.groupId)
      : undefined;
    return renderVaultRow(item.vault, {
      blocks: viewMode === "blocks",
      group: groupedVaultGroup,
      dropKey: item.key,
    });
  };

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
      onTouchStart={blurVaultListSearchIfOutside}
    >
      <CenteredPanel maxWidth={MAX_WIDTH_VAULT_LIST}>
        <View style={styles.listHost}>
          <FlatList
            key={`vault-list-${viewMode}-${blockColumns}`}
            data={listData}
            extraData={`${draggingId}|${dragOverId}|${viewMode}|${searchActive}`}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            removeClippedSubviews={false}
            contentContainerStyle={[
              styles.list,
              {
                paddingTop: appHeaderHeight + MAIN_PAD_TOP,
                paddingBottom: Math.max(insets.bottom, spacing.xxl),
                paddingHorizontal: PAGE_PAD_H,
              },
              listData.length === 0 ? styles.listEmpty : null,
            ]}
            scrollEnabled={!draggingId && !dragScrollLock}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            ListHeaderComponent={
              <>
                <View style={styles.toolbar}>
                  <View style={styles.toolbarTitleRow}>
                    <Icon name="encrypted" size={22} color={colors.onSurfaceVariant} />
                    <Text style={[typography.headline, styles.toolbarTitle]} numberOfLines={1}>
                      {t("vault.list.title")}
                    </Text>
                    {settings.ui.vault_list_show_create_button !== false ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("app.new_vault")}
                        onPress={() =>
                          openCreate(createDraftForScratchSource(existingOrders), "source")
                        }
                        style={({ pressed }) => [
                          styles.toolbarIconBtn,
                          {
                            borderColor: colors.outlineVariant,
                            backgroundColor: pressed ? colors.surfaceContainerHigh : "transparent",
                          },
                        ]}
                      >
                        <Icon name="add" size={20} color={colors.onSurface} />
                      </Pressable>
                    ) : null}
                  </View>
                  {settings.ui.vault_list_show_search_button !== false ||
                  settings.ui.vault_list_show_sort_button !== false ||
                  settings.ui.vault_list_show_view_button !== false ? (
                    <View style={styles.toolbarFilters}>
                      {settings.ui.vault_list_show_search_button !== false ? (
                        <VaultListSearch
                          ref={vaultListSearchRef}
                          value={listSearch}
                          onChange={setListSearch}
                        />
                      ) : null}

                      {settings.ui.vault_list_show_sort_button !== false ? (
                        <View style={styles.toolbarFilterWrap}>
                          <DropdownPanel
                            label={t("vault.list.sort.title")}
                            align="right"
                            minWidth={240}
                            trigger={
                              <Pressable
                                style={({ pressed }) => [
                                  styles.headerChromeBtn,
                                  {
                                    borderColor: colors.outlineVariant,
                                    backgroundColor: pressed
                                      ? colors.surfaceContainerHigh
                                      : "transparent",
                                  },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`${t("vault.list.sort.title")}: ${t(`vault.list.sort.mode.${sortMode}` as I18nKey)}, ${t(`vault.list.sort.direction.${sortDirection}` as I18nKey)}`}
                              >
                                <View style={styles.sortTriggerIcons}>
                                  <Icon
                                    name={SORT_MODE_ICON[sortMode]}
                                    size={18}
                                    color={colors.onSurface}
                                  />
                                  <View style={styles.sortTriggerArrow}>
                                    <Icon
                                      name={SORT_DIRECTION_ICON[sortDirection]}
                                      size={12}
                                      color={colors.onSurfaceVariant}
                                    />
                                  </View>
                                </View>
                              </Pressable>
                            }
                          >
                            <MenuGroupLabel withClose>
                              {t("vault.list.sort.by_label")}
                            </MenuGroupLabel>
                            {SORT_MODES.map((mode) => (
                              <MenuActionItem
                                key={mode}
                                icon={SORT_MODE_ICON[mode]}
                                label={t(`vault.list.sort.mode.${mode}` as I18nKey)}
                                selected={sortMode === mode}
                                onPress={() => {
                                  void patchSettings({
                                    ui: {
                                      vault_list_sort: mode,
                                      vault_list_sort_direction: sortDirection,
                                    },
                                  });
                                }}
                              />
                            ))}
                            <MenuGroupLabel>{t("vault.list.sort.direction_label")}</MenuGroupLabel>
                            {SORT_DIRS.map((direction) => (
                              <MenuActionItem
                                key={direction}
                                icon={SORT_DIRECTION_ICON[direction]}
                                label={t(`vault.list.sort.direction.${direction}` as I18nKey)}
                                selected={sortDirection === direction}
                                onPress={() => {
                                  void patchSettings({
                                    ui: {
                                      vault_list_sort: sortMode,
                                      vault_list_sort_direction: direction,
                                    },
                                  });
                                }}
                              />
                            ))}
                          </DropdownPanel>
                        </View>
                      ) : null}

                      {settings.ui.vault_list_show_view_button !== false ? (
                        <View style={styles.toolbarFilterWrap}>
                          <DropdownPanel
                            label={t("vault.list.view.title")}
                            align="right"
                            minWidth={208}
                            trigger={
                              <Pressable
                                style={({ pressed }) => [
                                  styles.headerChromeBtn,
                                  {
                                    borderColor: colors.outlineVariant,
                                    backgroundColor: pressed
                                      ? colors.surfaceContainerHigh
                                      : "transparent",
                                  },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`${t("vault.list.view.title")}: ${t(`vault.list.view.mode.${viewMode}` as I18nKey)}`}
                              >
                                <Icon
                                  name={VIEW_MODE_ICON[viewMode]}
                                  size={20}
                                  color={colors.onSurface}
                                />
                              </Pressable>
                            }
                          >
                            <MenuGroupLabel withClose>
                              {t("vault.list.view.layout_label")}
                            </MenuGroupLabel>
                            {VIEW_MODES.map((mode) => (
                              <MenuActionItem
                                key={mode}
                                icon={VIEW_MODE_ICON[mode]}
                                label={t(`vault.list.view.mode.${mode}` as I18nKey)}
                                selected={viewMode === mode}
                                onPress={() => {
                                  void patchSettings({ ui: { vault_list_view: mode } });
                                }}
                              />
                            ))}
                          </DropdownPanel>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>

                {groupsSanitizeNotice ? (
                  <View
                    style={[
                      styles.invalidBanner,
                      {
                        borderColor: colors.outlineVariant,
                        backgroundColor: colors.surfaceContainer,
                      },
                    ]}
                    accessibilityRole="text"
                  >
                    <Text style={[typography.caption, { color: colors.onSurfaceVariant, flex: 1 }]}>
                      {t("vault.group.sanitize_notice", {
                        orphans: String(groupsSanitizeNotice.orphans),
                        duplicates: String(groupsSanitizeNotice.duplicates),
                      })}
                    </Text>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={t("vault.group.dismiss")}
                      onPress={() => setGroupsSanitizeNotice(null)}
                    />
                  </View>
                ) : null}

                {groupsInvalid && !groupsInvalidDismissed ? (
                  <View
                    style={[
                      styles.invalidBanner,
                      {
                        borderColor: colors.outlineVariant,
                        backgroundColor: colors.errorContainer,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Text style={[typography.body, { color: colors.onErrorContainer }]}>
                        {t("vault.group.invalid_banner")}
                      </Text>
                      {repairBusy && repairBudget.visible ? (
                        <LoadingBudgetHint
                          budgetMs={repairBudget.budgetMs}
                          remainingMs={repairBudget.remainingMs}
                        />
                      ) : null}
                    </View>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={t("vault.group.dismiss")}
                      disabled={repairBusy}
                      onPress={() => setGroupsInvalidDismissed(true)}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      label={t("vault.group.repair")}
                      disabled={repairBusy}
                      onPress={() => {
                        if (repairBusy) return;
                        const generation = ++repairGenRef.current;
                        setRepairBusy(true);
                        void (async () => {
                          try {
                            await vaultGroupService.repair();
                            if (generation !== repairGenRef.current) return;
                            await reload();
                          } catch (error) {
                            if (generation !== repairGenRef.current) return;
                            showGroupErr(error);
                            await reload().catch(() => undefined);
                          } finally {
                            if (generation === repairGenRef.current) setRepairBusy(false);
                          }
                        })();
                      }}
                    />
                  </View>
                ) : null}
              </>
            }
            ListEmptyComponent={
              <VaultListEmptyState
                allVaultsHidden={allVaultsHidden}
                searchNoMatches={searchNoMatches}
                onCreateFromScratch={() =>
                  openCreate(createDraftForScratchSource(existingOrders), "source")
                }
                onImportPackage={() =>
                  openCreate(createDraftForImportSource(existingOrders), "source")
                }
              />
            }
          />
        </View>
      </CenteredPanel>

      <StickyAppHeader
        insetTop={insets.top}
        background={colors.background}
        onHeight={(height) => {
          setMeasuredHeaderHeight((current) => (current === height ? current : height));
        }}
      >
        <View style={styles.headerInner}>
          <UprivWordmark height={24} style={styles.brand} />
          <View style={styles.headerActions}>
            {showHeaderMore ? (
              <DropdownPanel
                label={t("app.menu.more")}
                heading={t("app.menu.more")}
                align="right"
                minWidth={220}
                trigger={
                  <IconButton
                    label={t("app.menu.more")}
                    icon="more-vertical"
                    size={20}
                    style={[styles.headerChromeBtn, { borderColor: colors.outlineVariant }]}
                  />
                }
              >
                <MenuActionItem
                  icon="refresh"
                  label={t("action.refresh")}
                  disabled={refreshing}
                  onPress={() => void reload()}
                />
                <MenuActionItem
                  icon="terminal"
                  label={t("app.menu.view_logs")}
                  onPress={() => setLogsOpen(true)}
                />
                <MenuActionItem
                  icon="help"
                  label={t("app.menu.help")}
                  onPress={() => setHelpOpen(true)}
                />
                <MenuActionItem
                  icon="info"
                  label={t("app.menu.system_info")}
                  onPress={() => setSystemInfoOpen(true)}
                />
              </DropdownPanel>
            ) : null}
            <DropdownPanel
              label={t("action.settings")}
              heading={t("action.settings")}
              align="right"
              minWidth={220}
              trigger={
                <IconButton
                  label={t("action.settings")}
                  icon="settings"
                  size={18}
                  style={[styles.headerChromeBtn, { borderColor: colors.outlineVariant }]}
                />
              }
            >
              <MenuActionItem
                icon="settings"
                label={t("app.menu.system_settings")}
                onPress={() => {
                  if (dataFolderDirty || groupsDirty) {
                    show(
                      t(
                        groupsDirty
                          ? "toast.groups_surface_blocked_dirty"
                          : "toast.data_folder_blocked_dirty",
                      ),
                    );
                    return;
                  }
                  setDataFolderOpen(false);
                  setGroupsOpen(false);
                  setSettingsOpen(true);
                }}
              />
              <MenuActionItem
                icon="layers"
                label={t("app.menu.groups")}
                onPress={() => {
                  if (settingsDirty || dataFolderDirty) {
                    show(
                      t(
                        dataFolderDirty
                          ? "toast.data_folder_blocked_dirty"
                          : "toast.settings_surface_blocked_dirty",
                      ),
                    );
                    return;
                  }
                  setSettingsOpen(false);
                  setDataFolderOpen(false);
                  setGroupsOpen(true);
                }}
              />
              <MenuActionItem
                icon="folder"
                label={t("app.menu.data_folder")}
                onPress={() => {
                  if (settingsDirty || groupsDirty) {
                    show(
                      t(
                        groupsDirty
                          ? "toast.groups_surface_blocked_dirty"
                          : "toast.settings_surface_blocked_dirty",
                      ),
                    );
                    return;
                  }
                  setSettingsOpen(false);
                  setGroupsOpen(false);
                  setDataFolderOpen(true);
                }}
              />
            </DropdownPanel>
          </View>
        </View>
      </StickyAppHeader>

      <VaultNoteModal
        vault={noteVault}
        open={noteVaultId !== null}
        onClose={() => setNoteVaultId(null)}
        onNoteChange={handleNoteChange}
      />

      <WorkspaceSetupModal
        open={lifecycle.workspaceSetupOpen}
        vaultRootPath={lifecycle.workspaceSetupRootPath}
        onCancel={lifecycle.handleWorkspaceSetupCancel}
        onConfigured={lifecycle.handleWorkspaceSetupConfigured}
      />

      <VaultLifecycleModal
        vault={lifecycle.lifecycleVault}
        intent={lifecycle.lifecycleIntent}
        open={lifecycleRequest !== null}
        submitting={lifecycle.credentialBusy}
        pipelineStep={lifecycle.credentialPipelineStep}
        budgetStartedAt={
          lifecycle.activePipelineVaultId === lifecycle.lifecycleVault?.id
            ? (lifecycle.activePipelineStartedAt ?? undefined)
            : undefined
        }
        verifyErrorKey={lifecycle.credentialErrorKey}
        initialPassword={lifecycle.credentialFieldPassword}
        onClose={lifecycle.cancelLifecycle}
        onConfirm={lifecycle.confirmLifecycle}
      />

      <VaultRecoveryModal
        vault={lifecycle.recoveryVault}
        open={lifecycle.recoveryOpen}
        submitting={lifecycle.recoverySubmitting}
        onClose={lifecycle.cancelRecovery}
        onAction={lifecycle.handleRecoveryAction}
      />

      <VaultSettingsModal
        vault={settingsVault}
        area={settingsArea}
        open={settingsVault !== null && settingsArea !== null}
        onClose={() => {
          setSettingsVault(null);
          setSettingsArea(null);
        }}
        pipelineListStatus={pipelineStatus}
        showToast={show}
        groups={groups}
        onCommitGroupAssignment={handleCommitGroupAssignment}
        onVaultDelete={(vaultId) => {
          void handleVaultDelete(vaultId);
        }}
        onPersistBusyChange={handlePersistBusyChange}
        onSaved={handleVaultSettingsSaved}
      />

      <ExportVaultModal
        vault={exportVault}
        open={exportVault !== null}
        submitting={exportSubmitting}
        onClose={() => {
          if (exportSubmitting) return;
          setExportVault(null);
        }}
        onConfirm={handleConfirmExportVault}
        onTimeout={handleExportTimeout}
        onSettingsLoadError={(error) => {
          show(t(mobileErrorI18nKey(error, "error.unexpected")));
        }}
      />

      <Modal
        open={settingsGroup !== null}
        title={t("vault.group.settings.title")}
        titleIcon="layers"
        contextTitle={settingsGroup?.displayName}
        onClose={() => {
          setSettingsGroup(null);
          setGroupDeleteOpen(false);
          setGroupFormError(null);
        }}
        footer={
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.cancel")}
              variant="ghost"
              disabled={groupBusy}
              onPress={() => {
                setSettingsGroup(null);
                setGroupDeleteOpen(false);
                setGroupFormError(null);
              }}
            />
            <Button
              label={t("vault.group.settings.save")}
              variant="primary"
              disabled={groupBusy}
              onPress={() => {
                if (!settingsGroup || groupBusy) return;
                const name = normalizeStoredName(groupDraftName);
                const validation = validateDisplayName(name);
                if (validation) {
                  setGroupFormError(displayNameMessage(validation));
                  return;
                }
                void runWithGroupBusy(async (generation) => {
                  await vaultGroupService.update({
                    id: settingsGroup.id,
                    displayName: name,
                    order: groupDraftOrder,
                    groupedVaults: groupDraftGroupedVaults,
                    groupedVaultSort: groupDraftGroupedVaultSort,
                    groupedVaultSortDirection: groupDraftGroupedVaultSortDirection,
                    hidden: groupDraftHidden,
                  });
                  await applyListedIfCurrent(generation);
                  if (generation !== groupBusyGenRef.current) return;
                  setSettingsGroup(null);
                  setGroupDeleteOpen(false);
                }).catch(() => undefined);
              }}
            />
          </ModalFooterActions>
        }
      >
        <View style={{ gap: spacing.sm }}>
          {groupBusy && groupBudget.visible ? (
            <LoadingBudgetHint
              budgetMs={groupBudget.budgetMs}
              remainingMs={groupBudget.remainingMs}
            />
          ) : null}
          <SettingsAccordionSection title={t("vault.group.settings.section_general")} defaultOpen>
            <FieldLabel>{t("vault.group.settings.rename")}</FieldLabel>
            <ThemedInput
              value={groupDraftName}
              maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
              autoCorrect={false}
              spellCheck={false}
              onChangeText={(value) => {
                setGroupDraftName(value);
                setGroupFormError(null);
              }}
              style={styles.groupInput}
            />
            <DisplayNameFieldError name={groupDraftName} />
            {groupFormError ? (
              <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                {groupFormError}
              </Text>
            ) : null}
            <FieldLabel>{t("vault.group.settings.order")}</FieldLabel>
            <FieldHint>{t("vault.group.settings.order_help")}</FieldHint>
            <ThemedInput
              value={String(groupDraftOrder)}
              keyboardType="number-pad"
              onChangeText={(raw) => {
                setGroupDraftOrder(Math.max(0, Number.parseInt(raw, 10) || 0));
                setGroupFormError(null);
              }}
              mono
              style={styles.groupInput}
            />
            <FieldLabel>{t("vault.list.sort.by_label")}</FieldLabel>
            <FieldHint>{t("vault.group.settings.grouped_vault_sort_help")}</FieldHint>
            <RadioGroup>
              {GROUPED_VAULT_SORT_MODES.map((mode) => (
                <PolicyRadioOption
                  key={mode}
                  value={mode}
                  checked={groupDraftGroupedVaultSort === mode}
                  title={t(`vault.list.sort.mode.${mode}` as I18nKey)}
                  icon={
                    <Icon name={SORT_MODE_ICON[mode]} size={18} color={colors.onSurfaceVariant} />
                  }
                  badge={mode === "order" ? "default" : undefined}
                  onSelect={() => setGroupDraftGroupedVaultSort(mode)}
                />
              ))}
            </RadioGroup>
            <FieldLabel>{t("vault.list.sort.direction_label")}</FieldLabel>
            <RadioGroup>
              {SORT_DIRS.map((direction) => (
                <PolicyRadioOption
                  key={direction}
                  value={direction}
                  checked={groupDraftGroupedVaultSortDirection === direction}
                  title={t(`vault.list.sort.direction.${direction}` as I18nKey)}
                  icon={
                    <Icon
                      name={SORT_DIRECTION_ICON[direction]}
                      size={18}
                      color={colors.onSurfaceVariant}
                    />
                  }
                  badge={direction === "asc" ? "default" : undefined}
                  onSelect={() => setGroupDraftGroupedVaultSortDirection(direction)}
                />
              ))}
            </RadioGroup>
            <SwitchRow
              label={t("vault.group.settings.hidden")}
              hint={t("vault.group.settings.hidden_help")}
              value={groupDraftHidden}
              onValueChange={setGroupDraftHidden}
              disabled={groupBusy}
            />
          </SettingsAccordionSection>

          <SettingsAccordionSection title={t("vault.group.settings.section_vaults")}>
            <Text style={typography.caption}>{t("vault.group.settings.grouped_vaults_help")}</Text>
            <GroupedVaultPicker
              vaults={visibleVaults}
              groups={groups}
              excludeGroupId={settingsGroup?.id}
              includeHidden={showHidden}
              selectedIds={groupDraftGroupedVaults}
              onToggle={(vaultId) => {
                setGroupDraftGroupedVaults((prev) =>
                  prev.includes(vaultId) ? prev.filter((id) => id !== vaultId) : [...prev, vaultId],
                );
              }}
            />
          </SettingsAccordionSection>

          <SettingsAccordionSection
            title={t("modal.settings.danger_zone")}
            tone="danger"
            defaultOpen={groupDeleteOpen}
          >
            <Text style={typography.caption}>{t("vault.group.settings.delete_help")}</Text>
            {!groupDeleteOpen ? (
              <Button
                label={t("vault.group.settings.delete")}
                variant="danger"
                onPress={() => {
                  setGroupDeleteOpen(true);
                }}
              />
            ) : (
              <View>
                <Text style={typography.caption}>{t("vault.group.settings.delete_confirm")}</Text>
                <ModalFooterActions layout="dialog" style={{ marginTop: spacing.sm }}>
                  <Button
                    label={t("action.cancel")}
                    variant="ghost"
                    onPress={() => {
                      setGroupDeleteOpen(false);
                    }}
                  />
                  <Button
                    label={t("action.delete")}
                    variant="danger"
                    disabled={!settingsGroup}
                    onPress={() => {
                      if (!settingsGroup || groupBusy) return;
                      void runWithGroupBusy(async (generation) => {
                        await vaultGroupService.delete(settingsGroup.id);
                        await applyListedIfCurrent(generation);
                        if (generation !== groupBusyGenRef.current) return;
                        setSettingsGroup(null);
                        setGroupDeleteOpen(false);
                      }).catch(() => undefined);
                    }}
                  />
                </ModalFooterActions>
              </View>
            )}
          </SettingsAccordionSection>
        </View>
      </Modal>

      <VaultBackupsModal
        vault={backupsVault}
        open={backupsVault !== null}
        onClose={() => setBackupsVault(null)}
        onCreateVaultFromBackup={(stamp) => {
          if (!backupsVault) return;
          const sourceId = backupsVault.id;
          setBackupsVault(null);
          openCreate(createDraftFromBackup(stamp, sourceId, existingOrders), "source");
        }}
      />

      <FileManagerLayer />

      <AppSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDirtyChange={setSettingsDirty}
        hasOpenVault={!appConfigEditAllowed("workspace.path", vaults, pipelineStatus)}
      />
      <VaultGroupsModal
        open={groupsOpen}
        vaults={visibleVaults}
        groups={groups}
        includeHidden={showHidden}
        onCreateGroup={handleCreateGroup}
        onClose={() => setGroupsOpen(false)}
        onDirtyChange={setGroupsDirty}
      />
      <VaultRootDataFolderModal
        open={dataFolderOpen}
        onClose={() => setDataFolderOpen(false)}
        onDirtyChange={setDataFolderDirty}
        vaultActivityBlocksChange={!appConfigEditAllowed("data_folder", vaults, pipelineStatus)}
      />
      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SystemInfoModal
        open={systemInfoOpen}
        onClose={() => setSystemInfoOpen(false)}
        vaults={vaults}
        groups={groups}
      />
      <VaultInfoModal
        vault={vaultInfoVault}
        open={vaultInfoVaultId !== null}
        onClose={() => setVaultInfoVaultId(null)}
        groups={groups}
        pipelineListStatus={pipelineStatus}
      />
      <CreateVaultModal
        open={createOpen}
        onClose={closeCreate}
        existingVaultIds={existingVaultIds}
        existingOrders={existingOrders}
        groups={groups}
        initialDraft={createDraft}
        initialStep={createStep}
        onCreate={handleCreateVault}
      />

      <Toast message={message} onDismiss={dismiss} />

      {draggingId && dragPointer ? (
        <View pointerEvents="none" style={styles.dragOverlay}>
          <View
            style={[
              styles.dragChip,
              {
                left: dragPointer.x - 72,
                top: dragPointer.y - 22,
                backgroundColor: colors.surfaceContainerHighest,
                borderColor: dropOverBlocked
                  ? hexWithAlpha(colors.vaultStatusRecovery, 0.4)
                  : hexWithAlpha(colors.accent, 0.4),
              },
            ]}
          >
            <Icon name="grip-vertical" size={16} color={colors.onSurfaceVariant} />
            <Text style={[typography.body, styles.dragChipText]} numberOfLines={1}>
              {dragChipLabel}
            </Text>
          </View>
        </View>
      ) : null}

      {groupBusy && groupBudget.visible && settingsGroup === null ? (
        <View pointerEvents="none" style={styles.busyHint}>
          <LoadingBudgetHint
            budgetMs={groupBudget.budgetMs}
            remainingMs={groupBudget.remainingMs}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /** After the list in the tree so it covers rows without Android `elevation` (that draws a seam). */
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  /** Desktop `VaultListHeader` inner column. */
  headerInner: {
    width: "100%",
    maxWidth: MAX_WIDTH_VAULT_LIST,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: PAGE_PAD_H,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  brand: { flexShrink: 0, marginRight: spacing.sm },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  /**
   * Secondary chrome — desktop `h-10` + bordered IconButton.
   * Exact `height` so gear / ⋮ match toolbar sort/view.
   */
  headerChromeBtn: {
    width: CONTROL_WIDTH_CHROME,
    height: CONTROL_HEIGHT_MD,
    minWidth: CONTROL_WIDTH_CHROME,
    minHeight: CONTROL_HEIGHT_MD,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 0,
    padding: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    height: CONTROL_HEIGHT_MD,
    marginBottom: spacing.xl,
    overflow: "hidden",
  },
  toolbarTitleRow: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    minHeight: CONTROL_HEIGHT_MD,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  toolbarTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  toolbarFilterWrap: {
    flexShrink: 0,
  },
  sortTriggerIcons: {
    flexDirection: "row",
    alignItems: "center",
  },
  sortTriggerArrow: {
    marginLeft: -7,
  },
  toolbarFilters: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: CONTROL_HEIGHT_MD,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  toolbarIconBtn: {
    width: CONTROL_HEIGHT_MD,
    height: CONTROL_HEIGHT_MD,
    minWidth: CONTROL_HEIGHT_MD,
    minHeight: CONTROL_HEIGHT_MD,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  list: {
    gap: spacing.sm,
    overflow: "visible",
  },
  listHost: { flex: 1, overflow: "visible" },
  /** Fill leftover space; do not center — that drops the vaults header. */
  listEmpty: { flexGrow: 1 },
  invalidBanner: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowPress: {
    flex: 1,
    minWidth: 0,
    minHeight: touchMin,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  groupBox: {
    position: "relative",
    alignSelf: "stretch",
    width: "100%",
    minWidth: 0,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    overflow: "visible",
  },
  groupBoxInCell: {
    marginBottom: 0,
    width: "100%",
    flex: 1,
    minWidth: 0,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "transparent",
  },
  groupHeaderSide: {
    justifyContent: "center",
  },
  groupChevronWrap: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  groupGroupedVaults: {
    minWidth: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
    gap: spacing.md,
  },
  ungroupDrop: {
    width: "100%",
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  ungroupDropLabel: {
    textAlign: "center",
  },
  ungroupDropFullWidth: {
    width: "100%",
  },
  dragOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  dragChip: {
    position: "absolute",
    maxWidth: 220,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  dragChipText: {
    flexShrink: 1,
    fontWeight: "600",
  },
  busyHint: {
    position: "absolute",
    left: PAGE_PAD_H,
    right: PAGE_PAD_H,
    bottom: spacing.lg,
    zIndex: 30,
  },
  groupInput: {
    marginTop: spacing.sm,
  },
  memberPick: { paddingVertical: spacing.sm },
  blockRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  blockCellFill: { flex: 1, minWidth: 0 },
  rowText: { flex: 1, gap: 4, minWidth: 0 },
  groupTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  groupTitle: { flexShrink: 1, minWidth: 0 },
  rowTitle: { fontWeight: "600" },
});
