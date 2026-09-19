import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVaultGroupService, useLogService, useVaultService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useAppRefresh } from "@/features/system/refresh";
import type { CreateVaultGroupAssignment, CreateVaultResult } from "@upriv/shared";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  LOADING_BUDGET_MS,
  RpcError,
  VAULT_ERROR_CODES,
  VAULT_LIST_SEARCH_PERSIST_MS,
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromBackup,
  applyPendingCreateGroupEffect,
  buildCreatingVaultListItem,
  buildPendingCreateGroupEffect,
  createDraftFromImportPackage,
  displayNameToGroupId,
  mergePendingCreatingGroups,
  mergePendingCreatingVaults,
  pendingCreateGroupId,
  rollbackPendingCreateGroupEffect,
  filterVisibleVaults,
  filterVaultListRowsBySearch,
  normalizeVaultListSearch,
  shouldBumpVaultRootEpoch,
  isVaultRootGoneError,
  shouldRecordVaultHidden,
  vaultIdsInHiddenGroups,
  vaultIdsUnhiddenByGroups,
  type GroupedVaultSortMode,
  type PendingCreateGroupEffect,
  type VaultListItem,
  type VaultListSort,
  type VaultListSortDirection,
  type VaultListViewMode,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { useFileManager } from "@/features/vaults/file-manager";
import { useTranslation } from "@/i18n";
import { useVaultLifecycleActions } from "@/features/vaults/lifecycle";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useLoadingBudget } from "@upriv/shared/react";
import { useDaemonReady } from "@/lib/useDaemonReady";
import { useVaultListState } from "./useVaultListState";
import { useVaultListModals } from "./useVaultListModals";
import { useVaultImportDrop } from "./useVaultImportDrop";

