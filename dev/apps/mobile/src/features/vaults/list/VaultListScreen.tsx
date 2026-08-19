import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  applyVaultListHierarchySort,
  canReorderGroupedVaults,
  canReorderVaultList,
  createDraftForImportSource,
  createDraftForScratchSource,
  displayNameErrorI18nKey,
  displayNameToGroupId,
  filterVisibleVaults,
  groupedVaultSortOf,
  isRpcError,
  isVaultFileManagerEligible,
  isVaultRootErrorCode,
  LOADING_BUDGET_MS,
  normalizeVaultGroup,
  reorderGroupedVaults,
  reorderRootRows,
  resolveVaultCanSeal,
  resolveVaultListStatus,
  storageModeHasPortableArchive,
  RpcError,
  shouldRecordVaultHidden,
  validateDisplayName,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_ERROR_CODES,
  GROUPED_VAULT_SORT_MODES,
  type CreateVaultDraft,
  type CreateVaultGroupAssignment,
  type CreateVaultResult,
  type CreateVaultStepId,
  type VaultGroup,
  type GroupedVaultSortMode,
  type VaultLifecycleRequest,
  type VaultListItem,
  type VaultListRootRow,
  type VaultListSortDirection,
  type VaultListSortMode,
  type VaultListViewMode,
  type VaultPersistence,
  type VaultSession,
} from "@upriv/shared";
import { useLogService, useVaultGroupService, useVaultService } from "@/platform/services";
import { registerMockVaultId } from "@/platform/mocks/data/vaults";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useLoadingBudget } from "@/hooks/useLoadingBudget";
import { useToast } from "@/hooks/useToast";
import { useTheme } from "@/theme";
import { radii, spacing, touchMin } from "@/theme/tokens";
import { AppSettingsModal } from "@/features/system/settings/AppSettingsModal";
import { VaultRootDataFolderModal } from "@/features/system/settings/VaultRootDataFolderModal";
import { LogsModal } from "@/features/system/logs/LogsModal";
import { HelpModal } from "@/features/system/help/HelpModal";
import { CreateVaultModal } from "@/features/vaults/create/CreateVaultModal";
import { GroupedVaultPicker } from "@/features/vaults/list/GroupedVaultPicker";
import {
  VaultLifecycleModal,
  VaultPipelineOverlay,
  useVaultLifecycle,
} from "@/features/vaults/lifecycle";
import { VaultSettingsModal } from "@/features/vaults/settings/VaultSettingsModal";
import { VaultBackupsModal } from "@/features/vaults/backups/VaultBackupsModal";
import { FileManagerScreen } from "@/features/vaults/file-manager/FileManagerScreen";
import { UprivWordmark } from "@/components/brand/UprivWordmark";
import { CenteredPanel } from "@/components/layout/CenteredPanel";
import {
  Button,
  DropdownPanel,
  IconButton,
  LoadingBudgetHint,
  MenuActionItem,
  Modal,
  Toast,
} from "@/components/ui";
import { SettingsAccordionSection } from "@/components/settings";
import { Icon } from "@/components/icons";
import { CONTROL_HEIGHT_MD, MAX_WIDTH_VAULT_LIST } from "@/theme/tokens";
import { SORT_DIRECTION_ICON, SORT_MODE_ICON, VIEW_MODE_ICON } from "./vaultListToolbarIcons";
import { VaultListEmptyState } from "./VaultListEmptyState";
import { VaultDragHandle } from "./VaultDragHandle";

const SORT_MODES: VaultListSortMode[] = ["order", "name", "state", "last_accessed", "groups"];
const SORT_DIRS: VaultListSortDirection[] = ["asc", "desc"];
const VIEW_MODES: VaultListViewMode[] = ["default", "large", "compact", "blocks"];

type FlatHierarchyRow =
  | {
      key: string;
      kind: "group_block";
      group: VaultGroup;
      groupedVaults: VaultListItem[];
      visibleVaultCount: number;
    }
  | { key: string; kind: "vault"; vault: VaultListItem };

function flattenHierarchyRows(rows: VaultListRootRow[]): FlatHierarchyRow[] {
  const out: FlatHierarchyRow[] = [];
  for (const row of rows) {
    if (row.kind === "vault") {
      out.push({ key: `vault:${row.vault.id}`, kind: "vault", vault: row.vault });
      continue;
    }
    out.push({
      key: `group:${row.group.id}`,
      kind: "group_block",
      group: row.group,
      groupedVaults: row.group.collapsed ? [] : row.groupedVaults,
      visibleVaultCount: row.groupedVaults.length,
    });
  }
  return out;
}

function flattenVaultsForBlocks(rows: VaultListRootRow[]): FlatHierarchyRow[] {
  const out: FlatHierarchyRow[] = [];
  for (const row of rows) {
    if (row.kind === "vault") {
      out.push({ key: `vault:${row.vault.id}`, kind: "vault", vault: row.vault });
      continue;
    }
    for (const vault of row.groupedVaults) {
      out.push({ key: `member:${row.group.id}:${vault.id}`, kind: "vault", vault });
    }
  }
  return out;
}

