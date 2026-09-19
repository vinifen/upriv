import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  applyPendingCreateGroupEffect,
  applyVaultListHierarchySort,
  applyVaultSettingsListPatch,
  buildCreatingVaultListItem,
  buildPendingCreateGroupEffect,
  assignVaultToGroup,
  canReorderVaultList,
  displayNameErrorI18nKey,
  displayNameToGroupId,
  filterVisibleVaults,
  mergePendingCreatingGroups,
  mergePendingCreatingVaults,
  pendingCreateGroupId,
  rollbackPendingCreateGroupEffect,
  mergeVaultListSnapshot,
  filterVaultListRowsBySearch,
  groupedVaultDropInsertsAfter,
  hiddenOmittedRootGroups,
  hiddenUngroupedRootVaults,
  insertUngroupedVaultAtRoot,
  LOADING_BUDGET_MS,
  remapVaultIdInGroups,
  removeVaultFromGroups,
  sortVaultsByOrder,
  vaultIdsInHiddenGroups,
  vaultIdsUnhiddenByGroups,
  resolveVaultListStatus,
  vaultCanExport,
  RpcError,
  shouldBumpVaultRootEpoch,
  isVaultRootGoneError,
  shouldRecordVaultHidden,
  validateDisplayName,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_ERROR_CODES,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_ROW_DENSITY,
  vaultBlocksColumnCount,
  type CreateVaultDraft,
  type CreateVaultGroupAssignment,
  type CreateVaultResult,
  type CreateVaultStepId,
  type PendingCreateGroupEffect,
  type VaultExportRequest,
  type VaultGroup,
  type VaultListItem,
  type VaultSession,
} from "@upriv/shared";
import {
  useLogService,
  useVaultGroupService,
  useVaultLifecycleService,
  useVaultService,
} from "@/platform/services";
import { unregisterMockVaultId } from "@/platform/mocks/data/vaults";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useLoadingBudget, useToast } from "@upriv/shared/react";
import { CONTROL_HEIGHT_MD, MAX_WIDTH_VAULT_LIST, spacing } from "@/theme/tokens";
import { exportVaultPackage } from "@/features/vaults/list/exportVaultPackage";
import { useVaultLifecycle } from "@/features/vaults/lifecycle";
import { useFileManager } from "@/features/vaults/file-manager";
import { useVaultListModals } from "./useVaultListModals";
import { useVaultListState } from "./useVaultListState";
import { flattenHierarchyRows, packRowsForBlocks } from "../lib/hierarchyRows";

const PAGE_PAD_H = spacing.md;

