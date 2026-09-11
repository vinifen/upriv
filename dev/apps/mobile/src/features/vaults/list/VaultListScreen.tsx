import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  applyVaultListHierarchySort,
  assignVaultToGroup,
  canReorderGroupedVaults,
  canReorderVaultList,
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromBackup,
  displayNameErrorI18nKey,
  displayNameToGroupId,
  draggingGroupedVaultSourceGroupId as resolveDraggingGroupedVaultSourceGroupId,
  groupedVaultDragKey,
  groupedVaultDropInsertsAfter,
  isGroupedVaultDragKey,
  filterVisibleVaults,
  filterVaultListRowsBySearch,
  groupedVaultSortOf,
  insertUngroupedVaultAtRoot,
  hiddenUngroupedRootVaults,
  hiddenOmittedRootGroups,
  hexWithAlpha,
  listDropHighlight,
  isListUngroupDragKey,
  LIST_ROOT_UNGROUP_DRAG_KEY,
  listUngroupDragKey,
  LOADING_BUDGET_MS,
  normalizeVaultGroup,
  parseGroupedVaultDragKey,
  pickListDropTarget,
  vaultIdsInHiddenGroups,
  vaultIdsUnhiddenByGroups,
  reorderGroupedVaults,
  reorderRootRows,
  removeVaultFromGroups,
  resolveListDrop,
  resolveVaultListStatus,
  vaultCanExport,
  RpcError,
  shouldBumpVaultRootEpoch,
  shouldRecordVaultHidden,
  validateDisplayName,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_ERROR_CODES,
  VAULT_NOTE_MAX_LENGTH,
  GROUPED_VAULT_SORT_MODES,
  VAULT_ROW_DENSITY,
  vaultBlocksColumnCount,
  SORT_DIRECTION_ICON,
  SORT_MODE_ICON,
  VIEW_MODE_ICON,
  type CreateVaultDraft,
  type CreateVaultGroupAssignment,
  type CreateVaultResult,
  type CreateVaultStepId,
  type VaultExportRequest,
  type VaultGroup,
  type VaultListItem,
  type VaultListSortDirection,
  type VaultListSortMode,
  type VaultListViewMode,
  type VaultSession,
} from "@upriv/shared";
import {
  useLogService,
  useVaultGroupService,
  useVaultLifecycleService,
  useVaultService,
} from "@/platform/services";
import { registerMockVaultId, unregisterMockVaultId } from "@/platform/mocks/data/vaults";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useLoadingBudget, useToast } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import {
  CONTROL_HEIGHT_MD,
  CONTROL_WIDTH_CHROME,
  MAX_WIDTH_VAULT_LIST,
  radii,
  spacing,
  touchMin,
  vaultRowShadow,
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
import { exportVaultPackage } from "@/features/vaults/list/exportVaultPackage";
import { GroupedVaultPicker } from "@/features/vaults/list/GroupedVaultPicker";
import {
  VaultLifecycleModal,
  VaultPipelineOverlay,
  WorkspaceSetupModal,
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
} from "@/components/settings";
import { RadioGroup } from "@/components/settings/settingsFields";
import { Icon } from "@/components/icons";
import { DropOverRing } from "./DropOverRing";
import { VaultDragHandle } from "./VaultDragHandle";
import { VaultHiddenIndicator } from "./VaultHiddenIndicator";
import { VaultListEmptyState } from "./VaultListEmptyState";
import { VaultListSearch } from "./VaultListSearch";
import { VaultRow } from "./VaultRow";
import { useVaultListScreen as useVaultListScreenState } from "./hooks";
import {
  flattenHierarchyRows,
  packRowsForBlocks,
  type BlocksGroupCell,
  type FlatHierarchyRow,
} from "./lib/hierarchyRows";

const SORT_MODES: VaultListSortMode[] = ["order", "name", "state", "last_accessed", "groups"];
const SORT_DIRS: VaultListSortDirection[] = ["asc", "desc"];
const VIEW_MODES: VaultListViewMode[] = ["default", "large", "compact", "blocks"];

export function VaultListScreen() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultService = useVaultService();
  const vaultGroupService = useVaultGroupService();
  const lifecycleService = useVaultLifecycleService();
  const logService = useLogService();
  const { settings, patchSettings, showHiddenVaultsSession, reportVaultRootIntegrityFailure } =
    useAppSettingsContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { message, show, dismiss } = useToast();

  const { state, modals } = useVaultListScreenState(
    settings.ui.vault_list_search,
    useCallback((patch) => patchSettings(patch), [patchSettings]),
  );
  const {
    listSearch,
    setListSearch,
    vaultListSearchRef,
    blurVaultListSearchIfOutside,
    vaults,
    setVaults,
    groups,
    setGroups,
    groupsInvalid,
    setGroupsInvalid,
    groupsInvalidDismissed,
    setGroupsInvalidDismissed,
    groupsSanitizeNotice,
    setGroupsSanitizeNotice,
    refreshing,
    setRefreshing,
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
  } = state;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const {
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
    setCreateOpen,
    createDraft,
    setCreateDraft,
    createStep,
    setCreateStep,
    lifecycleRequest,
    setLifecycleRequest,
    settingsVault,
    setSettingsVault,
    settingsArea,
    setSettingsArea,
    noteVaultId,
    setNoteVaultId,
    exportVault,
    setExportVault,
    exportSubmitting,
    setExportSubmitting,
    backupsVault,
    setBackupsVault,
    fmVault,
    setFmVault,
    settingsGroup,
    setSettingsGroup,
    settingsGroupOpenRef,
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
    setGroupBusy,
    repairBusy,
    setRepairBusy,
  } = modals;
  const groupBusyGenRef = useRef(0);
  const vaultOrderGenRef = useRef(0);
  const repairGenRef = useRef(0);
  const groupBudget = useLoadingBudget(groupBusy, LOADING_BUDGET_MS.default);
  const repairBudget = useLoadingBudget(repairBusy, LOADING_BUDGET_MS.default);
  const noteSaveGenerationRef = useRef(new Map<string, number>());
  const exportBusyGenRef = useRef(0);
  /** Aborted on export timeout so a late run cannot open the share sheet. */
  const exportAbortRef = useRef<AbortController | null>(null);

  const sortMode = settings.ui.vault_list_sort;
  const sortDirection = settings.ui.vault_list_sort_direction;
  const viewMode = settings.ui.vault_list_view;
  const showHidden = settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const searchActive = listSearch.trim().length > 0;
  const vaultListShowDrag = settings.ui.vault_list_show_drag !== false && !searchActive;
  const showHeaderMore = settings.ui.vault_list_show_header_more_button !== false;
  const showGroupSettings = settings.ui.vault_list_show_group_settings_button !== false;
  const vaultListAllowDragIntoGroup =
    settings.ui.vault_list_allow_drag_into_group !== false && !searchActive;
  const canReorder =
    vaultListShowDrag && canReorderVaultList({ mode: sortMode, direction: sortDirection });

  const existingVaultIds = useMemo(() => vaults.map((vault) => vault.id), [vaults]);
  const existingOrders = useMemo(() => vaults.map((vault) => vault.order ?? 0), [vaults]);
  const noteVault = useMemo(
    () => vaults.find((vault) => vault.id === noteVaultId) ?? null,
    [vaults, noteVaultId],
  );
  const vaultInfoVault = useMemo(
    () => vaults.find((vault) => vault.id === vaultInfoVaultId) ?? null,
    [vaults, vaultInfoVaultId],
  );

  const hierarchyRows = useMemo(() => {
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

  const displayRows = useMemo(
    () => filterVaultListRowsBySearch(hierarchyRows, listSearch),
    [hierarchyRows, listSearch],
  );

  const searchNoMatches =
    searchActive && displayRows.length === 0 && (vaults.length > 0 || groups.length > 0);

  const flatRows = useMemo(() => flattenHierarchyRows(displayRows), [displayRows]);

  const visibleVaults = useMemo(
    () => filterVisibleVaults(vaults, showHidden),
    [showHidden, vaults],
  );
  const allVaultsHidden = !searchActive && vaults.length > 0 && visibleVaults.length === 0;

  const setVaultRuntimeState = useCallback(
    (
      vaultId: string,
      patch: {
        session: VaultSession | null;
        lastAccessedAt?: string;
        lastAccessedWhen?: string;
      },
    ) => {
      setVaults((prev) =>
        prev.map((vault) => (vault.id === vaultId ? { ...vault, ...patch } : vault)),
      );
    },
    [setVaults],
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
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
      } else {
        show(t(mobileErrorI18nKey(error, "toast.refresh_failed")));
      }
    } finally {
      setRefreshing(false);
    }
  }, [
    reportVaultRootIntegrityFailure,
    setGroups,
    setGroupsInvalid,
    setGroupsInvalidDismissed,
    setGroupsSanitizeNotice,
    setRefreshing,
    setVaults,
    settingsGroupOpenRef,
    show,
    t,
    vaultGroupService,
    vaultService,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = useCallback(
    (draft: CreateVaultDraft | null = null, step: CreateVaultStepId | null = null) => {
      setCreateDraft(draft);
      setCreateStep(step);
      setCreateOpen(true);
    },
    [setCreateDraft, setCreateOpen, setCreateStep],
  );

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateDraft(null);
    setCreateStep(null);
  }, [setCreateDraft, setCreateOpen, setCreateStep]);

  const pipelineStatus = useMemo(
    () => ({
      openingVaultIds: [...lifecycle.openingVaultIds],
      closingVaultIds: [...lifecycle.closingVaultIds],
    }),
    [lifecycle.closingVaultIds, lifecycle.openingVaultIds],
  );

  const handleConfirmExportVault = useCallback(
    (request: VaultExportRequest) => {
      if (!exportVault) return;
      const vault = exportVault;
      const gen = ++exportBusyGenRef.current;
      exportAbortRef.current?.abort();
      const abort = new AbortController();
      exportAbortRef.current = abort;
      setExportSubmitting(true);
      void exportVaultPackage(
        vault,
        (row, exportRequest) => vaultService.getExportBytes(row, exportRequest),
        request,
        abort.signal,
      )
        .then(() => {
          if (gen !== exportBusyGenRef.current) return;
          show(t("vault.export.success", { name: vault.displayName }));
          setExportVault(null);
        })
        .catch((error) => {
          if (gen !== exportBusyGenRef.current) return;
          show(t(mobileErrorI18nKey(error, "vault.export.failed")));
        })
        .finally(() => {
          if (gen === exportBusyGenRef.current) setExportSubmitting(false);
        });
    },
    [exportVault, setExportSubmitting, setExportVault, show, t, vaultService],
  );

  const handleRowExport = useCallback(
    (vault: VaultListItem) => {
      const listStatus = resolveVaultListStatus(vault, pipelineStatus);
      if (listStatus === "opening" || listStatus === "closing") {
        show(t("vault.export.blocked_opening"));
        return;
      }
      if (!vaultCanExport(vault)) {
        show(t("vault.export.blocked_open"));
        return;
      }
      setExportVault(vault);
    },
    [pipelineStatus, setExportVault, show, t],
  );

  const isVaultPipelineBusy = useCallback(
    (vaultId: string) =>
      lifecycle.openingVaultIds.includes(vaultId) || lifecycle.closingVaultIds.includes(vaultId),
    [lifecycle.closingVaultIds, lifecycle.openingVaultIds],
  );

  const rowPadding = VAULT_ROW_DENSITY[viewMode === "blocks" ? "default" : viewMode].paddingY;
  const listPanelWidth = Math.min(windowWidth, MAX_WIDTH_VAULT_LIST);
  const blockColumns = viewMode === "blocks" ? vaultBlocksColumnCount(listPanelWidth) : 1;
  const listData = viewMode === "blocks" ? packRowsForBlocks(displayRows, blockColumns) : flatRows;
  const blockCellWidth =
    blockColumns > 1
      ? (listPanelWidth - spacing.lg * 2 - spacing.sm * (blockColumns - 1)) / blockColumns
      : undefined;

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
    const hideIds = new Set(vaultIdsInHiddenGroups(listed.groups));
    const showIds = new Set(vaultIdsUnhiddenByGroups(groupsRef.current, listed.groups));
    if (hideIds.size > 0 || showIds.size > 0) {
      setVaults((current) =>
        current.map((vault) => {
          if (hideIds.has(vault.id)) {
            return vault.hidden ? vault : { ...vault, hidden: true };
          }
          if (showIds.has(vault.id)) {
            return vault.hidden ? { ...vault, hidden: false } : vault;
          }
          return vault;
        }),
      );
    }
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

  const applyListedIfCurrent = async (generation: number) => {
    if (generation !== groupBusyGenRef.current) return;
    const listed = await vaultGroupService.list();
    if (generation !== groupBusyGenRef.current) return;
    applyListedGroups(listed);
  };

  const showGroupErr = (error: unknown) => {
    const message = t(mobileErrorI18nKey(error));
    setGroupFormError(message);
    show(message);
  };

  const runWithGroupBusy = async (
    work: (generation: number) => Promise<void>,
    options?: { notify?: boolean },
  ) => {
    const generation = ++groupBusyGenRef.current;
    setGroupBusy(true);
    setGroupFormError(null);
    try {
      await work(generation);
    } catch (error) {
      if (generation !== groupBusyGenRef.current) return;
      if (options?.notify !== false) showGroupErr(error);
      await reload().catch(() => undefined);
      throw error;
    } finally {
      if (generation === groupBusyGenRef.current) setGroupBusy(false);
    }
  };

  const applyVaultGroupMembership = async (
    vaultId: string,
    groupId: string | null,
    beforeGroupedVaultId: string | null | undefined,
    generation: number,
  ) => {
    const currentGroups = groupsRef.current;
    const currentGroup = currentGroups.find((g) => g.groupedVaults.includes(vaultId)) ?? null;
    if ((currentGroup?.id ?? null) === groupId && !beforeGroupedVaultId) return;
    if (groupId) {
      const target = currentGroups.find((g) => g.id === groupId);
      if (!target) {
        throw new RpcError(VAULT_ERROR_CODES.GROUP_NOT_FOUND, `group not found: ${groupId}`);
      }
      const nextGroups = assignVaultToGroup(currentGroups, vaultId, groupId, beforeGroupedVaultId, {
        insertAfter: groupedVaultDropInsertsAfter(target),
      });
      const updated = nextGroups.find((g) => g.id === groupId);
      if (!updated) return;
      await vaultGroupService.update({
        id: groupId,
        groupedVaults: updated.groupedVaults,
      });
    } else if (currentGroup) {
      await vaultGroupService.update({
        id: currentGroup.id,
        groupedVaults: currentGroup.groupedVaults.filter((id) => id !== vaultId),
      });
    }
    if (generation !== groupBusyGenRef.current) return;
    await applyListedIfCurrent(generation);
  };

  const assignVaultToGroupByDrag = async (
    vaultId: string,
    groupId: string | null,
    beforeGroupedVaultId?: string | null,
  ) => {
    const currentGroup = groupsRef.current.find((g) => g.groupedVaults.includes(vaultId)) ?? null;
    if ((currentGroup?.id ?? null) === groupId && !beforeGroupedVaultId) {
      return;
    }
    await runWithGroupBusy(async (generation) => {
      await applyVaultGroupMembership(vaultId, groupId, beforeGroupedVaultId, generation);
    });
  };

  const ungroupVaultFromGroup = async (vaultId: string, beforeRootVaultId?: string | null) => {
    const currentGroups = groupsRef.current;
    const source = currentGroups.find((g) => g.groupedVaults.includes(vaultId));
    if (!source) return;

    await runWithGroupBusy(async (generation) => {
      await vaultGroupService.update({
        id: source.id,
        groupedVaults: source.groupedVaults.filter((id) => id !== vaultId),
      });
      if (generation !== groupBusyGenRef.current) return;

      if (canReorder) {
        const vault = vaultsRef.current.find((item) => item.id === vaultId);
        if (vault) {
          const previous = currentGroups;
          const hiddenTail = hiddenUngroupedRootVaults(
            vaultsRef.current,
            currentGroups,
            displayRowsRef.current,
          );
          const hiddenGroups = hiddenOmittedRootGroups(currentGroups, displayRowsRef.current);
          const nextRows = insertUngroupedVaultAtRoot(
            displayRowsRef.current,
            vault,
            beforeRootVaultId,
            sortDirection,
            hiddenTail,
            hiddenGroups,
          );
          const previousVaults = vaultsRef.current;
          const nextVaults = previousVaults.map((item) => {
            const row = nextRows.find((r) => r.kind === "vault" && r.vault.id === item.id);
            return row && row.kind === "vault" ? { ...item, order: row.vault.order } : item;
          });
          const nextGroups = removeVaultFromGroups(currentGroups, vaultId).map((group) => {
            const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
            return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
          });
          setVaults(nextVaults);
          persistVaultRootOrders(nextVaults, previousVaults);
          const orders = nextGroups
            .filter((group) => previous.find((g) => g.id === group.id)?.order !== group.order)
            .map((group) => ({ id: group.id, order: group.order }));
          if (orders.length > 0) {
            await vaultGroupService.reorder(orders);
            if (generation !== groupBusyGenRef.current) return;
          }
        }
      }

      await applyListedIfCurrent(generation);
    });
  };

  const handleCreateGroup = async (
    displayName: string,
    groupedVaultIds: string[] = [],
    hidden = false,
  ) => {
    await runWithGroupBusy(
      async (generation) => {
        const id = displayNameToGroupId(
          displayName,
          groupsRef.current.map((g) => g.id),
        );
        await vaultGroupService.create({
          id,
          displayName,
          groupedVaults: [...groupedVaultIds],
          hidden,
        });
        await applyListedIfCurrent(generation);
      },
      { notify: false },
    );
  };

  const handleCommitGroupAssignment = async (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => {
    if (assignment.kind === "create") {
      await handleCreateGroup(assignment.displayName, [vaultId]);
      return;
    }
    await runWithGroupBusy(
      async (generation) => {
        await applyVaultGroupMembership(
          vaultId,
          assignment.kind === "existing" ? assignment.groupId : null,
          undefined,
          generation,
        );
      },
      { notify: false },
    );
  };

  const handleVaultDelete = async (vaultId: string) => {
    if (
      lifecycle.openingVaultIds.includes(vaultId) ||
      lifecycle.closingVaultIds.includes(vaultId)
    ) {
      show(t("toast.pipeline_busy"));
      return;
    }

    groupBusyGenRef.current += 1;
    try {
      const containing = groupsRef.current.filter((group) => group.groupedVaults.includes(vaultId));
      for (const group of containing) {
        await vaultGroupService.update({
          id: group.id,
          groupedVaults: group.groupedVaults.filter((id) => id !== vaultId),
        });
      }
      await vaultService.unregisterSettings(vaultId);
    } catch (error) {
      show(t(mobileErrorI18nKey(error, "error.unexpected")));
      try {
        const listed = await vaultGroupService.list();
        applyListedGroups(listed);
      } catch (listError) {
        show(t(mobileErrorI18nKey(listError, "toast.refresh_failed")));
      }
      return;
    }

    unregisterMockVaultId(vaultId);
    lifecycleService.clearPasswordInSession(vaultId);
    setVaults((current) => current.filter((vault) => vault.id !== vaultId));
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        groupedVaults: group.groupedVaults.filter((id) => id !== vaultId),
      })),
    );
    setSettingsVault(null);
    setSettingsArea(null);
    setNoteVaultId((current) => (current === vaultId ? null : current));
    setBackupsVault((current) => (current?.id === vaultId ? null : current));
    setFmVault((current) => (current?.id === vaultId ? null : current));
    if (lifecycleRequest?.vaultId === vaultId) {
      setLifecycleRequest(null);
    }
  };

  const handleNoteChange = useCallback(
    async (vaultId: string, note: string): Promise<boolean> => {
      const trimmed = (note ?? "").slice(0, VAULT_NOTE_MAX_LENGTH);
      const previous = vaultsRef.current.find((vault) => vault.id === vaultId)?.note ?? "";
      setVaults((current) =>
        current.map((vault) =>
          vault.id === vaultId && (vault.note ?? "") !== trimmed
            ? { ...vault, note: trimmed }
            : vault,
        ),
      );
      const nextGeneration = (noteSaveGenerationRef.current.get(vaultId) ?? 0) + 1;
      noteSaveGenerationRef.current.set(vaultId, nextGeneration);
      const rollback = () => {
        setVaults((current) =>
          current.map((vault) =>
            vault.id === vaultId && (vault.note ?? "") !== previous
              ? { ...vault, note: previous }
              : vault,
          ),
        );
      };

      let vaultSettings;
      try {
        vaultSettings = await vaultService.getSettings(vaultId);
      } catch (error) {
        if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
        rollback();
        show(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
        return false;
      }
      if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
      if (!vaultSettings) {
        rollback();
        show(t("error.unexpected"));
        return false;
      }

      try {
        await vaultService.registerSettings(vaultId, {
          ...vaultSettings,
          vault: { ...vaultSettings.vault, note: trimmed },
        });
      } catch (error) {
        if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
        rollback();
        show(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
        return false;
      }
      if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
      return true;
    },
    [setVaults, show, t, vaultService],
  );

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

  const refreshDropRects = useCallback(() => {
    dropViewsRef.current.forEach((view, key) => {
      view.measureInWindow((x, y, w, h) => {
        dropRectsRef.current.set(key, { x, y, w, h });
      });
    });
  }, [dropRectsRef, dropViewsRef]);

  const hitDropKey = (pageX: number, pageY: number): string | null => {
    const source = draggingIdRef.current;
    const pointInRect = (rect: { x: number; y: number; w: number; h: number }) =>
      pageX >= rect.x && pageX <= rect.x + rect.w && pageY >= rect.y && pageY <= rect.y + rect.h;

    const matches: string[] = [];
    dropRectsRef.current.forEach((rect, key) => {
      if (key === source || !pointInRect(rect)) return;
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

  const persistRootOrders = (nextGroups: VaultGroup[], previous: VaultGroup[]) => {
    const orders = nextGroups
      .filter((group) => previous.find((g) => g.id === group.id)?.order !== group.order)
      .map((group) => ({ id: group.id, order: group.order }));
    if (orders.length === 0) return;
    void runWithGroupBusy(async (generation) => {
      await vaultGroupService.reorder(orders);
      await applyListedIfCurrent(generation);
    }).catch(() => undefined);
  };

  const persistVaultRootOrders = (nextVaults: VaultListItem[], previous: VaultListItem[]) => {
    const orders = nextVaults
      .filter((vault) => previous.find((item) => item.id === vault.id)?.order !== vault.order)
      .map((vault) => ({ id: vault.id, order: vault.order ?? 0 }));
    if (orders.length === 0) return;
    const generation = ++vaultOrderGenRef.current;
    void (async () => {
      try {
        for (const { id, order } of orders) {
          if (vaultOrderGenRef.current !== generation) return;
          const settingsForVault = await vaultService.getSettings(id);
          if (!settingsForVault || settingsForVault.vault.order === order) continue;
          await vaultService.registerSettings(id, {
            ...settingsForVault,
            vault: { ...settingsForVault.vault, order },
          });
        }
      } catch (error) {
        if (vaultOrderGenRef.current !== generation) return;
        show(t(mobileErrorI18nKey(error)));
      }
    })();
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
        void runWithGroupBusy(async (generation) => {
          await vaultGroupService.reorderGroupedVaults(group.id, nextGroup.groupedVaults);
          await applyListedIfCurrent(generation);
        }).catch(() => undefined);
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

  useEffect(() => {
    if (!groupBudget.timedOut || !groupBusy) return;
    groupBusyGenRef.current += 1;
    setGroupBusy(false);
    show(t("error.operation_timed_out"));
  }, [groupBudget.timedOut, groupBusy, setGroupBusy, show, t]);

  useEffect(() => {
    if (!repairBudget.timedOut || !repairBusy) return;
    repairGenRef.current += 1;
    setRepairBusy(false);
    show(t("error.operation_timed_out"));
  }, [repairBudget.timedOut, repairBusy, setRepairBusy, show, t]);

  const handleExportTimeout = useCallback(() => {
    exportBusyGenRef.current += 1;
    exportAbortRef.current?.abort();
    setExportSubmitting(false);
    show(t("error.operation_timed_out"));
  }, [setExportSubmitting, show, t]);

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
        groupBusy={groupBusy}
        isDragging={draggingId === dropKey}
        isDragOver={isDropOver(dropKey)}
        isDropBlocked={dropOverBlocked}
        isPipelineBusy={isVaultPipelineBusy(vault.id)}
        dropTargetProps={bindDropTarget(dropKey)}
        onDragStart={(x, y) => onRowDragStart(dropKey, x, y)}
        onDragMove={onRowDragMove}
        onDragEnd={onRowDragEnd}
        onDragCancel={clearDrag}
        onOpenFileManager={setFmVault}
        onOpenFolder={lifecycle.handleOpenFolder}
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
    const groupedVaultCount = pack.visibleVaultCount;
    const showUngroupInThisGroup = draggingGroupedVaultSourceGroupId === pack.group.id;
    const expanded = !pack.group.collapsed || showUngroupInThisGroup;
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
              paddingVertical: rowPadding,
              paddingRight: rowPadding,
              paddingLeft:
                vaultListShowDrag && canReorder ? Math.max(rowPadding - 8, spacing.sm) : rowPadding,
            },
          ]}
        >
          {vaultListShowDrag && canReorder && !groupBusy ? (
            <VaultDragHandle
              disabled={!canReorder || groupBusy}
              onDragStart={(x, y) => onRowDragStart(groupKey, x, y)}
              onDragMove={onRowDragMove}
              onDragEnd={onRowDragEnd}
              onDragCancel={clearDrag}
            />
          ) : null}
          <Pressable
            style={styles.rowPress}
            onPress={() => toggleGroupCollapsed(pack.group)}
            onLongPress={showGroupSettings ? () => openGroupSettings(pack.group) : undefined}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={pack.group.displayName}
          >
            <View
              style={[
                styles.groupChevronWrap,
                pack.group.collapsed ? styles.groupChevronCollapsed : null,
              ]}
            >
              <Icon name="chevron-down" size={18} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.rowText}>
              <View style={styles.groupTitleRow}>
                <Text
                  style={[
                    typography.body,
                    styles.rowTitle,
                    styles.groupTitle,
                    {
                      fontSize:
                        VAULT_ROW_DENSITY[viewMode === "blocks" ? "default" : viewMode].titleSize,
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
            <IconButton
              label={t("vault.group.open_settings")}
              icon="settings"
              size={18}
              onPress={() => openGroupSettings(pack.group)}
            />
          ) : null}
        </View>
        {expanded && (pack.groupedVaults.length > 0 || showUngroupInThisGroup) ? (
          <View
            style={[
              styles.groupGroupedVaults,
              viewMode === "blocks" && fillMemberGrid ? styles.blockRowWrap : null,
            ]}
          >
            {pack.groupedVaults.map((vault) => (
              <View
                key={vault.id}
                style={
                  viewMode === "blocks" && fillMemberGrid && blockCellWidth != null
                    ? { width: blockCellWidth }
                    : undefined
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
        ) : null}
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
      style={[styles.root, { paddingTop: insets.top, backgroundColor: colors.background }]}
      onTouchStart={blurVaultListSearchIfOutside}
    >
      <CenteredPanel maxWidth={MAX_WIDTH_VAULT_LIST}>
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          <UprivWordmark height={20} style={styles.brand} />
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

        <View style={[styles.toolbar, { backgroundColor: colors.background }]}>
          <View style={styles.toolbarTitleRow}>
            <Icon name="encrypted" size={22} color={colors.onSurfaceVariant} />
            <Text style={[typography.headline, styles.toolbarTitle]} numberOfLines={1}>
              {t("vault.list.title")}
            </Text>
            {settings.ui.vault_list_show_create_button !== false ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("app.new_vault")}
                onPress={() => openCreate(createDraftForScratchSource(existingOrders), "source")}
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
                            backgroundColor: pressed ? colors.surfaceContainerHigh : "transparent",
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
                    <MenuGroupLabel>{t("vault.list.sort.by_label")}</MenuGroupLabel>
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
                    <MenuGroupLabel>{t("vault.list.sort.direction_label")}</MenuGroupLabel>
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
                    <MenuGroupLabel>{t("vault.list.view.layout_label")}</MenuGroupLabel>
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

        <View
          style={styles.listHost}
          {...(draggingGroupedVaultSourceGroupId ? bindDropTarget(LIST_ROOT_UNGROUP_DRAG_KEY) : {})}
        >
          <FlatList
            key={`vault-list-${viewMode}-${blockColumns}`}
            data={listData}
            extraData={`${draggingId}|${dragOverId}|${groupBusy}|${viewMode}|${searchActive}`}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            contentContainerStyle={[styles.list, listData.length === 0 ? styles.listEmpty : null]}
            scrollEnabled={!draggingId && !dragScrollLock}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
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
        area={settingsArea}
        open={settingsVault !== null && settingsArea !== null}
        onClose={() => {
          setSettingsVault(null);
          setSettingsArea(null);
        }}
        showToast={show}
        groups={groups}
        onCommitGroupAssignment={handleCommitGroupAssignment}
        onVaultDelete={(vaultId) => {
          void handleVaultDelete(vaultId);
        }}
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
              onChangeText={(value) => {
                setGroupDraftName(value);
                setGroupFormError(null);
              }}
              style={styles.groupInput}
            />
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
          openCreate(createDraftFromBackup(stamp, sourceId, existingOrders), null);
        }}
      />

      <FileManagerScreen vault={fmVault} open={fmVault !== null} onClose={() => setFmVault(null)} />

      <AppSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDirtyChange={setSettingsDirty}
        hasOpenVault={vaults.some((vault) => vault.session === "open")}
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
      />
      <CreateVaultModal
        open={createOpen}
        onClose={closeCreate}
        existingVaultIds={existingVaultIds}
        existingOrders={existingOrders}
        groups={groups}
        initialDraft={createDraft}
        initialStep={createStep}
        onCreate={(result: CreateVaultResult) => {
          // Session-only add — reload reseeds MOCK_VAULTS, not wizard rows.
          const item: VaultListItem = {
            id: result.vaultId,
            displayName: result.displayName,
            session: null,
            storageMode: result.storageMode,
            order: result.order,
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
              if (result.unlockPreset) {
                await vaultService.setUnlockPreset(result.vaultId, result.unlockPreset);
              }
            } catch (error) {
              show(t(mobileErrorI18nKey(error, "error.unexpected")));
              return;
            }

            const assignment = result.groupAssignment;
            if (assignment.kind === "none") return;
            try {
              await handleCommitGroupAssignment(result.vaultId, assignment);
            } catch (error) {
              show(t(mobileErrorI18nKey(error, "error.unexpected")));
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
    minHeight: CONTROL_HEIGHT_MD,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
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
    fontWeight: "600",
    lineHeight: 22,
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
  list: { padding: spacing.lg, gap: spacing.sm, overflow: "visible" },
  listHost: { flex: 1 },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  invalidBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
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
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    ...vaultRowShadow,
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
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
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
    left: spacing.lg,
    right: spacing.lg,
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