export function VaultListScreen() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultService = useVaultService();
  const vaultGroupService = useVaultGroupService();
  const logService = useLogService();
  const { settings, patchSettings, showHiddenVaultsSession, reportVaultRootIntegrityFailure } =
    useAppSettingsContext();
  const insets = useSafeAreaInsets();
  const { message, show, dismiss } = useToast();

  const [vaults, setVaults] = useState<VaultListItem[]>([]);
  const [groups, setGroups] = useState<VaultGroup[]>([]);
  const [groupsInvalid, setGroupsInvalid] = useState(false);
  const [groupsInvalidDismissed, setGroupsInvalidDismissed] = useState(false);
  const [groupsSanitizeNotice, setGroupsSanitizeNotice] = useState<{
    orphans: number;
    duplicates: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataFolderOpen, setDataFolderOpen] = useState(false);
  const [dataFolderDirty, setDataFolderDirty] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateVaultDraft | null>(null);
  const [createStep, setCreateStep] = useState<CreateVaultStepId | null>(null);
  const [settingsGroup, setSettingsGroup] = useState<VaultGroup | null>(null);
  const settingsGroupOpenRef = useRef(false);
  settingsGroupOpenRef.current = settingsGroup !== null;
  const [groupDraftName, setGroupDraftName] = useState("");
  const [groupDraftOrder, setGroupDraftOrder] = useState(0);
  const [groupDraftGroupedVaults, setGroupDraftGroupedVaults] = useState<string[]>([]);
  const [groupDraftGroupedVaultSort, setGroupDraftGroupedVaultSort] =
    useState<GroupedVaultSortMode>("order");
  const [groupDraftGroupedVaultSortDirection, setGroupDraftGroupedVaultSortDirection] =
    useState<VaultListSortDirection>("asc");
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false);
  const [groupFormError, setGroupFormError] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const groupBusyGenRef = useRef(0);
  const repairGenRef = useRef(0);
  const groupBudget = useLoadingBudget(groupBusy, LOADING_BUDGET_MS.default);
  const repairBudget = useLoadingBudget(repairBusy, LOADING_BUDGET_MS.default);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const dropViewsRef = useRef(new Map<string, View>());
  const dropRectsRef = useRef(new Map<string, { x: number; y: number; w: number; h: number }>());
  const [actionsVault, setActionsVault] = useState<VaultListItem | null>(null);
  const [lifecycleRequest, setLifecycleRequest] = useState<VaultLifecycleRequest | null>(null);
  const [settingsVault, setSettingsVault] = useState<VaultListItem | null>(null);
  const [groupAssignmentVault, setGroupAssignmentVault] = useState<VaultListItem | null>(null);
  const [backupsVault, setBackupsVault] = useState<VaultListItem | null>(null);
  const [fmVault, setFmVault] = useState<VaultListItem | null>(null);

  const sortMode = settings.ui.vault_list_sort;
  const sortDirection = settings.ui.vault_list_sort_direction;
  const viewMode = settings.ui.vault_list_view;
  const showHidden = settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const allowDragVaultIntoGroup = settings.ui.allow_drag_vault_into_group !== false;
  const canReorder = canReorderVaultList({ mode: sortMode, direction: sortDirection });

  const existingVaultIds = useMemo(() => vaults.map((vault) => vault.id), [vaults]);
  const existingOrders = useMemo(() => vaults.map((vault) => vault.order ?? 0), [vaults]);

  const displayRows = useMemo(() => {
    return applyVaultListHierarchySort(
      vaults,
      groups,
      {
        mode: sortMode,
        direction: sortDirection,
      },
      { showHiddenVaults: showHidden },
    );
  }, [vaults, groups, showHidden, sortMode, sortDirection]);

  const flatRows = useMemo(() => flattenHierarchyRows(displayRows), [displayRows]);

  const allVaultsHidden = false;
  const visibleVaults = useMemo(
    () => filterVisibleVaults(vaults, showHidden),
    [showHidden, vaults],
  );

  const setVaultRuntimeState = useCallback(
    (
      vaultId: string,
      patch: {
        session: VaultSession | null;
        persistence?: VaultPersistence;
        canSeal?: boolean;
        lastAccessedAt?: string;
        lastAccessedWhen?: string;
      },
    ) => {
      setVaults((prev) =>
        prev.map((vault) => (vault.id === vaultId ? { ...vault, ...patch } : vault)),
      );
    },
    [],
  );

  const lifecycle = useVaultLifecycle({
    vaults,
    setVaultRuntimeState,
    lifecycleRequest,
    setLifecycleRequest,
    showToast: show,
    dismissToast: dismiss,
  });

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const [list, groupResult] = await Promise.all([
        vaultService.listVaults(),
        vaultGroupService.list(),
      ]);
      setVaults(list);
      if (settingsGroupOpenRef.current) {
        show(t("toast.groups_refresh_blocked_settings"));
      } else {
        setGroups(
          groupResult.groups.map((g) =>
            normalizeVaultGroup({ ...g, groupedVaults: [...g.groupedVaults] }),
          ),
        );
        setGroupsInvalid(groupResult.invalid);
        if (!groupResult.invalid) setGroupsInvalidDismissed(false);
        const orphans = groupResult.droppedOrphans ?? 0;
        const duplicates = groupResult.droppedDuplicateAssignments ?? 0;
        if (orphans > 0 || duplicates > 0) {
          setGroupsSanitizeNotice({ orphans, duplicates });
        } else {
          setGroupsSanitizeNotice(null);
        }
      }
    } catch (error) {
      show(t(mobileErrorI18nKey(error, "toast.refresh_failed")));
      if (isRpcError(error) && isVaultRootErrorCode(error.code)) {
        void reportVaultRootIntegrityFailure(error);
      }
    } finally {
      setRefreshing(false);
    }
  }, [reportVaultRootIntegrityFailure, show, t, vaultGroupService, vaultService]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = useCallback(
    (draft: CreateVaultDraft | null = null, step: CreateVaultStepId | null = null) => {
      setCreateDraft(draft);
      setCreateStep(step);
      setCreateOpen(true);
    },
    [],
  );

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateDraft(null);
    setCreateStep(null);
  }, []);

  const pipelineStatus = useMemo(
    () => ({
      openingVaultIds: [...lifecycle.openingVaultIds],
      closingVaultIds: [...lifecycle.closingVaultIds],
    }),
    [lifecycle.closingVaultIds, lifecycle.openingVaultIds],
  );

  const statusColor = useCallback(
    (status: string): string => {
      if (status === "open" || status === "opening") return colors.vaultStatusOpen;
      if (status === "sealed" || status === "sealing") return colors.vaultStatusSealed;
      return colors.vaultStatusClosed;
    },
    [colors],
  );

  const rowPadding =
    viewMode === "large" ? spacing.xl : viewMode === "compact" ? spacing.md : spacing.lg;
  const listData = viewMode === "blocks" ? flattenVaultsForBlocks(displayRows) : flatRows;
  const numColumns = viewMode === "blocks" ? 2 : 1;

  const displayNameMessage = (code: ReturnType<typeof validateDisplayName>) => {
    if (!code) return null;
    return t(
      displayNameErrorI18nKey(code),
      code === "too_long" ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) } : undefined,
    );
  };

  const applyListedGroups = (listed: {
    groups: VaultGroup[];
    invalid: boolean;
    droppedOrphans?: number;
    droppedDuplicateAssignments?: number;
  }) => {
    setGroups(
      listed.groups.map((g) => normalizeVaultGroup({ ...g, groupedVaults: [...g.groupedVaults] })),
    );
    setGroupsInvalid(listed.invalid);
    if (!listed.invalid) setGroupsInvalidDismissed(false);
    const orphans = listed.droppedOrphans ?? 0;
    const duplicates = listed.droppedDuplicateAssignments ?? 0;
    if (orphans > 0 || duplicates > 0) {
      setGroupsSanitizeNotice({ orphans, duplicates });
    } else {
      setGroupsSanitizeNotice(null);
    }
  };

  const showGroupErr = (error: unknown) => {
    const message = t(mobileErrorI18nKey(error));
    setGroupFormError(message);
    show(message);
  };

  const runWithGroupBusy = async (work: (generation: number) => Promise<void>) => {
    const generation = ++groupBusyGenRef.current;
    setGroupBusy(true);
    setGroupFormError(null);
    try {
      await work(generation);
    } catch (error) {
      if (generation !== groupBusyGenRef.current) return;
      showGroupErr(error);
      await reload().catch(() => undefined);
    } finally {
      if (generation === groupBusyGenRef.current) setGroupBusy(false);
    }
  };

  const applyVaultGroupMembership = async (vaultId: string, groupId: string | null) => {
    const currentGroup = groups.find((g) => g.groupedVaults.includes(vaultId)) ?? null;
    if ((currentGroup?.id ?? null) === groupId) return;
    if (groupId) {
      const target = groups.find((g) => g.id === groupId);
      if (!target) {
        throw new RpcError(
          VAULT_ERROR_CODES.GROUP_NOT_FOUND,
          `group not found: ${groupId}`,
        );
      }
      await vaultGroupService.update({
        id: groupId,
        groupedVaults: [...target.groupedVaults.filter((id) => id !== vaultId), vaultId],
      });
    } else if (currentGroup) {
      await vaultGroupService.update({
        id: currentGroup.id,
        groupedVaults: currentGroup.groupedVaults.filter((id) => id !== vaultId),
      });
    }
    applyListedGroups(await vaultGroupService.list());
  };

  const assignVaultToGroup = async (vaultId: string, groupId: string | null) => {
    const currentGroup = groups.find((g) => g.groupedVaults.includes(vaultId)) ?? null;
    if ((currentGroup?.id ?? null) === groupId) {
      setGroupAssignmentVault(null);
      return;
    }
    await runWithGroupBusy(async (generation) => {
      await applyVaultGroupMembership(vaultId, groupId);
      if (generation !== groupBusyGenRef.current) return;
      setGroupAssignmentVault(null);
    });
  };

  const handleCreateGroup = async (displayName: string, groupedVaultIds: string[] = []) => {
    const id = displayNameToGroupId(
      displayName,
      groups.map((g) => g.id),
    );
    await vaultGroupService.create({
      id,
      displayName,
      groupedVaults: [...groupedVaultIds],
    });
    applyListedGroups(await vaultGroupService.list());
  };

  const handleCommitGroupAssignment = async (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => {
    if (assignment.kind === "create") {
      await handleCreateGroup(assignment.displayName, [vaultId]);
      return;
    }
    await applyVaultGroupMembership(
      vaultId,
      assignment.kind === "existing" ? assignment.groupId : null,
    );
  };

  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const displayRowsRef = useRef(displayRows);
  displayRowsRef.current = displayRows;

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

  const refreshDropRects = () => {
    dropViewsRef.current.forEach((view, key) => {
      view.measureInWindow((x, y, w, h) => {
        dropRectsRef.current.set(key, { x, y, w, h });
      });
    });
  };

  const hitDropKey = (pageX: number, pageY: number): string | null => {
    const source = draggingIdRef.current;
    let bestKey: string | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    dropRectsRef.current.forEach((rect, key) => {
      if (key === source) return;
      if (
        pageX >= rect.x &&
        pageX <= rect.x + rect.w &&
        pageY >= rect.y &&
        pageY <= rect.y + rect.h
      ) {
        const area = rect.w * rect.h;
        if (area < bestArea) {
          bestArea = area;
          bestKey = key;
        }
      }
    });
    return bestKey;
  };

  const isUngroupDropKey = (key: string | null) =>
    Boolean(key && (key === "list:ungroup" || key.startsWith("list:ungroup:")));

  const clearDrag = () => {
    draggingIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDragPointer(null);
  };

  const persistRootOrders = (nextGroups: VaultGroup[], previous: VaultGroup[]) => {
    const orders = nextGroups
      .filter((group) => previous.find((g) => g.id === group.id)?.order !== group.order)
      .map((group) => ({ id: group.id, order: group.order }));
    if (orders.length === 0) return;
    void runWithGroupBusy(async (generation) => {
      await vaultGroupService.reorder(orders);
      if (generation !== groupBusyGenRef.current) return;
      applyListedGroups(await vaultGroupService.list());
    });
  };

  const applyListDrop = (sourceKey: string, targetKey: string | null) => {
    if (!targetKey || targetKey === sourceKey) {
      clearDrag();
      return;
    }
    const sourceMember = sourceKey.startsWith("member:") ? sourceKey.split(":") : null;
    const sourceVaultId = sourceMember
      ? sourceMember[2]
      : sourceKey.startsWith("vault:")
        ? sourceKey.slice("vault:".length)
        : null;
    const sourceGroupId = sourceMember ? sourceMember[1] : null;
    const targetMember = targetKey.startsWith("member:") ? targetKey.split(":") : null;
    const targetGroupId = targetKey.startsWith("group:")
      ? targetKey.slice("group:".length)
      : targetMember
        ? targetMember[1]
        : null;

    if (sourceVaultId && targetGroupId && allowDragVaultIntoGroup) {
      if (sourceGroupId === targetGroupId && targetMember && targetMember[2]) {
        const group = groupsRef.current.find((g) => g.id === targetGroupId);
        if (group && canReorderGroupedVaults(groupedVaultSortOf(group))) {
          const nextGroup = reorderGroupedVaults(group, sourceVaultId, targetMember[2]);
          setGroups((current) => current.map((g) => (g.id === group.id ? nextGroup : g)));
          void runWithGroupBusy(async (generation) => {
            await vaultGroupService.reorderGroupedVaults(group.id, nextGroup.groupedVaults);
            if (generation !== groupBusyGenRef.current) return;
            applyListedGroups(await vaultGroupService.list());
          });
        }
        clearDrag();
        return;
      }
      if (sourceGroupId !== targetGroupId) {
        void assignVaultToGroup(sourceVaultId, targetGroupId);
        clearDrag();
        return;
      }
    }

    if (
      sourceMember &&
      sourceVaultId &&
      allowDragVaultIntoGroup &&
      (isUngroupDropKey(targetKey) || targetKey.startsWith("vault:"))
    ) {
      void assignVaultToGroup(sourceVaultId, null);
      clearDrag();
      return;
    }

    if (
      canReorder &&
      !sourceMember &&
      !targetMember &&
      !isUngroupDropKey(targetKey) &&
      (targetKey.startsWith("vault:") || targetKey.startsWith("group:"))
    ) {
      const previous = groupsRef.current;
      const nextRows = reorderRootRows(displayRowsRef.current, sourceKey, targetKey);
      const nextVaults = vaultsRef.current.map((vault) => {
        const row = nextRows.find((r) => r.kind === "vault" && r.vault.id === vault.id);
        return row && row.kind === "vault" ? { ...vault, order: row.vault.order } : vault;
      });
      const nextGroups = previous.map((group) => {
        const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
        return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
      });
      setVaults(nextVaults);
      setGroups(nextGroups);
      persistRootOrders(nextGroups, previous);
    }
    clearDrag();
  };

  const onRowDragStart = (key: string, pageX: number, pageY: number) => {
    draggingIdRef.current = key;
    setDraggingId(key);
    setDragOverId(null);
    setDragPointer({ x: pageX, y: pageY });
    refreshDropRects();
  };

  const onRowDragMove = (pageX: number, pageY: number) => {
    setDragPointer({ x: pageX, y: pageY });
    const over = hitDropKey(pageX, pageY);
    setDragOverId(over);
  };

  const onRowDragEnd = (pageX: number, pageY: number) => {
    const over = hitDropKey(pageX, pageY);
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
    const vaultId = draggingId.startsWith("member:")
      ? draggingId.split(":")[2]
      : draggingId.startsWith("vault:")
        ? draggingId.slice("vault:".length)
        : null;
    return vaultId ? (vaults.find((v) => v.id === vaultId)?.displayName ?? "") : "";
  })();
  const showUngroupInGroup = allowDragVaultIntoGroup && Boolean(draggingId?.startsWith("member:"));

  useEffect(() => {
    if (!groupBudget.timedOut || !groupBusy) return;
    groupBusyGenRef.current += 1;
    setGroupBusy(false);
    show(t("error.operation_timed_out"));
  }, [groupBudget.timedOut, groupBusy, show, t]);

  useEffect(() => {
    if (!repairBudget.timedOut || !repairBusy) return;
    repairGenRef.current += 1;
    setRepairBusy(false);
    show(t("error.operation_timed_out"));
  }, [repairBudget.timedOut, repairBusy, show, t]);

  const renderVaultRow = (
    vault: VaultListItem,
    opts?: { nested?: boolean; blocks?: boolean; group?: VaultGroup; dropKey?: string },
  ) => {
    const nested = opts?.nested === true;
    const blocks = opts?.blocks === true;
    const dropKey =
      opts?.dropKey ??
      (opts?.group ? `member:${opts.group.id}:${vault.id}` : `vault:${vault.id}`);
    const status = resolveVaultListStatus(vault, pipelineStatus);
    const dragEnabled = opts?.group
      ? canReorderGroupedVaults(groupedVaultSortOf(opts.group)) || allowDragVaultIntoGroup
      : canReorder || allowDragVaultIntoGroup;
    const isDragging = draggingId === dropKey;
    const isDragOver = dragOverId === dropKey;
    return (
      <View
        {...bindDropTarget(dropKey)}
        style={[
          styles.row,
          nested ? styles.memberRow : null,
          blocks ? styles.blockRow : null,
          {
            backgroundColor: colors.surfaceContainer,
            borderColor: isDragOver ? colors.accent : colors.outlineVariant,
            borderWidth: isDragOver ? 2 : StyleSheet.hairlineWidth,
            paddingVertical: rowPadding,
            paddingRight: rowPadding,
            paddingLeft: Math.max(rowPadding - 8, spacing.sm),
            opacity: isDragging ? 0.45 : 1,
          },
        ]}
      >
        <VaultDragHandle
          disabled={!dragEnabled || groupBusy}
          onDragStart={(x, y) => onRowDragStart(dropKey, x, y)}
          onDragMove={onRowDragMove}
          onDragEnd={onRowDragEnd}
          onDragCancel={clearDrag}
        />
        <Pressable
          style={styles.rowPress}
          onPress={() => setActionsVault(vault)}
          accessibilityRole="button"
          accessibilityLabel={vault.displayName}
        >
          <View style={[styles.dot, { backgroundColor: statusColor(status) }]} />
          <View style={styles.rowText}>
            <Text
              style={[
                typography.body,
                styles.rowTitle,
                viewMode === "large" ? { fontSize: 17 } : null,
                viewMode === "compact" ? { fontSize: 14 } : null,
              ]}
              numberOfLines={blocks ? 2 : 1}
            >
              {vault.displayName}
            </Text>
            {viewMode !== "compact" ? (
              <Text style={typography.caption} numberOfLines={blocks ? 2 : 1}>
                {t(
                  (
                    {
                      open: "vault.status.open",
                      closed: "vault.status.closed",
                      sealed: "vault.status.sealed",
                      recovery: "vault.status.recovery",
                      opening: "vault.status.opening",
                      closing: "vault.status.closing",
                    } as const
                  )[status],
                )}
                {vault.lastAccessedWhen ? ` · ${vault.lastAccessedWhen}` : ""}
                {vault.note && !blocks ? ` · ${vault.note}` : ""}
              </Text>
            ) : null}
          </View>
          <Icon name="more-horizontal" size={18} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>
    );
  };

  const toggleGroupCollapsed = (group: VaultGroup) => {
    const nextCollapsed = !group.collapsed;
    setGroups((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, collapsed: nextCollapsed } : g)),
    );
    void vaultGroupService
      .setCollapsed(group.id, nextCollapsed)
      .catch(() => {
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
    setGroupDeleteOpen(false);
    setGroupFormError(null);
  };

  const renderItem: ListRenderItem<FlatHierarchyRow> = ({ item }) => {
    if (item.kind === "group_block") {
      const groupedVaultCount = item.visibleVaultCount;
      const expanded = !item.group.collapsed;
      const groupKey = `group:${item.group.id}`;
      const isDragging = draggingId === groupKey;
      const isDragOver = dragOverId === groupKey;
      return (
        <View
          {...bindDropTarget(groupKey)}
          style={[
            styles.groupBox,
            {
              backgroundColor: expanded ? "transparent" : colors.surfaceContainer,
              borderColor: isDragOver
                ? colors.accent
                : expanded
                  ? colors.outlineVariant
                  : "transparent",
              borderWidth: isDragOver ? 2 : 1,
              opacity: isDragging ? 0.45 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.groupHeader,
              {
                paddingVertical: rowPadding,
                paddingRight: rowPadding,
                paddingLeft: Math.max(rowPadding - 8, spacing.sm),
              },
            ]}
          >
            <VaultDragHandle
              disabled={!canReorder || groupBusy}
              onDragStart={(x, y) => onRowDragStart(groupKey, x, y)}
              onDragMove={onRowDragMove}
              onDragEnd={onRowDragEnd}
              onDragCancel={clearDrag}
            />
            <Pressable
              style={styles.rowPress}
              onPress={() => toggleGroupCollapsed(item.group)}
              onLongPress={() => openGroupSettings(item.group)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={item.group.displayName}
            >
              <View
                style={[
                  styles.groupChevronWrap,
                  item.group.collapsed ? styles.groupChevronCollapsed : null,
                ]}
              >
                <Icon name="chevron-down" size={18} color={colors.onSurfaceVariant} />
              </View>
              <View style={styles.rowText}>
                <Text
                  style={[
                    typography.body,
                    styles.rowTitle,
                    viewMode === "large" ? { fontSize: 17 } : null,
                    viewMode === "compact" ? { fontSize: 14 } : null,
                  ]}
                  numberOfLines={1}
                >
                  {item.group.displayName}
                </Text>
                <Text style={typography.caption}>
                  {groupedVaultCount === 1
                    ? t("vault.group.count_one")
                    : t("vault.group.count", { count: String(groupedVaultCount) })}
                </Text>
              </View>
            </Pressable>
            <IconButton
              label={t("vault.group.open_settings")}
              icon="settings"
              size={18}
              onPress={() => openGroupSettings(item.group)}
            />
          </View>
          {expanded && (item.groupedVaults.length > 0 || showUngroupInGroup) ? (
            <View style={styles.groupGroupedVaults}>
              {item.groupedVaults.map((vault) => (
                <View key={vault.id}>
                  {renderVaultRow(vault, { nested: true, group: item.group })}
                </View>
              ))}
              {showUngroupInGroup ? (
                <View
                  {...bindDropTarget(`list:ungroup:${item.group.id}`)}
                  style={[
                    styles.ungroupDrop,
                    {
                      borderColor:
                        isUngroupDropKey(dragOverId) &&
                        dragOverId === `list:ungroup:${item.group.id}`
                          ? colors.accent
                          : colors.outlineVariant,
                      backgroundColor:
                        isUngroupDropKey(dragOverId) &&
                        dragOverId === `list:ungroup:${item.group.id}`
                          ? colors.surfaceContainerHigh
                          : "transparent",
                    },
                  ]}
                >
                  <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
                    {t("vault.group.drop_to_ungroup")}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    }

    const memberParts = item.key.startsWith("member:") ? item.key.split(":") : null;
    const memberGroup = memberParts
      ? groups.find((g) => g.id === memberParts[1])
      : undefined;
    return renderVaultRow(item.vault, {
      blocks: viewMode === "blocks",
      group: memberGroup,
      dropKey: item.key,
    });
  };

  const canSeal = actionsVault ? resolveVaultCanSeal(actionsVault) : false;
  const fmEligible = actionsVault ? isVaultFileManagerEligible(actionsVault) : false;
  const isOpen = actionsVault?.session === "open";
  const hasPortableArchive = actionsVault
    ? storageModeHasPortableArchive(actionsVault.storageMode)
    : false;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <CenteredPanel maxWidth={MAX_WIDTH_VAULT_LIST}>
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          <UprivWordmark height={20} style={styles.brand} />
          <View style={styles.headerActions}>
            <IconButton
              label={t("action.refresh")}
              onPress={() => void reload()}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator color={colors.onSurfaceVariant} />
              ) : (
                <Icon name="refresh" size={20} color={colors.onSurfaceVariant} />
              )}
            </IconButton>
            <Button
              size="md"
              variant="primary"
              icon="add"
              label={t("app.new_vault")}
              onPress={() => openCreate(null, null)}
            />
            <DropdownPanel
              label={t("app.menu.more")}
              align="right"
              minWidth={220}
              trigger={
                <IconButton
                  label={t("app.menu.more")}
                  icon="more-vertical"
                  size={20}
                  style={[styles.headerMoreBtn, { borderColor: colors.outlineVariant }]}
                />
              }
            >
              <MenuActionItem
                icon="settings"
                label={t("app.menu.system_settings")}
                onPress={() => {
                  if (dataFolderDirty || dataFolderOpen) {
                    show(t("toast.data_folder_blocked_dirty"));
                    return;
                  }
                  setSettingsOpen(true);
                }}
              />
              <MenuActionItem
                icon="folder"
                label={t("app.menu.data_folder")}
                onPress={() => setDataFolderOpen(true)}
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
            </DropdownPanel>
          </View>
        </View>

        <View style={[styles.toolbar, { backgroundColor: colors.background }]}>
          <View style={styles.toolbarTitleRow}>
            <Icon name="encrypted" size={22} color={colors.onSurfaceVariant} />
            <Text style={[typography.headline, styles.toolbarTitle]} numberOfLines={1}>
              {t("vault.list.title")}
            </Text>
          </View>
          <View style={styles.toolbarFilters}>
            <DropdownPanel
              label={t("vault.list.sort.title")}
              align="right"
              minWidth={240}
              trigger={
                <Pressable
                  style={({ pressed }) => [
                    styles.toolbarFilterBtn,
                    {
                      borderColor: colors.outlineVariant,
                      backgroundColor: pressed ? colors.surfaceContainerHigh : "transparent",
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("vault.list.sort.title")}: ${t(`vault.list.sort.mode.${sortMode}` as I18nKey)}, ${t(`vault.list.sort.direction.${sortDirection}` as I18nKey)}`}
                >
                  <Icon name={SORT_MODE_ICON[sortMode]} size={20} color={colors.onSurface} />
                  <Icon
                    name={SORT_DIRECTION_ICON[sortDirection]}
                    size={14}
                    color={colors.onSurfaceVariant}
                  />
                </Pressable>
              }
            >
              <Text style={[typography.caption, styles.menuGroupLabel]}>
                {t("vault.list.sort.by_label")}
              </Text>
              {SORT_MODES.map((mode) => (
                <MenuActionItem
                  key={mode}
                  icon={SORT_MODE_ICON[mode]}
                  label={t(`vault.list.sort.mode.${mode}` as I18nKey)}
                  selected={sortMode === mode}
                  onPress={() => {
                    void patchSettings({
                      ui: { vault_list_sort: mode, vault_list_sort_direction: sortDirection },
                    });
                  }}
                />
              ))}
              <Text style={[typography.caption, styles.menuGroupLabel, styles.sectionGap]}>
                {t("vault.list.sort.direction_label")}
              </Text>
              {SORT_DIRS.map((direction) => (
                <MenuActionItem
                  key={direction}
                  icon={SORT_DIRECTION_ICON[direction]}
                  label={t(`vault.list.sort.direction.${direction}` as I18nKey)}
                  selected={sortDirection === direction}
                  onPress={() => {
                    void patchSettings({
                      ui: { vault_list_sort: sortMode, vault_list_sort_direction: direction },
                    });
                  }}
                />
              ))}
            </DropdownPanel>

            <DropdownPanel
              label={t("vault.list.view.title")}
              align="right"
              minWidth={208}
              trigger={
                <Pressable
                  style={({ pressed }) => [
                    styles.toolbarFilterBtn,
                    {
                      borderColor: colors.outlineVariant,
                      backgroundColor: pressed ? colors.surfaceContainerHigh : "transparent",
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("vault.list.view.title")}: ${t(`vault.list.view.mode.${viewMode}` as I18nKey)}`}
                >
                  <Icon name={VIEW_MODE_ICON[viewMode]} size={20} color={colors.onSurface} />
                </Pressable>
              }
            >
              <Text style={[typography.caption, styles.menuGroupLabel]}>
                {t("vault.list.view.layout_label")}
              </Text>
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
              { borderColor: colors.outlineVariant, backgroundColor: colors.errorContainer },
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

        <FlatList
          key={`vault-list-${numColumns}`}
          data={listData}
          extraData={`${draggingId}|${dragOverId}|${groupBusy}|${viewMode}`}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? styles.blockRowWrap : undefined}
          contentContainerStyle={[styles.list, listData.length === 0 ? styles.listEmpty : null]}
          scrollEnabled={!draggingId}
          ListEmptyComponent={
            <VaultListEmptyState
              allVaultsHidden={allVaultsHidden}
              onCreateFromScratch={() =>
                openCreate(createDraftForScratchSource(existingOrders), "source")
              }
              onImportArchive={() =>
                openCreate(createDraftForImportSource(existingOrders), "source")
              }
            />
          }
        />
      </CenteredPanel>

      <Modal
        variant="menu"
        open={actionsVault !== null}
        title={actionsVault?.displayName ?? ""}
        onClose={() => setActionsVault(null)}
      >
        {actionsVault ? (
          <View style={styles.actionList}>
            {!isOpen ? (
              <MenuActionItem
                icon="lock-open"
                label={t("action.unlock")}
                onPress={() => {
                  const id = actionsVault.id;
                  setActionsVault(null);
                  lifecycle.requestLifecycle(id, "unlock");
                }}
              />
            ) : (
              <>
                <MenuActionItem
                  icon="lock"
                  label={t("action.lock")}
                  onPress={() => {
                    const id = actionsVault.id;
                    setActionsVault(null);
                    lifecycle.requestLifecycle(id, "close");
                  }}
                />
                {canSeal ? (
                  <MenuActionItem
                    icon="seal"
                    label={t("action.seal")}
                    onPress={() => {
                      const id = actionsVault.id;
                      setActionsVault(null);
                      lifecycle.requestLifecycle(id, "seal");
                    }}
                  />
                ) : null}
                {fmEligible ? (
                  <MenuActionItem
                    icon="file-manager"
                    label={t("action.open_folder")}
                    onPress={() => {
                      setFmVault(actionsVault);
                      setActionsVault(null);
                    }}
                  />
                ) : null}
              </>
            )}
            {hasPortableArchive ? (
              <MenuActionItem
                icon="archive"
                label={t("action.backups")}
                onPress={() => {
                  setBackupsVault(actionsVault);
                  setActionsVault(null);
                }}
              />
            ) : null}
            <MenuActionItem
              icon="folder"
              label={t("vault.group.assignment.menu")}
              onPress={() => {
                setGroupAssignmentVault(actionsVault);
                setActionsVault(null);
              }}
            />
            <MenuActionItem
              icon="settings"
              label={t("action.settings")}
              onPress={() => {
                setSettingsVault(actionsVault);
                setActionsVault(null);
              }}
            />
          </View>
        ) : null}
      </Modal>

      <VaultLifecycleModal
        vault={lifecycle.lifecycleVault}
        intent={lifecycle.lifecycleIntent}
        open={lifecycleRequest !== null}
        onClose={lifecycle.cancelLifecycle}
        onConfirm={lifecycle.confirmLifecycle}
      />

      {lifecycle.pipelineOverlay.open ? (
        <VaultPipelineOverlay
          vault={lifecycle.pipelineVault}
          open
          title={lifecycle.pipelineOverlay.title}
          hint={lifecycle.pipelineOverlay.hint}
          stepKeys={lifecycle.pipelineOverlay.stepKeys}
          activeStep={lifecycle.pipelineOverlay.activeStep}
          errorKey={lifecycle.pipelineOverlay.errorKey}
          onBackground={lifecycle.sendPipelineToBackground}
          onDismissError={lifecycle.dismissPipelineFailure}
        />
      ) : null}

      <VaultSettingsModal
        vault={settingsVault}
        open={settingsVault !== null}
        onClose={() => setSettingsVault(null)}
        showToast={show}
        groups={groups}
        onCommitGroupAssignment={handleCommitGroupAssignment}
        onSaved={(vaultId, patch) => {
          const previous = vaults.find((vault) => vault.id === vaultId);
          setVaults((prev) =>
            prev.map((vault) => (vault.id === vaultId ? { ...vault, ...patch } : vault)),
          );
          if (shouldRecordVaultHidden(previous?.hidden, patch.hidden)) {
            void logService.recordVaultHidden().catch(() => {
              /* Logging must never block hide. */
            });
          }
        }}
      />

      <Modal
        open={groupAssignmentVault !== null}
        title={t("vault.group.assignment.modal_title")}
        onClose={() => {
          setGroupAssignmentVault(null);
          setGroupFormError(null);
        }}
      >
        {groupAssignmentVault ? (
          <View style={styles.actionList}>
            <Text style={typography.caption}>
              {t("vault.group.assignment.for_vault", {
                name: groupAssignmentVault.displayName,
              })}
            </Text>
            {groupBusy && groupBudget.visible ? (
              <LoadingBudgetHint
                budgetMs={groupBudget.budgetMs}
                remainingMs={groupBudget.remainingMs}
              />
            ) : null}
            <MenuActionItem
              icon="close"
              label={t("vault.group.assignment.ungrouped")}
              onPress={() => {
                if (groupBusy) return;
                void assignVaultToGroup(groupAssignmentVault.id, null);
              }}
            />
            {groups.map((group) => (
              <MenuActionItem
                key={group.id}
                icon="folder"
                label={group.displayName}
                onPress={() => {
                  if (groupBusy) return;
                  void assignVaultToGroup(groupAssignmentVault.id, group.id);
                }}
              />
            ))}
            {groups.some((g) => g.groupedVaults.includes(groupAssignmentVault.id)) ? (
              <View style={[styles.modalActions, { marginTop: spacing.md, justifyContent: "flex-start" }]}>
                <Button
                  label={t("vault.group.assignment.remove")}
                  variant="ghost"
                  onPress={() => {
                    if (groupBusy) return;
                    void assignVaultToGroup(groupAssignmentVault.id, null);
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Modal>

      <Modal
        open={settingsGroup !== null}
        title={t("vault.group.settings.title")}
        onClose={() => {
          setSettingsGroup(null);
          setGroupDeleteOpen(false);
          setGroupFormError(null);
        }}
        footer={
          <View style={styles.modalActions}>
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
              variant="accent"
              disabled={groupBusy}
              onPress={() => {
                if (!settingsGroup || groupBusy) return;
                const name = groupDraftName.trim();
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
                  });
                  if (generation !== groupBusyGenRef.current) return;
                  applyListedGroups(await vaultGroupService.list());
                  setSettingsGroup(null);
                  setGroupDeleteOpen(false);
                });
              }}
            />
          </View>
        }
      >
        <View style={{ gap: spacing.sm }}>
          {groupBusy && groupBudget.visible ? (
            <LoadingBudgetHint
              budgetMs={groupBudget.budgetMs}
              remainingMs={groupBudget.remainingMs}
            />
          ) : null}
          <SettingsAccordionSection
            title={t("vault.group.settings.section_general")}
            defaultOpen
          >
            <Text style={typography.caption}>{t("vault.group.settings.rename")}</Text>
            <TextInput
              value={groupDraftName}
              onChangeText={(value) => {
                setGroupDraftName(value);
                setGroupFormError(null);
              }}
              style={[
                styles.groupInput,
                {
                  backgroundColor: colors.surfaceContainerHigh,
                  borderColor: colors.outlineVariant,
                  color: colors.onSurface,
                },
              ]}
            />
            {groupFormError ? (
              <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                {groupFormError}
              </Text>
            ) : null}
            <Text style={typography.caption}>{t("vault.group.settings.order")}</Text>
            <Text style={typography.caption}>{t("vault.group.settings.order_help")}</Text>
            <TextInput
              value={String(groupDraftOrder)}
              keyboardType="number-pad"
              onChangeText={(raw) => {
                setGroupDraftOrder(Math.max(0, Number.parseInt(raw, 10) || 0));
                setGroupFormError(null);
              }}
              style={[
                styles.groupInput,
                {
                  backgroundColor: colors.surfaceContainerHigh,
                  borderColor: colors.outlineVariant,
                  color: colors.onSurface,
                  fontFamily: "monospace",
                },
              ]}
            />
            <Text style={typography.caption}>{t("vault.group.settings.grouped_vault_sort")}</Text>
            <Text style={typography.caption}>
              {t("vault.group.settings.grouped_vault_sort_help")}
            </Text>
            <View style={{ gap: spacing.xs }}>
              {GROUPED_VAULT_SORT_MODES.map((mode) => (
                <MenuActionItem
                  key={mode}
                  icon={SORT_MODE_ICON[mode]}
                  label={t(`vault.list.sort.mode.${mode}` as I18nKey)}
                  selected={groupDraftGroupedVaultSort === mode}
                  onPress={() => setGroupDraftGroupedVaultSort(mode)}
                />
              ))}
              {(["asc", "desc"] as const).map((direction) => (
                <MenuActionItem
                  key={direction}
                  icon={SORT_DIRECTION_ICON[direction]}
                  label={t(`vault.list.sort.direction.${direction}` as I18nKey)}
                  selected={groupDraftGroupedVaultSortDirection === direction}
                  onPress={() => setGroupDraftGroupedVaultSortDirection(direction)}
                />
              ))}
            </View>
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
                <View style={[styles.modalActions, { marginTop: spacing.sm }]}>
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
                        if (generation !== groupBusyGenRef.current) return;
                        applyListedGroups(await vaultGroupService.list());
                        setSettingsGroup(null);
                        setGroupDeleteOpen(false);
                      });
                    }}
                  />
                </View>
              </View>
            )}
          </SettingsAccordionSection>
        </View>
      </Modal>

      <VaultBackupsModal
        vault={backupsVault}
        open={backupsVault !== null}
        onClose={() => setBackupsVault(null)}
        showToast={show}
      />

      <FileManagerScreen vault={fmVault} open={fmVault !== null} onClose={() => setFmVault(null)} />

      <AppSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        vaults={visibleVaults}
        groups={groups}
        includeHidden={showHidden}
        onCreateGroup={handleCreateGroup}
      />
      <VaultRootDataFolderModal
        open={dataFolderOpen}
        onClose={() => setDataFolderOpen(false)}
        onDirtyChange={setDataFolderDirty}
      />
      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CreateVaultModal
        open={createOpen}
        onClose={closeCreate}
        existingVaultIds={existingVaultIds}
        existingOrders={existingOrders}
        groups={groups}
        initialDraft={createDraft}
        initialStep={createStep}
        onCreate={(result: CreateVaultResult) => {
          // Session-only, like desktop `addVault` — listVaults is empty until vault_list lands.
          const item: VaultListItem = {
            id: result.vaultId,
            displayName: result.displayName,
            persistence: "sealed",
            session: null,
            storageMode: result.storageMode,
            order: result.order,
            canSeal: false,
            lastAccessedWhen: t("vault.create.just_created"),
            lastAccessedAt: new Date().toISOString(),
            note: result.note,
            passwordHint: result.passwordHint || undefined,
            hidden: result.settings.vault.hidden,
          };
          setVaults((prev) => [...prev.filter((vault) => vault.id !== item.id), item]);
          registerMockVaultId(item.id);
          show(t("vault.create.just_created"));
          if (shouldRecordVaultHidden(false, result.settings.vault.hidden)) {
            void logService.recordVaultHidden().catch(() => {
              /* Logging must never block hide. */
            });
          }

          void (async () => {
            try {
              await vaultService.registerSettings(result.vaultId, result.settings);
            } catch (error) {
              show(t(mobileErrorI18nKey(error, "error.unexpected")));
              return;
            }

            const assignment = result.groupAssignment;
            if (assignment.kind === "none") return;
            try {
              if (assignment.kind === "create") {
                const id = displayNameToGroupId(
                  assignment.displayName,
                  groups.map((g) => g.id),
                );
                await vaultGroupService.create({
                  id,
                  displayName: assignment.displayName,
                  groupedVaults: [result.vaultId],
                });
              } else {
                const target = groups.find((g) => g.id === assignment.groupId);
                if (!target) {
                  show(t("error.vault_group_not_found"));
                  return;
                }
                await vaultGroupService.update({
                  id: assignment.groupId,
                  groupedVaults: [
                    ...target.groupedVaults.filter((id) => id !== result.vaultId),
                    result.vaultId,
                  ],
                });
              }
              applyListedGroups(await vaultGroupService.list());
            } catch (error) {
              show(t(mobileErrorI18nKey(error, "error.unexpected")));
              try {
                applyListedGroups(await vaultGroupService.list());
              } catch {
                // Keep the original group-assign error for the toast.
              }
            }
          })();
        }}
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
                borderColor: colors.accent,
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
          <LoadingBudgetHint budgetMs={groupBudget.budgetMs} remainingMs={groupBudget.remainingMs} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: touchMin + spacing.md,
    gap: spacing.sm,
  },
  brand: { flexShrink: 0, marginRight: spacing.sm },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  /**
   * Secondary chrome — desktop `h-10` + bordered IconButton / toolbar filters.
   * Exact `height` (not only minHeight) so ⋮ and sort/view match.
   */
  headerMoreBtn: {
    width: 46,
    height: CONTROL_HEIGHT_MD,
    minWidth: 46,
    minHeight: CONTROL_HEIGHT_MD,
    borderRadius: radii.lg,
    borderWidth: 1,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 0,
    padding: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: CONTROL_HEIGHT_MD,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  toolbarTitleRow: {
    flex: 1,
    minWidth: 0,
    minHeight: CONTROL_HEIGHT_MD,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  toolbarTitle: {
    flexShrink: 1,
    fontWeight: "600",
    lineHeight: 22,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  toolbarFilters: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 0,
    minHeight: CONTROL_HEIGHT_MD,
  },
  /** Same height as header ⋮ / desktop secondary `h-10`. */
  toolbarFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    height: CONTROL_HEIGHT_MD,
    minHeight: CONTROL_HEIGHT_MD,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    borderRadius: radii.lg,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  list: { padding: spacing.lg, gap: spacing.sm },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  invalidBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
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
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "transparent",
  },
  groupChevronWrap: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  groupChevronCollapsed: {
    transform: [{ rotate: "-90deg" }],
  },
  groupGroupedVaults: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  ungroupDrop: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: "center",
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
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  dragChipText: {
    flexShrink: 1,
    fontWeight: "600",
  },
  busyHint: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    zIndex: 30,
  },
  memberRow: {
    marginBottom: 0,
  },
  groupInput: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  memberPick: { paddingVertical: spacing.sm },
  blockRow: { flex: 1, marginHorizontal: spacing.xs },
  blockRowWrap: { gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontWeight: "600" },
  actionList: {},
  /** Desktop `menuGroupLabelClass`. */
  menuGroupLabel: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    fontSize: 10,
    fontWeight: "600",
    opacity: 0.75,
    fontFamily: "monospace",
  },
  sectionGap: { marginTop: spacing.sm },
});