export function useVaultListScreen() {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const vaultGroupService = useVaultGroupService();
  const lifecycleService = useVaultLifecycleService();
  const logService = useLogService();
  const {
    settings,
    patchSettings,
    showHiddenVaultsSession,
    reportVaultRootIntegrityFailure,
    settingsOnDisk,
    vaultRootEpoch,
  } = useAppSettingsContext();
  const insets = useSafeAreaInsets();
  const headerHeightFallback = insets.top + spacing.lg * 2 + CONTROL_HEIGHT_MD;
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState<number | null>(null);
  const appHeaderHeight = measuredHeaderHeight ?? headerHeightFallback;
  const { width: windowWidth } = useWindowDimensions();
  const { message, show, dismiss } = useToast();
  const { openFromVault, syncWithVaultList, purgeForVaultClose } = useFileManager();

  const state = useVaultListState(
    settings.ui.vault_list_search,
    useCallback((patch) => patchSettings(patch), [patchSettings]),
  );
  const modals = useVaultListModals();
  const {
    listSearch,
    vaults,
    setVaults,
    groups,
    setGroups,
    setGroupsInvalid,
    setGroupsInvalidDismissed,
    setGroupsSanitizeNotice,
    setRefreshing,
  } = state;
  const groupsRef = useRef(groups);
  const pendingCreatesRef = useRef<Map<string, VaultListItem>>(new Map());
  const pendingCreateGroupsRef = useRef<Map<string, PendingCreateGroupEffect>>(new Map());
  groupsRef.current = groups;
  const {
    setCreateOpen,
    setCreateDraft,
    setCreateStep,
    lifecycleRequest,
    setLifecycleRequest,
    setSettingsVault,
    setSettingsArea,
    noteVaultId,
    setNoteVaultId,
    vaultInfoVaultId,
    exportVault,
    setExportVault,
    setExportSubmitting,
    setBackupsVault,
    settingsGroupOpenRef,
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
  const displayRowsRef = useRef(displayRows);
  displayRowsRef.current = displayRows;

  const searchNoMatches =
    searchActive && displayRows.length === 0 && (vaults.length > 0 || groups.length > 0);

  const flatRows = useMemo(() => flattenHierarchyRows(displayRows), [displayRows]);

  const visibleVaults = useMemo(
    () => filterVisibleVaults(vaults, showHidden),
    [showHidden, vaults],
  );
  const allVaultsHidden = !searchActive && vaults.length > 0 && visibleVaults.length === 0;

  const sessionWritesRef = useRef(new Map<string, number>());
  const settingsPersistVaultIdsRef = useRef(new Set<string>());
  const prevVaultRootEpochRef = useRef(vaultRootEpoch);
  useEffect(() => {
    if (prevVaultRootEpochRef.current === vaultRootEpoch) return;
    prevVaultRootEpochRef.current = vaultRootEpoch;
    sessionWritesRef.current.clear();
  }, [vaultRootEpoch]);

  const setVaultRuntimeState = useCallback(
    (
      vaultId: string,
      patch: {
        session: VaultSession | null;
        lastAccessedAt?: string;
        lastAccessedWhen?: string;
      },
    ) => {
      sessionWritesRef.current.set(vaultId, Date.now());
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
    onDiscardWorkspace: purgeForVaultClose,
    onOpenFileManager: openFromVault,
    settingsPersistVaultIdsRef,
  });

  const reload = useCallback(async (): Promise<VaultListItem[]> => {
    setRefreshing(true);
    const fetchStartedAt = Date.now();
    try {
      const [list, groupResult] = await Promise.all([
        vaultService.listVaults(),
        vaultGroupService.list(),
      ]);
      for (const row of list) {
        pendingCreatesRef.current.delete(row.id);
      }
      setVaults((current) =>
        mergeVaultListSnapshot(
          current,
          mergePendingCreatingVaults(list, [...pendingCreatesRef.current.values()]),
          sessionWritesRef.current,
          fetchStartedAt,
        ),
      );
      if (settingsGroupOpenRef.current) {
        show(t("toast.groups_refresh_blocked_settings"));
      } else {
        setGroups(
          mergePendingCreatingGroups(groupResult.groups, pendingCreateGroupsRef.current.values()),
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
      return list;
    } catch (error) {
      if (isVaultRootGoneError(error) && !settingsOnDisk) {
        // Children stay mounted under Gate; first-run is not mid-session integrity.
      } else if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
      } else {
        show(t(mobileErrorI18nKey(error, "toast.refresh_failed")));
      }
      return [];
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
    settingsOnDisk,
    show,
    t,
    vaultGroupService,
    vaultService,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    syncWithVaultList(vaults);
  }, [syncWithVaultList, vaults]);

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
      creatingVaultIds: [...lifecycle.creatingVaultIds],
      queuedVaultIds: [...lifecycle.queuedVaultIds],
      activeVaultId: lifecycle.activePipelineVaultId ?? undefined,
      activeStartedAt: lifecycle.activePipelineStartedAt ?? undefined,
    }),
    [
      lifecycle.activePipelineStartedAt,
      lifecycle.activePipelineVaultId,
      lifecycle.closingVaultIds,
      lifecycle.creatingVaultIds,
      lifecycle.openingVaultIds,
      lifecycle.queuedVaultIds,
    ],
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
      if (!vaultService.canExportVault) return;
      if (
        listStatus === "opening" ||
        listStatus === "closing" ||
        listStatus === "creating" ||
        listStatus === "queued"
      ) {
        show(t("vault.export.blocked_opening"));
        return;
      }
      if (!vaultCanExport(vault, pipelineStatus)) {
        show(t("vault.export.blocked_open"));
        return;
      }
      setExportVault(vault);
    },
    [pipelineStatus, setExportVault, show, t, vaultService.canExportVault],
  );

  const isVaultPipelineBusy = lifecycle.isVaultPipelineBusy;

  const rowDensity = VAULT_ROW_DENSITY[viewMode === "blocks" ? "default" : viewMode];
  const rowPaddingY = rowDensity.paddingY;
  const rowPaddingX = rowDensity.paddingX;
  const listPanelWidth = Math.min(windowWidth, MAX_WIDTH_VAULT_LIST);
  const blockColumns = viewMode === "blocks" ? vaultBlocksColumnCount(listPanelWidth) : 1;
  const listData = viewMode === "blocks" ? packRowsForBlocks(displayRows, blockColumns) : flatRows;
  const blockCellWidth =
    blockColumns > 1
      ? (listPanelWidth - PAGE_PAD_H * 2 - spacing.sm * (blockColumns - 1)) / blockColumns
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
    const merged = mergePendingCreatingGroups(
      listed.groups,
      pendingCreateGroupsRef.current.values(),
    );
    setGroups(merged);
    const hideIds = new Set(vaultIdsInHiddenGroups(merged));
    const showIds = new Set(vaultIdsUnhiddenByGroups(groupsRef.current, merged));
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
    options?: {
      notify?: boolean;
      /** When false, no busy UI — desktop drag-assign parity. */ ui?: boolean;
    },
  ) => {
    const generation = ++groupBusyGenRef.current;
    const showBusy = options?.ui !== false;
    if (showBusy) setGroupBusy(true);
    setGroupFormError(null);
    try {
      await work(generation);
    } catch (error) {
      if (generation !== groupBusyGenRef.current) return;
      if (options?.notify !== false) showGroupErr(error);
      await reload().catch(() => undefined);
      throw error;
    } finally {
      if (showBusy && generation === groupBusyGenRef.current) setGroupBusy(false);
    }
  };

  const persistRootOrders = (nextGroups: VaultGroup[], previous: VaultGroup[]) => {
    const orders = nextGroups
      .filter((group) => previous.find((g) => g.id === group.id)?.order !== group.order)
      .map((group) => ({ id: group.id, order: group.order }));
    if (orders.length === 0) return;
    void runWithGroupBusy(
      async (generation) => {
        await vaultGroupService.reorder(orders);
        await applyListedIfCurrent(generation);
      },
      { ui: false },
    ).catch(() => undefined);
  };

  const persistVaultRootOrders = (nextVaults: VaultListItem[], previous: VaultListItem[]) => {
    const orders = nextVaults
      .filter((vault) => previous.find((item) => item.id === vault.id)?.order !== vault.order)
      .map((vault) => ({ id: vault.id, order: vault.order ?? 0 }));
    if (orders.length === 0 || !vaultService.canPersistSettings) return;
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
      // Desktop parity — paint membership before the RPC so the group does not flicker.
      setGroups(nextGroups);
      await vaultGroupService.update({
        id: groupId,
        groupedVaults: updated.groupedVaults,
      });
    } else if (currentGroup) {
      const nextGrouped = currentGroup.groupedVaults.filter((id) => id !== vaultId);
      setGroups(
        currentGroups.map((group) =>
          group.id === currentGroup.id ? { ...group, groupedVaults: nextGrouped } : group,
        ),
      );
      await vaultGroupService.update({
        id: currentGroup.id,
        groupedVaults: nextGrouped,
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
    await runWithGroupBusy(
      async (generation) => {
        await applyVaultGroupMembership(vaultId, groupId, beforeGroupedVaultId, generation);
      },
      { ui: false, notify: true },
    );
  };

  const ungroupVaultFromGroup = async (vaultId: string, beforeRootVaultId?: string | null) => {
    const currentGroups = groupsRef.current;
    const source = currentGroups.find((g) => g.groupedVaults.includes(vaultId));
    if (!source) return;

    await runWithGroupBusy(
      async (generation) => {
        const nextGroups = removeVaultFromGroups(currentGroups, vaultId);
        setGroups(nextGroups);
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
            const nextGroupsWithOrder = removeVaultFromGroups(currentGroups, vaultId).map(
              (group) => {
                const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
                return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
              },
            );
            setVaults(nextVaults);
            setGroups(nextGroupsWithOrder);
            persistVaultRootOrders(nextVaults, previousVaults);
            const orders = nextGroupsWithOrder
              .filter((group) => previous.find((g) => g.id === group.id)?.order !== group.order)
              .map((group) => ({ id: group.id, order: group.order }));
            if (orders.length > 0) {
              await vaultGroupService.reorder(orders);
              if (generation !== groupBusyGenRef.current) return;
            }
          }
        }

        await applyListedIfCurrent(generation);
      },
      { ui: false, notify: true },
    );
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
      await runWithGroupBusy(
        async (generation) => {
          const pendingEffect = pendingCreateGroupsRef.current.get(vaultId);
          const existingIds = groupsRef.current
            .map((g) => g.id)
            .filter((id) => pendingEffect?.kind !== "create" || id !== pendingEffect.group.id);
          const id =
            pendingCreateGroupId(pendingEffect, assignment, existingIds) ??
            displayNameToGroupId(assignment.displayName, existingIds);
          await vaultGroupService.create({
            id,
            displayName: assignment.displayName,
            groupedVaults: [vaultId],
          });
          pendingCreateGroupsRef.current.delete(vaultId);
          await applyListedIfCurrent(generation);
        },
        { notify: false, ui: false },
      );
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
        pendingCreateGroupsRef.current.delete(vaultId);
      },
      { notify: false, ui: false },
    );
  };

  const handleVaultDelete = async (vaultId: string) => {
    if (isVaultPipelineBusy(vaultId)) {
      show(t("toast.pipeline_busy"));
      return;
    }
    if (!vaultService.canDeleteVault) {
      show(t("error.not_implemented"));
      return;
    }

    lifecycle.cancelClosingHold(vaultId);
    lifecycle.invalidateOpenRetain(vaultId);

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
    sessionWritesRef.current.delete(vaultId);
    pendingCreatesRef.current.delete(vaultId);
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
    purgeForVaultClose(vaultId);
    if (lifecycleRequest?.vaultId === vaultId) {
      setLifecycleRequest(null);
    }
  };

  const handleNoteChange = useCallback(
    async (vaultId: string, note: string): Promise<boolean> => {
      if (!vaultService.canPersistSettings) {
        show(t("error.not_implemented"));
        return false;
      }
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

  const handleVaultSettingsSaved = useCallback(
    (vaultId: string, patch: Parameters<typeof applyVaultSettingsListPatch>[1]) => {
      const previous = vaults.find((vault) => vault.id === vaultId);
      const nextId = patch.id || vaultId;
      setVaults((prev) =>
        prev.map((vault) =>
          vault.id === vaultId ? applyVaultSettingsListPatch(vault, patch) : vault,
        ),
      );
      if (nextId !== vaultId) {
        setGroups((prev) => remapVaultIdInGroups(prev, vaultId, nextId));
        const writtenAt = sessionWritesRef.current.get(vaultId);
        if (writtenAt !== undefined) {
          sessionWritesRef.current.delete(vaultId);
          sessionWritesRef.current.set(nextId, writtenAt);
        }
        if (settings.app.last_opened_vault.trim() === vaultId) {
          void patchSettings({ app: { last_opened_vault: nextId } }, { memoryOnly: true });
        }
      }
      setSettingsVault((current) =>
        current && current.id === vaultId ? applyVaultSettingsListPatch(current, patch) : current,
      );
      if (shouldRecordVaultHidden(previous?.hidden, patch.hidden)) {
        void logService.recordVaultHidden().catch(() => {
          /* Logging must never block hide. */
        });
      }
    },
    [
      logService,
      patchSettings,
      setGroups,
      setSettingsVault,
      setVaults,
      settings.app.last_opened_vault,
      vaults,
    ],
  );

  const handlePersistBusyChange = useCallback((vaultIds: readonly string[] | null) => {
    settingsPersistVaultIdsRef.current = new Set(vaultIds ?? []);
  }, []);

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

  const handleCreateVault = (result: CreateVaultResult, password: string) => {
    if (result.source === "import") {
      throw new RpcError("not_implemented", "Import and create-from-backup are not implemented");
    }
    if (
      vaults.some((vault) => vault.id === result.vaultId) ||
      isVaultPipelineBusy(result.vaultId)
    ) {
      throw new RpcError(
        VAULT_ERROR_CODES.VAULT_ALREADY_EXISTS,
        `vault already exists: ${result.vaultId}`,
      );
    }

    const placeholder = buildCreatingVaultListItem(result);
    pendingCreatesRef.current.set(result.vaultId, placeholder);
    sessionWritesRef.current.set(result.vaultId, Date.now());
    setVaults((current) => sortVaultsByOrder([...current, placeholder]));

    const groupEffect = buildPendingCreateGroupEffect(
      result.groupAssignment,
      result.vaultId,
      groupsRef.current,
    );
    if (groupEffect) {
      pendingCreateGroupsRef.current.set(result.vaultId, groupEffect);
      setGroups((current) => applyPendingCreateGroupEffect(current, groupEffect));
    }

    const started = lifecycle.startCreatePipeline(
      result.vaultId,
      async () => {
        await vaultService.createVault({
          password,
          unlockPreset: result.unlockPreset,
          settings: result.settings,
        });
      },
      {
        onComplete: () => {
          sessionWritesRef.current.set(result.vaultId, Date.now());
          if (shouldRecordVaultHidden(false, result.settings.vault.hidden)) {
            void logService.recordVaultHidden().catch(() => {
              /* Logging must never block hide. */
            });
          }
          void (async () => {
            const assignment = result.groupAssignment;
            if (assignment.kind !== "none") {
              try {
                await handleCommitGroupAssignment(result.vaultId, assignment);
              } catch (error) {
                show(t(mobileErrorI18nKey(error, "error.unexpected")));
              }
            }
            const listed = await reload();
            if (listed.some((row) => row.id === result.vaultId)) {
              pendingCreatesRef.current.delete(result.vaultId);
              pendingCreateGroupsRef.current.delete(result.vaultId);
            }
          })();
        },
        onError: () => {
          const pendingEffect = pendingCreateGroupsRef.current.get(result.vaultId);
          pendingCreatesRef.current.delete(result.vaultId);
          pendingCreateGroupsRef.current.delete(result.vaultId);
          sessionWritesRef.current.delete(result.vaultId);
          setVaults((current) => current.filter((vault) => vault.id !== result.vaultId));
          if (pendingEffect) {
            setGroups((current) => rollbackPendingCreateGroupEffect(current, pendingEffect));
          }
        },
      },
    );

    if (!started) {
      const pendingEffect = pendingCreateGroupsRef.current.get(result.vaultId);
      pendingCreatesRef.current.delete(result.vaultId);
      pendingCreateGroupsRef.current.delete(result.vaultId);
      sessionWritesRef.current.delete(result.vaultId);
      setVaults((current) => current.filter((vault) => vault.id !== result.vaultId));
      if (pendingEffect) {
        setGroups((current) => rollbackPendingCreateGroupEffect(current, pendingEffect));
      }
      throw new RpcError(
        VAULT_ERROR_CODES.VAULT_ALREADY_EXISTS,
        `vault already exists: ${result.vaultId}`,
      );
    }
  };

  return {
    t,
    settings,
    patchSettings,
    show,
    dismiss,
    message,
    openFromVault,
    setMeasuredHeaderHeight,
    ...state,
    ...modals,
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
  };
}