export function useVaultListScreen() {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const vaultGroupService = useVaultGroupService();
  const logService = useLogService();
  const { openFromVault, syncWithVaultList, maximizedVaultId } = useFileManager();
  const {
    settings,
    patchSettings,
    showHiddenVaultsSession,
    reportVaultRootIntegrityFailure,
    settingsOnDisk,
    vaultRootEpoch,
  } = useAppSettingsContext();
  const showHiddenVaults = settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const {
    message: toastMessage,
    show: showToast,
    showError,
    dismiss: dismissToast,
  } = useErrorToast();
  const daemonReady = useDaemonReady();
  const noteSaveGenerationRef = useRef<Map<string, number>>(new Map());
  const groupedOrderGenRef = useRef<Map<string, number>>(new Map());
  const groupCollapsedGenRef = useRef<Map<string, number>>(new Map());
  /** Shared across root reorder + assign/ungroup + create-vault group apply. */
  const groupsMutateGenRef = useRef(0);
  const vaultOrderGenRef = useRef(0);
  const repairGenRef = useRef(0);
  const [groupsRepairBusy, setGroupsRepairBusy] = useState(false);
  const groupsRepairBudget = useLoadingBudget(groupsRepairBusy, LOADING_BUDGET_MS.default);
  const [groupsSanitizeNotice, setGroupsSanitizeNotice] = useState<{
    orphans: number;
    duplicates: number;
  } | null>(null);

  const listDefaults = useMemo(
    () => ({
      initialSort: {
        mode: settings.ui.vault_list_sort,
        direction: settings.ui.vault_list_sort_direction,
      },
      initialViewMode: settings.ui.vault_list_view,
    }),
    [
      settings.ui.vault_list_sort,
      settings.ui.vault_list_sort_direction,
      settings.ui.vault_list_view,
    ],
  );

  const [listSearch, setListSearch] = useState(() =>
    normalizeVaultListSearch(settings.ui.vault_list_search),
  );
  const knownPersistedSearch = useRef(normalizeVaultListSearch(settings.ui.vault_list_search));
  const listSearchRef = useRef(listSearch);
  listSearchRef.current = listSearch;

  useEffect(() => {
    const incoming = normalizeVaultListSearch(settings.ui.vault_list_search);
    if (incoming === knownPersistedSearch.current) return;
    if (listSearchRef.current === knownPersistedSearch.current) {
      setListSearch(incoming);
    }
    knownPersistedSearch.current = incoming;
  }, [settings.ui.vault_list_search]);

  useEffect(() => {
    const next = normalizeVaultListSearch(listSearch);
    if (next === knownPersistedSearch.current) return;
    const timer = window.setTimeout(() => {
      knownPersistedSearch.current = next;
      void patchSettings({ ui: { vault_list_search: next } });
    }, VAULT_LIST_SEARCH_PERSIST_MS);
    return () => window.clearTimeout(timer);
  }, [listSearch, patchSettings]);

  useEffect(() => {
    return () => {
      const next = normalizeVaultListSearch(listSearchRef.current);
      if (next === knownPersistedSearch.current) return;
      knownPersistedSearch.current = next;
      void patchSettings({ ui: { vault_list_search: next } });
    };
  }, [patchSettings]);

  const applyGroupListResultRef = useRef<
    (result: {
      groups: import("@upriv/shared").VaultGroup[];
      invalid: boolean;
      droppedOrphans?: number;
      droppedDuplicateAssignments?: number;
    }) => void
  >(() => {});

  const persistGroupedVaultOrder = useCallback(
    (groupId: string, groupedVaults: string[]) => {
      const generation = (groupedOrderGenRef.current.get(groupId) ?? 0) + 1;
      groupedOrderGenRef.current.set(groupId, generation);
      void (async () => {
        try {
          await vaultGroupService.reorderGroupedVaults(groupId, groupedVaults);
          if (groupedOrderGenRef.current.get(groupId) !== generation) return;
          const listed = await vaultGroupService.list();
          if (groupedOrderGenRef.current.get(groupId) !== generation) return;
          applyGroupListResultRef.current(listed);
        } catch (error) {
          if (groupedOrderGenRef.current.get(groupId) !== generation) return;
          showError(error, "error.unexpected");
          try {
            const result = await vaultGroupService.list();
            if (groupedOrderGenRef.current.get(groupId) !== generation) return;
            applyGroupListResultRef.current(result);
          } catch (listError) {
            if (groupedOrderGenRef.current.get(groupId) !== generation) return;
            showError(listError, "error.unexpected");
          }
        }
      })();
    },
    [showError, vaultGroupService],
  );

  const persistRootGroupOrder = useCallback(
    (orders: { id: string; order: number }[]) => {
      if (orders.length === 0) return;
      const generation = ++groupsMutateGenRef.current;
      void (async () => {
        try {
          await vaultGroupService.reorder(orders);
          if (groupsMutateGenRef.current !== generation) return;
          const listed = await vaultGroupService.list();
          if (groupsMutateGenRef.current !== generation) return;
          applyGroupListResultRef.current(listed);
        } catch (error) {
          if (groupsMutateGenRef.current !== generation) return;
          showError(error, "error.unexpected");
          try {
            const result = await vaultGroupService.list();
            if (groupsMutateGenRef.current !== generation) return;
            applyGroupListResultRef.current(result);
          } catch (listError) {
            if (groupsMutateGenRef.current !== generation) return;
            showError(listError, "error.unexpected");
          }
        }
      })();
    },
    [showError, vaultGroupService],
  );

  const persistRootVaultOrder = useCallback(
    (orders: { id: string; order: number }[]) => {
      if (orders.length === 0 || !vaultService.canPersistSettings) return;
      const generation = ++vaultOrderGenRef.current;
      void (async () => {
        try {
          for (const { id, order } of orders) {
            if (vaultOrderGenRef.current !== generation) return;
            const settings = await vaultService.getSettings(id);
            if (!settings) continue;
            if (settings.vault.order === order) continue;
            await vaultService.registerSettings(id, {
              ...settings,
              vault: { ...settings.vault, order },
            });
          }
        } catch (error) {
          if (vaultOrderGenRef.current !== generation) return;
          showError(error, "error.unexpected");
        }
      })();
    },
    [showError, vaultService],
  );

  const persistVaultAssignedToGroup = useCallback(
    (targetGroupId: string, groupedVaults: string[]) => {
      const generation = ++groupsMutateGenRef.current;
      void (async () => {
        try {
          await vaultGroupService.update({ id: targetGroupId, groupedVaults });
          if (groupsMutateGenRef.current !== generation) return;
          const listed = await vaultGroupService.list();
          if (groupsMutateGenRef.current !== generation) return;
          applyGroupListResultRef.current(listed);
        } catch (error) {
          if (groupsMutateGenRef.current !== generation) return;
          showError(error, "error.unexpected");
          try {
            const result = await vaultGroupService.list();
            if (groupsMutateGenRef.current !== generation) return;
            applyGroupListResultRef.current(result);
          } catch (listError) {
            if (groupsMutateGenRef.current !== generation) return;
            showError(listError, "error.unexpected");
          }
        }
      })();
    },
    [showError, vaultGroupService],
  );

  const handleReorderBlocked = useCallback(
    (scope: "root" | "group" | "search") => {
      showToast(
        t(
          scope === "search"
            ? "toast.vault_list_reorder_needs_clear_search"
            : scope === "group"
              ? "toast.vault_group_reorder_needs_position_sort"
              : "toast.vault_list_reorder_needs_position_sort",
        ),
      );
    },
    [showToast, t],
  );

  const searchActive = listSearch.trim().length > 0;

  const listState = useVaultListState([], {
    ...listDefaults,
    showHiddenVaults,
    searchActive,
    onGroupedVaultsReordered: persistGroupedVaultOrder,
    onRootGroupsReordered: persistRootGroupOrder,
    onRootVaultsReordered: persistRootVaultOrder,
    vaultListShowDrag: settings.ui.vault_list_show_drag !== false,
    vaultListAllowDragIntoGroup: settings.ui.vault_list_allow_drag_into_group !== false,
    onVaultAssignedToGroup: persistVaultAssignedToGroup,
    onReorderBlocked: handleReorderBlocked,
  });

  const {
    isReady,
    initializeVaults,
    resetSessionWrites,
    initializeGroups,
    vaults,
    groups,
    groupsInvalid,
    groupsInvalidDismissed,
    setGroupsInvalidDismissed,
    displayRows,
    sort,
    setSort,
    viewMode,
    setViewMode,
    canReorder,
    vaultListShowDrag,
    vaultListAllowDragIntoGroup,
    draggingId,
    dragOverId,
    dragPointer,
    updateNote,
    removeVault,
    addVault,
    touchSessionWrite,
    setVaultRuntimeState,
    updateVaultSettings,
    markVaultsHidden,
    setGroupCollapsed,
    setGroups,
    onPointerDragStart,
    onPointerDragMove,
    onPointerDragEnd,
    onPointerDragCancel,
  } = listState;

  const pointerDrag = useMemo(
    () => ({
      onStart: onPointerDragStart,
      onMove: onPointerDragMove,
      onEnd: onPointerDragEnd,
      onCancel: onPointerDragCancel,
    }),
    [onPointerDragCancel, onPointerDragEnd, onPointerDragMove, onPointerDragStart],
  );

  useEffect(() => {
    const next = {
      mode: settings.ui.vault_list_sort,
      direction: settings.ui.vault_list_sort_direction,
    };
    setSort((prev) => (prev.mode === next.mode && prev.direction === next.direction ? prev : next));
  }, [setSort, settings.ui.vault_list_sort, settings.ui.vault_list_sort_direction]);

  useEffect(() => {
    setViewMode((prev) =>
      prev === settings.ui.vault_list_view ? prev : settings.ui.vault_list_view,
    );
  }, [setViewMode, settings.ui.vault_list_view]);

  const listRows = useMemo(
    () => filterVaultListRowsBySearch(displayRows, listSearch),
    [displayRows, listSearch],
  );
  const searchNoMatches =
    searchActive && listRows.length === 0 && (vaults.length > 0 || groups.length > 0);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const applyGroupListResult = useCallback(
    (result: {
      groups: import("@upriv/shared").VaultGroup[];
      invalid: boolean;
      droppedOrphans?: number;
      droppedDuplicateAssignments?: number;
    }) => {
      const previousGroups = groupsRef.current;
      const merged = mergePendingCreatingGroups(
        result.groups,
        pendingCreateGroupsRef.current.values(),
      );
      initializeGroups(merged, result.invalid);
      markVaultsHidden(vaultIdsUnhiddenByGroups(previousGroups, merged), false);
      markVaultsHidden(vaultIdsInHiddenGroups(merged), true);
      const orphans = result.droppedOrphans ?? 0;
      const duplicates = result.droppedDuplicateAssignments ?? 0;
      if (orphans > 0 || duplicates > 0) {
        setGroupsSanitizeNotice({ orphans, duplicates });
      } else {
        setGroupsSanitizeNotice(null);
      }
    },
    [initializeGroups, markVaultsHidden],
  );
  applyGroupListResultRef.current = applyGroupListResult;

  const reloadGroups = useCallback(async () => {
    const result = await vaultGroupService.list();
    applyGroupListResult(result);
  }, [applyGroupListResult, vaultGroupService]);

  const pendingCreatesRef = useRef<Map<string, VaultListItem>>(new Map());
  const pendingCreateGroupsRef = useRef<Map<string, PendingCreateGroupEffect>>(new Map());

  const applyVaultList = useCallback(
    (rows: VaultListItem[], fetchStartedAt: number) => {
      for (const row of rows) {
        pendingCreatesRef.current.delete(row.id);
      }
      initializeVaults(
        mergePendingCreatingVaults(rows, [...pendingCreatesRef.current.values()]),
        fetchStartedAt,
      );
    },
    [initializeVaults],
  );

  const { isRefreshing, refresh } = useAppRefresh({
    applyVaultList,
    onError: (error) => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      showError(error, "toast.refresh_failed");
    },
  });

  const prevVaultRootEpochRef = useRef(vaultRootEpoch);
  useEffect(() => {
    if (prevVaultRootEpochRef.current !== vaultRootEpoch) {
      prevVaultRootEpochRef.current = vaultRootEpoch;
      resetSessionWrites();
    }
  }, [resetSessionWrites, vaultRootEpoch]);

  useEffect(() => {
    let cancelled = false;
    const fetchStartedAt = Date.now();
    void Promise.all([vaultService.listVaults(), vaultGroupService.list()])
      .then(([rows, groupResult]) => {
        if (cancelled) return;
        applyVaultList(rows, fetchStartedAt);
        applyGroupListResult(groupResult);
      })
      .catch((error) => {
        if (cancelled) return;
        // Children stay mounted under Gate. First-run has no `.upriv` yet — do not
        // treat that as mid-session integrity (epoch bump / Setup "lost").
        if (isVaultRootGoneError(error) && !settingsOnDisk) return;
        if (shouldBumpVaultRootEpoch(error)) {
          void reportVaultRootIntegrityFailure(error);
          return;
        }
        showError(error, "toast.refresh_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [
    applyGroupListResult,
    applyVaultList,
    reportVaultRootIntegrityFailure,
    settingsOnDisk,
    showError,
    vaultGroupService,
    vaultRootEpoch,
    vaultService,
  ]);

  useEffect(() => {
    syncWithVaultList(vaults);
  }, [syncWithVaultList, vaults]);

  const modals = useVaultListModals(vaults, groups);

  const settingsPersistVaultIdsRef = useRef(new Set<string>());

  const lifecycle = useVaultLifecycleActions({
    vaults,
    setVaultRuntimeState,
    modals,
    showToast,
    showError,
    dismissToast,
    t,
    settingsPersistVaultIdsRef,
  });

  const handleSortChange = useCallback(
    (next: VaultListSort) => {
      setSort(next);
      void patchSettings({
        ui: {
          vault_list_sort: next.mode,
          vault_list_sort_direction: next.direction,
        },
      });
    },
    [patchSettings, setSort],
  );

  const handleViewModeChange = useCallback(
    (next: VaultListViewMode) => {
      setViewMode(next);
      void patchSettings({ ui: { vault_list_view: next } });
    },
    [patchSettings, setViewMode],
  );

  const existingVaultIds = useMemo(() => vaults.map((vault) => vault.id), [vaults]);
  const existingOrders = useMemo(() => vaults.map((vault) => vault.order ?? 0), [vaults]);
  const visibleVaults = useMemo(
    () => filterVisibleVaults(vaults, showHiddenVaults),
    [showHiddenVaults, vaults],
  );

  const recordVaultHiddenIfNeeded = useCallback(
    (wasHidden: boolean | undefined, isHidden: boolean | undefined) => {
      if (!shouldRecordVaultHidden(wasHidden, isHidden)) return;
      void logService.recordVaultHidden().catch(() => {
        /* Logging must never block hide. */
      });
    },
    [logService],
  );

  const handleCreateVault = useCallback(
    (result: CreateVaultResult, password: string) => {
      if (result.source === "import") {
        throw new RpcError("not_implemented", "Import and create-from-backup are not implemented");
      }
      if (
        vaults.some((vault) => vault.id === result.vaultId) ||
        lifecycle.pipeline.isVaultPipelineBusy(result.vaultId)
      ) {
        throw new RpcError(
          VAULT_ERROR_CODES.VAULT_ALREADY_EXISTS,
          `vault already exists: ${result.vaultId}`,
        );
      }

      const placeholder = buildCreatingVaultListItem(result);
      pendingCreatesRef.current.set(result.vaultId, placeholder);
      addVault(placeholder);

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
            touchSessionWrite(result.vaultId);
            recordVaultHiddenIfNeeded(false, result.settings.vault.hidden);
            void (async () => {
              const assignment = result.groupAssignment;
              if (assignment.kind !== "none") {
                const generation = ++groupsMutateGenRef.current;
                try {
                  const pendingEffect = pendingCreateGroupsRef.current.get(result.vaultId);
                  if (assignment.kind === "create") {
                    const existingIds = groupsRef.current
                      .map((g) => g.id)
                      .filter(
                        (id) => pendingEffect?.kind !== "create" || id !== pendingEffect.group.id,
                      );
                    const id =
                      pendingCreateGroupId(pendingEffect, assignment, existingIds) ??
                      displayNameToGroupId(assignment.displayName, existingIds);
                    await vaultGroupService.create({
                      id,
                      displayName: assignment.displayName,
                      groupedVaults: [result.vaultId],
                    });
                  } else {
                    const target = groupsRef.current.find((g) => g.id === assignment.groupId);
                    if (!target) {
                      throw new RpcError(
                        VAULT_ERROR_CODES.GROUP_NOT_FOUND,
                        `group not found: ${assignment.groupId}`,
                      );
                    }
                    await vaultGroupService.update({
                      id: assignment.groupId,
                      groupedVaults: [
                        ...target.groupedVaults.filter((id) => id !== result.vaultId),
                        result.vaultId,
                      ],
                    });
                  }
                  if (groupsMutateGenRef.current === generation) {
                    pendingCreateGroupsRef.current.delete(result.vaultId);
                    const listed = await vaultGroupService.list();
                    if (groupsMutateGenRef.current === generation) {
                      applyGroupListResult(listed);
                    }
                  }
                } catch (error) {
                  if (groupsMutateGenRef.current === generation) {
                    showError(error, "error.unexpected");
                    try {
                      await reloadGroups();
                    } catch {
                      // Keep the original group-assign error for the toast.
                    }
                  }
                }
              }

              try {
                const fetchStartedAt = Date.now();
                const rows = await vaultService.listVaults();
                applyVaultList(rows, fetchStartedAt);
                if (rows.some((row) => row.id === result.vaultId)) {
                  pendingCreatesRef.current.delete(result.vaultId);
                  pendingCreateGroupsRef.current.delete(result.vaultId);
                }
              } catch (error) {
                showError(error, "toast.refresh_failed");
              }
            })();
          },
          onError: () => {
            const pendingEffect = pendingCreateGroupsRef.current.get(result.vaultId);
            pendingCreatesRef.current.delete(result.vaultId);
            pendingCreateGroupsRef.current.delete(result.vaultId);
            removeVault(result.vaultId);
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
        removeVault(result.vaultId);
        if (pendingEffect) {
          setGroups((current) => rollbackPendingCreateGroupEffect(current, pendingEffect));
        }
        throw new RpcError(
          VAULT_ERROR_CODES.VAULT_ALREADY_EXISTS,
          `vault already exists: ${result.vaultId}`,
        );
      }
    },
    [
      addVault,
      applyGroupListResult,
      applyVaultList,
      lifecycle,
      recordVaultHiddenIfNeeded,
      reloadGroups,
      removeVault,
      setGroups,
      showError,
      touchSessionWrite,
      vaultGroupService,
      vaultService,
      vaults,
    ],
  );

  const settingsVaultId = modals.settingsVaultId;
  const setSettingsVaultId = modals.setSettingsVaultId;

  const handleVaultSettingsSaved = useCallback(
    (vaultId: string, patch: Parameters<typeof updateVaultSettings>[1]) => {
      const previous = vaults.find((vault) => vault.id === vaultId);
      updateVaultSettings(vaultId, patch);
      if (patch.id && patch.id !== vaultId && settingsVaultId === vaultId) {
        setSettingsVaultId(patch.id);
      }
      if (patch.id && patch.id !== vaultId && settings.app.last_opened_vault.trim() === vaultId) {
        void patchSettings({ app: { last_opened_vault: patch.id } }, { memoryOnly: true });
      }
      recordVaultHiddenIfNeeded(previous?.hidden, patch.hidden);
      if (previous && previous.storageMode !== patch.storageMode && previous.session === "open") {
        showToast(t("warning.storage_mode_requires_close"));
      }
    },
    [
      patchSettings,
      recordVaultHiddenIfNeeded,
      setSettingsVaultId,
      settings.app.last_opened_vault,
      settingsVaultId,
      showToast,
      t,
      updateVaultSettings,
      vaults,
    ],
  );

  const handleCreateVaultFromBackup = useCallback(
    (stamp: string) => {
      if (!modals.backupVault) return;
      modals.setCreateVaultInitialDraft(
        createDraftFromBackup(stamp, modals.backupVault.id, existingOrders),
      );
      modals.setCreateVaultInitialStep("source");
      modals.setBackupVaultId(null);
      modals.setCreateVaultOpen(true);
    },
    [existingOrders, modals],
  );

  const openCreateVaultWithDraft = useCallback(
    (draft: ReturnType<typeof createDraftFromImportPackage>, step: "source" | null = "source") => {
      modals.setCreateVaultInitialDraft(draft);
      modals.setCreateVaultInitialStep(step);
      modals.setCreateVaultOpen(true);
    },
    [modals],
  );

  const handleCreateFromScratch = useCallback(() => {
    openCreateVaultWithDraft(createDraftForScratchSource(existingOrders), "source");
  }, [existingOrders, openCreateVaultWithDraft]);

  const handleImportPackage = useCallback(() => {
    openCreateVaultWithDraft(createDraftForImportSource(existingOrders), "source");
  }, [existingOrders, openCreateVaultWithDraft]);

  const handleDroppedImportPackage = useCallback(
    (file: File, absolutePath?: string) => {
      openCreateVaultWithDraft(
        createDraftFromImportPackage(file.name, existingOrders, { filePath: absolutePath }),
        "source",
      );
    },
    [existingOrders, openCreateVaultWithDraft],
  );

  const handleRejectNonImportDrop = useCallback(() => {
    showToast(t("empty.drop_file_rejected"));
  }, [showToast, t]);

  const blockingUiOpen = Boolean(
    modals.createVaultOpen ||
    modals.settingsGroupId ||
    modals.appSettingsOpen ||
    modals.dataFolderOpen ||
    modals.logsOpen ||
    modals.helpOpen ||
    modals.noteVaultId ||
    modals.backupVaultId ||
    modals.settingsVaultId ||
    modals.lifecycleRequest ||
    modals.recoveryVaultId ||
    maximizedVaultId,
  );

  const importDrop = useVaultImportDrop({
    enabled: !blockingUiOpen,
    onAcceptImportPackage: handleDroppedImportPackage,
    onRejectNonImport: handleRejectNonImportDrop,
  });

  const handleNoteChange = useCallback(
    async (vaultId: string, note: string): Promise<boolean> => {
      if (!vaultService.canPersistSettings) {
        showError(
          new RpcError("not_implemented", "Vault note save is not implemented"),
          APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED,
        );
        return false;
      }
      const previous = vaults.find((item) => item.id === vaultId)?.note ?? "";
      updateNote(vaultId, note);
      const nextGeneration = (noteSaveGenerationRef.current.get(vaultId) ?? 0) + 1;
      noteSaveGenerationRef.current.set(vaultId, nextGeneration);

      try {
        const settings = await vaultService.getSettings(vaultId);
        if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
        if (!settings) {
          throw new RpcError(VAULT_ERROR_CODES.NOT_FOUND, `vault settings not found: ${vaultId}`);
        }
        await vaultService.registerSettings(vaultId, {
          ...settings,
          vault: { ...settings.vault, note },
        });
        if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
        return true;
      } catch (error) {
        if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
        updateNote(vaultId, previous);
        showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
        return false;
      }
    },
    [showError, updateNote, vaultService, vaults],
  );

  const handleVaultDelete = useCallback(
    async (vaultId: string) => {
      if (lifecycle.pipeline.isVaultPipelineBusy(vaultId)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      if (!vaultService.canDeleteVault) {
        const error = new RpcError("not_implemented", "Vault delete is not implemented");
        showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
        throw error;
      }

      try {
        const containing = groups.filter((group) => group.groupedVaults.includes(vaultId));
        for (const group of containing) {
          await vaultGroupService.update({
            id: group.id,
            groupedVaults: group.groupedVaults.filter((id) => id !== vaultId),
          });
        }
        await vaultService.unregisterSettings(vaultId);
      } catch (error) {
        showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
        try {
          await reloadGroups();
        } catch (listError) {
          showError(listError, "toast.refresh_failed");
        }
        throw error;
      }

      lifecycle.handleVaultDelete(vaultId);
      removeVault(vaultId);
      modals.setSettingsVaultId(null);
      modals.setSettingsArea(null);
      modals.setNoteVaultId(null);
      modals.setBackupVaultId(null);
      if (modals.lifecycleRequest?.vaultId === vaultId) {
        modals.setLifecycleRequest(null);
      }
      if (modals.recoveryVaultId === vaultId) {
        modals.setRecoveryVaultId(null);
      }
    },
    [
      groups,
      lifecycle,
      modals,
      reloadGroups,
      removeVault,
      showError,
      showToast,
      t,
      vaultGroupService,
      vaultService,
    ],
  );

  const handleCreateGroup = useCallback(
    async (displayName: string, groupedVaultIds: string[] = [], hidden = false) => {
      const generation = ++groupsMutateGenRef.current;
      const existingIds = groupsRef.current.map((g) => g.id);
      const id = displayNameToGroupId(displayName, existingIds);
      await vaultGroupService.create({
        id,
        displayName,
        groupedVaults: [...groupedVaultIds],
        hidden,
      });
      if (groupsMutateGenRef.current !== generation) return;
      const listed = await vaultGroupService.list();
      if (groupsMutateGenRef.current !== generation) return;
      applyGroupListResult(listed);
    },
    [applyGroupListResult, vaultGroupService],
  );

  const handleSaveGroup = useCallback(
    async (patch: {
      displayName: string;
      order: number;
      groupedVaults: string[];
      groupedVaultSort: GroupedVaultSortMode;
      groupedVaultSortDirection: VaultListSortDirection;
      hidden: boolean;
    }) => {
      if (!modals.settingsGroup) return;
      const generation = ++groupsMutateGenRef.current;
      await vaultGroupService.update({
        id: modals.settingsGroup.id,
        displayName: patch.displayName,
        order: patch.order,
        groupedVaults: patch.groupedVaults,
        groupedVaultSort: patch.groupedVaultSort,
        groupedVaultSortDirection: patch.groupedVaultSortDirection,
        hidden: patch.hidden,
      });
      if (groupsMutateGenRef.current !== generation) return;
      const listed = await vaultGroupService.list();
      if (groupsMutateGenRef.current !== generation) return;
      applyGroupListResult(listed);
    },
    [applyGroupListResult, modals.settingsGroup, vaultGroupService],
  );

  const handleDeleteGroup = useCallback(async () => {
    if (!modals.settingsGroup) return;
    const generation = ++groupsMutateGenRef.current;
    await vaultGroupService.delete(modals.settingsGroup.id);
    if (groupsMutateGenRef.current !== generation) return;
    const listed = await vaultGroupService.list();
    if (groupsMutateGenRef.current !== generation) return;
    applyGroupListResult(listed);
    modals.setSettingsGroupId(null);
  }, [applyGroupListResult, modals, vaultGroupService]);

  const handleToggleGroupCollapsed = useCallback(
    (groupId: string) => {
      const current = groups.find((g) => g.id === groupId);
      if (!current) return;
      const nextCollapsed = !current.collapsed;
      const generation = (groupCollapsedGenRef.current.get(groupId) ?? 0) + 1;
      groupCollapsedGenRef.current.set(groupId, generation);
      setGroupCollapsed(groupId, nextCollapsed);
      // Only patch collapsed — full upsert would overwrite local/persisted groupedVaults
      // if the service response were stale (must not wipe in-group order).
      void vaultGroupService.setCollapsed(groupId, nextCollapsed).catch((error) => {
        if (groupCollapsedGenRef.current.get(groupId) !== generation) return;
        const mutateGen = ++groupsMutateGenRef.current;
        showError(error, "error.unexpected");
        void vaultGroupService
          .list()
          .then((listed) => {
            if (groupCollapsedGenRef.current.get(groupId) !== generation) return;
            if (groupsMutateGenRef.current !== mutateGen) return;
            applyGroupListResult(listed);
          })
          .catch((listError) => {
            if (groupCollapsedGenRef.current.get(groupId) !== generation) return;
            if (groupsMutateGenRef.current !== mutateGen) return;
            showError(listError, "error.unexpected");
          });
      });
    },
    [applyGroupListResult, groups, setGroupCollapsed, showError, vaultGroupService],
  );

  const handleRepairGroups = useCallback(async () => {
    const generation = ++repairGenRef.current;
    setGroupsRepairBusy(true);
    try {
      await vaultGroupService.repair();
      if (generation !== repairGenRef.current) return;
      await reloadGroups();
    } catch (error) {
      if (generation !== repairGenRef.current) return;
      showError(error, "error.unexpected");
    } finally {
      if (generation === repairGenRef.current) setGroupsRepairBusy(false);
    }
  }, [reloadGroups, showError, vaultGroupService]);

  useEffect(() => {
    if (!groupsRepairBudget.timedOut || !groupsRepairBusy) return;
    repairGenRef.current += 1;
    setGroupsRepairBusy(false);
    showError(
      new RpcError("rpc_timeout", "vault_group_repair timed out"),
      "error.operation_timed_out",
    );
  }, [groupsRepairBudget.timedOut, groupsRepairBusy, showError]);

  const handleVaultGroupAssignmentChange = useCallback(
    async (vaultId: string, groupId: string | null) => {
      const currentGroups = groupsRef.current;
      const currentGroup = currentGroups.find((g) => g.groupedVaults.includes(vaultId)) ?? null;
      if ((currentGroup?.id ?? null) === groupId) return;
      const generation = ++groupsMutateGenRef.current;

      try {
        if (groupId) {
          const target = currentGroups.find((g) => g.id === groupId);
          if (!target) {
            throw new RpcError(VAULT_ERROR_CODES.GROUP_NOT_FOUND, `group not found: ${groupId}`);
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
        if (groupsMutateGenRef.current !== generation) return;
        const listed = await vaultGroupService.list();
        if (groupsMutateGenRef.current !== generation) return;
        applyGroupListResult(listed);
      } catch (error) {
        if (groupsMutateGenRef.current === generation) {
          try {
            await reloadGroups();
          } catch {
            // Keep the original error for the modal.
          }
        }
        throw error;
      }
    },
    [applyGroupListResult, reloadGroups, vaultGroupService],
  );

  return {
    isReady: isReady && daemonReady,
    openFromVault,
    header: {
      onRefresh: () => {
        void (async () => {
          await refresh();
          if (modals.settingsGroupId) {
            showToast(t("toast.groups_refresh_blocked_settings"));
            return;
          }
          try {
            await reloadGroups();
          } catch (error) {
            if (shouldBumpVaultRootEpoch(error)) {
              void reportVaultRootIntegrityFailure(error);
              return;
            }
            showError(error, "toast.refresh_failed");
          }
        })();
      },
      isRefreshing,
      onOpenSystemSettings: () => {
        if (!modals.setAppSettingsOpen(true)) {
          showToast(
            t(
              modals.groupsDirty
                ? "toast.groups_surface_blocked_dirty"
                : "toast.data_folder_blocked_dirty",
            ),
          );
        }
      },
      onOpenGroups: () => {
        if (!modals.setGroupsOpen(true)) {
          showToast(
            t(
              modals.dataFolderDirty
                ? "toast.data_folder_blocked_dirty"
                : "toast.settings_surface_blocked_dirty",
            ),
          );
        }
      },
      onOpenDataFolder: () => {
        if (!modals.setDataFolderOpen(true)) {
          showToast(
            t(
              modals.groupsDirty
                ? "toast.groups_surface_blocked_dirty"
                : "toast.settings_surface_blocked_dirty",
            ),
          );
        }
      },
      onViewLogs: () => modals.setLogsOpen(true),
      onOpenHelp: () => modals.setHelpOpen(true),
      onOpenSystemInfo: () => modals.setSystemInfoOpen(true),
    },
    list: {
      vaults,
      groups,
      displayRows: listRows,
      sort,
      onSortChange: handleSortChange,
      viewMode,
      onViewModeChange: handleViewModeChange,
      search: listSearch,
      onSearchChange: setListSearch,
      onNewVault: () => {
        openCreateVaultWithDraft(createDraftForScratchSource(existingOrders), "source");
      },
      pipelineListStatus: lifecycle.pipelineListStatus,
      isVaultPipelineBusy: lifecycle.pipeline.isVaultPipelineBusy,
      allVaultsHidden: !searchActive && vaults.length > 0 && visibleVaults.length === 0,
      searchNoMatches,
      canReorder,
      vaultListShowDrag,
      vaultListAllowDragIntoGroup,
      draggingId,
      dragOverId,
      dragPointer,
      pointerDrag,
      groupsInvalid: groupsInvalid && !groupsInvalidDismissed,
      groupsSanitizeNotice,
      groupsRepairBusy,
      groupsRepairBudget: {
        visible: groupsRepairBudget.visible,
        budgetMs: groupsRepairBudget.budgetMs,
        remainingMs: groupsRepairBudget.remainingMs,
      },
      onRepairGroups: () => {
        void handleRepairGroups();
      },
      onDismissGroupsInvalid: () => setGroupsInvalidDismissed(true),
      onDismissGroupsSanitizeNotice: () => setGroupsSanitizeNotice(null),
      onCreateFromScratch: handleCreateFromScratch,
      onImportPackage: handleImportPackage,
      onOpenBackups: modals.setBackupVaultId,
      onOpenNote: modals.setNoteVaultId,
      onOpenVaultInfo: modals.setVaultInfoVaultId,
      onOpenSettings: (vaultId: string, area: VaultSettingsAreaId) => {
        modals.setSettingsVaultId(vaultId);
        modals.setSettingsArea(area);
      },
      onOpenGroupSettings: modals.setSettingsGroupId,
      onToggleGroupCollapsed: handleToggleGroupCollapsed,
      onExportVault: lifecycle.handleExportVault,
      onLockVault: lifecycle.handleLockVault,
      onUnlockVault: lifecycle.handleUnlockVault,
    },
    importDrop,
    lifecycle: {
      lifecycleVault: modals.lifecycleVault,
      lifecycleIntent: modals.lifecycleRequest?.intent ?? null,
      lifecycleOpen: modals.lifecycleRequest !== null,
      lifecycleSubmitting: lifecycle.credentialBusy,
      lifecyclePipelineStep:
        lifecycle.pipeline.run && lifecycle.pipeline.run.vaultId === modals.lifecycleVault?.id
          ? lifecycle.pipeline.run.activeStep
          : 0,
      lifecycleBudgetStartedAt:
        lifecycle.pipeline.run && lifecycle.pipeline.run.vaultId === modals.lifecycleVault?.id
          ? lifecycle.pipeline.run.startedAt
          : undefined,
      lifecycleVerifyErrorKey: lifecycle.credentialErrorKey,
      lifecycleFieldPassword: lifecycle.credentialFieldPassword,
      onLifecycleClose: () => {
        lifecycle.abandonCredentialVerify();
        modals.setLifecycleRequest(null);
      },
      onLifecycleConfirm: lifecycle.handleLifecycleConfirm,
      recoveryVault: modals.recoveryVault,
      recoveryOpen: modals.recoveryVaultId !== null,
      recoverySubmitting: modals.recoverySubmitting,
      onRecoveryClose: () => {
        if (!modals.recoverySubmitting) modals.setRecoveryVaultId(null);
      },
      onRecoveryAction: lifecycle.handleRecoveryAction,
      workspaceSetupOpen: lifecycle.workspaceSetupOpen,
      workspaceSetupRootPath: lifecycle.workspaceSetupRootPath,
      onWorkspaceSetupCancel: lifecycle.handleWorkspaceSetupCancel,
      onWorkspaceSetupConfigured: lifecycle.handleWorkspaceSetupConfigured,
    },
    toast: {
      message: toastMessage,
      onDismiss: dismissToast,
    },
    note: {
      vault: modals.noteVault,
      open: modals.noteVaultId !== null,
      onClose: () => modals.setNoteVaultId(null),
      onNoteChange: handleNoteChange,
    },
    backups: {
      vault: modals.backupVault,
      open: modals.backupVaultId !== null,
      onClose: () => modals.setBackupVaultId(null),
      onCreateVaultFromBackup: handleCreateVaultFromBackup,
    },
    exportVault: {
      vault: modals.exportVault,
      open: modals.exportVaultId !== null,
      submitting: modals.exportSubmitting,
      onClose: () => {
        if (!modals.exportSubmitting) modals.setExportVaultId(null);
      },
      onConfirm: lifecycle.handleConfirmExportVault,
      onTimeout: lifecycle.handleExportTimeout,
    },
    settings: {
      vault: modals.settingsVault,
      area: modals.settingsArea,
      open: modals.settingsVaultId !== null && modals.settingsArea !== null,
      onClose: () => {
        modals.setSettingsVaultId(null);
        modals.setSettingsArea(null);
      },
      onVaultSettingsSaved: handleVaultSettingsSaved,
      onPersistBusyChange: (vaultIds: readonly string[] | null) => {
        settingsPersistVaultIdsRef.current = new Set(vaultIds ?? []);
      },
      onVaultDelete: handleVaultDelete,
      groups,
      onCommitGroupAssignment: async (vaultId: string, assignment: CreateVaultGroupAssignment) => {
        if (assignment.kind === "create") {
          await handleCreateGroup(assignment.displayName, [vaultId]);
          return;
        }
        await handleVaultGroupAssignmentChange(
          vaultId,
          assignment.kind === "existing" ? assignment.groupId : null,
        );
      },
    },
    groupSettings: {
      group: modals.settingsGroup,
      open: modals.settingsGroupId !== null,
      onClose: () => modals.setSettingsGroupId(null),
      onSave: handleSaveGroup,
      onDelete: handleDeleteGroup,
      onBusyTimeout: () => {
        groupsMutateGenRef.current += 1;
      },
      vaults: visibleVaults,
      includeHidden: showHiddenVaults,
      groups,
    },
    appSettings: {
      open: modals.appSettingsOpen,
      onClose: () => {
        void modals.setAppSettingsOpen(false);
      },
      onDirtyChange: modals.setAppSettingsDirty,
    },
    groupsModal: {
      open: modals.groupsOpen,
      vaults: visibleVaults,
      groups,
      includeHidden: showHiddenVaults,
      onCreateGroup: handleCreateGroup,
      onClose: () => {
        void modals.setGroupsOpen(false);
      },
      onDirtyChange: modals.setGroupsDirty,
    },
    dataFolder: {
      open: modals.dataFolderOpen,
      onClose: () => {
        void modals.setDataFolderOpen(false);
      },
      onDirtyChange: modals.setDataFolderDirty,
    },
    logs: {
      open: modals.logsOpen,
      onClose: () => modals.setLogsOpen(false),
    },
    help: {
      open: modals.helpOpen,
      onClose: () => modals.setHelpOpen(false),
    },
    systemInfo: {
      open: modals.systemInfoOpen,
      onClose: () => modals.setSystemInfoOpen(false),
    },
    vaultInfo: {
      vault: modals.vaultInfoVault,
      open: modals.vaultInfoVaultId !== null,
      onClose: () => modals.setVaultInfoVaultId(null),
    },
    createVault: {
      open: modals.createVaultOpen,
      existingVaultIds,
      existingOrders,
      groups,
      initialDraft: modals.createVaultInitialDraft,
      initialStep: modals.createVaultInitialStep,
      onClose: modals.closeCreateVault,
      onCreate: handleCreateVault,
    },
  };
}
