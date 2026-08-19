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
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromBackup,
  createDraftFromImportArchive,
  displayNameToGroupId,
  filterVisibleVaults,
  shouldRecordVaultHidden,
  storageModeSealOnly,
  type GroupedVaultSortMode,
  type VaultListSort,
  type VaultListSortDirection,
  type VaultListViewMode,
} from "@upriv/shared";
import { useFileManager } from "@/features/vaults/file-manager";
import { useTranslation } from "@/i18n";
import { useVaultLifecycleActions } from "@/features/vaults/lifecycle";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useLoadingBudget } from "@/hooks/useLoadingBudget";
import { useDaemonReady } from "@/lib/useDaemonReady";
import { useVaultListState } from "./useVaultListState";
import { useVaultListModals } from "./useVaultListModals";
import { useVaultArchiveDrop } from "./useVaultArchiveDrop";

export function useVaultListScreen() {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const vaultGroupService = useVaultGroupService();
  const logService = useLogService();
  const { openFromVault, syncWithVaultList, purgeForVaultClose, maximizedVaultId } =
    useFileManager();
  const { settings, patchSettings, showHiddenVaultsSession } = useAppSettingsContext();
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
  /** Shared across root reorder + assign/ungroup + create-vault group apply. */
  const groupsMutateGenRef = useRef(0);
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

  const reloadVaults = useCallback(() => vaultService.listVaults(), [vaultService]);

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
      void vaultGroupService
        .reorderGroupedVaults(groupId, groupedVaults)
        .then(() => vaultGroupService.list())
        .then((listed) => {
          if (groupedOrderGenRef.current.get(groupId) !== generation) return;
          applyGroupListResultRef.current(listed);
        })
        .catch((error) => {
          if (groupedOrderGenRef.current.get(groupId) !== generation) return;
          showError(error, "error.unexpected");
          void vaultGroupService
            .list()
            .then((result) => {
              if (groupedOrderGenRef.current.get(groupId) !== generation) return;
              applyGroupListResultRef.current(result);
            })
            .catch((listError) => {
              if (groupedOrderGenRef.current.get(groupId) !== generation) return;
              showError(listError, "error.unexpected");
            });
        });
    },
    [showError, vaultGroupService],
  );

  const persistRootGroupOrder = useCallback(
    (orders: { id: string; order: number }[]) => {
      if (orders.length === 0) return;
      const generation = ++groupsMutateGenRef.current;
      void vaultGroupService
        .reorder(orders)
        .then(() => vaultGroupService.list())
        .then((listed) => {
          if (groupsMutateGenRef.current !== generation) return;
          applyGroupListResultRef.current(listed);
        })
        .catch((error) => {
          if (groupsMutateGenRef.current !== generation) return;
          showError(error, "error.unexpected");
          void vaultGroupService
            .list()
            .then((result) => {
              if (groupsMutateGenRef.current !== generation) return;
              applyGroupListResultRef.current(result);
            })
            .catch((listError) => {
              if (groupsMutateGenRef.current !== generation) return;
              showError(listError, "error.unexpected");
            });
        });
    },
    [showError, vaultGroupService],
  );

  const persistVaultAssignedToGroup = useCallback(
    (targetGroupId: string, groupedVaults: string[]) => {
      const generation = ++groupsMutateGenRef.current;
      void vaultGroupService
        .update({ id: targetGroupId, groupedVaults })
        .then(() => vaultGroupService.list())
        .then((listed) => {
          if (groupsMutateGenRef.current !== generation) return;
          applyGroupListResultRef.current(listed);
        })
        .catch((error) => {
          if (groupsMutateGenRef.current !== generation) return;
          showError(error, "error.unexpected");
          void vaultGroupService
            .list()
            .then((result) => {
              if (groupsMutateGenRef.current !== generation) return;
              applyGroupListResultRef.current(result);
            })
            .catch((listError) => {
              if (groupsMutateGenRef.current !== generation) return;
              showError(listError, "error.unexpected");
            });
        });
    },
    [showError, vaultGroupService],
  );

  const listState = useVaultListState([], {
    ...listDefaults,
    showHiddenVaults,
    reloadVaults,
    onGroupedVaultsReordered: persistGroupedVaultOrder,
    onRootGroupsReordered: persistRootGroupOrder,
    allowDragVaultIntoGroup: settings.ui.allow_drag_vault_into_group !== false,
    onVaultAssignedToGroup: persistVaultAssignedToGroup,
  });

  const {
    isReady,
    initializeVaults,
    initializeGroups,
    vaults,
    groups,
    groupsInvalid,
    groupsInvalidDismissed,
    setGroupsInvalidDismissed,
    displayRows,
    displayVaults,
    sort,
    setSort,
    viewMode,
    setViewMode,
    canReorder,
    allowDragVaultIntoGroup,
    draggingId,
    dragOverId,
    updateNote,
    removeVault,
    addVault,
    setVaultRuntimeState,
    updateVaultSettings,
    setGroupCollapsed,
    onDragEnd,
    onDragLeave,
    onRootDragStart,
    onRootDragOver,
    onRootDrop,
    onUngroupDragOver,
    onUngroupDrop,
    onMemberDragStart,
    onMemberDragOver,
    onMemberDrop,
  } = listState;

  const applyGroupListResult = useCallback(
    (result: {
      groups: import("@upriv/shared").VaultGroup[];
      invalid: boolean;
      droppedOrphans?: number;
      droppedDuplicateAssignments?: number;
    }) => {
      initializeGroups(result.groups, result.invalid);
      const orphans = result.droppedOrphans ?? 0;
      const duplicates = result.droppedDuplicateAssignments ?? 0;
      if (orphans > 0 || duplicates > 0) {
        setGroupsSanitizeNotice({ orphans, duplicates });
      } else {
        setGroupsSanitizeNotice(null);
      }
    },
    [initializeGroups],
  );
  applyGroupListResultRef.current = applyGroupListResult;

  const reloadGroups = useCallback(async () => {
    const result = await vaultGroupService.list();
    applyGroupListResult(result);
  }, [applyGroupListResult, vaultGroupService]);

  const { isRefreshing, refresh } = useAppRefresh({
    applyVaultList: initializeVaults,
    onError: (error) => showError(error, "toast.refresh_failed"),
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([vaultService.listVaults(), vaultGroupService.list()])
      .then(([rows, groupResult]) => {
        if (cancelled) return;
        initializeVaults(rows);
        applyGroupListResult(groupResult);
        syncWithVaultList(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        showError(error, "toast.refresh_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [
    applyGroupListResult,
    initializeVaults,
    showError,
    syncWithVaultList,
    vaultGroupService,
    vaultService,
  ]);

  const modals = useVaultListModals(vaults, groups);

  const lifecycle = useVaultLifecycleActions({
    vaults,
    setVaultRuntimeState,
    modals,
    showToast,
    showError,
    dismissToast,
    t,
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
    (result: CreateVaultResult) => {
      addVault({
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
      });
      recordVaultHiddenIfNeeded(false, result.settings.vault.hidden);

      void (async () => {
        try {
          await vaultService.registerSettings(result.vaultId, result.settings);
        } catch (error) {
          showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
          return;
        }

        const assignment = result.groupAssignment;
        if (assignment.kind === "none") return;

        const generation = ++groupsMutateGenRef.current;
        try {
          if (assignment.kind === "create") {
            const existingIds = groups.map((g) => g.id);
            const id = displayNameToGroupId(assignment.displayName, existingIds);
            await vaultGroupService.create({
              id,
              displayName: assignment.displayName,
              groupedVaults: [result.vaultId],
            });
          } else {
            const target = groups.find((g) => g.id === assignment.groupId);
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
          if (groupsMutateGenRef.current !== generation) return;
          const listed = await vaultGroupService.list();
          if (groupsMutateGenRef.current !== generation) return;
          applyGroupListResult(listed);
        } catch (error) {
          if (groupsMutateGenRef.current !== generation) return;
          showError(error, "error.unexpected");
          try {
            await reloadGroups();
          } catch {
            // Keep the original group-assign error for the toast.
          }
        }
      })();
    },
    [
      addVault,
      applyGroupListResult,
      groups,
      recordVaultHiddenIfNeeded,
      reloadGroups,
      showError,
      t,
      vaultGroupService,
      vaultService,
    ],
  );

  const handleVaultSettingsSaved = useCallback(
    (vaultId: string, patch: Parameters<typeof updateVaultSettings>[1]) => {
      const previous = vaults.find((vault) => vault.id === vaultId);
      updateVaultSettings(vaultId, patch);
      recordVaultHiddenIfNeeded(previous?.hidden, patch.hidden);
      if (previous && previous.storageMode !== patch.storageMode) {
        purgeForVaultClose(vaultId);
        if (previous.session === "open") {
          setVaultRuntimeState(vaultId, {
            session: null,
            persistence: storageModeSealOnly(patch.storageMode) ? "sealed" : "closed",
            canSeal: patch.canSeal,
          });
          showToast(t("warning.storage_mode_requires_close"));
        }
      }
    },
    [
      purgeForVaultClose,
      recordVaultHiddenIfNeeded,
      setVaultRuntimeState,
      showToast,
      t,
      updateVaultSettings,
      vaults,
    ],
  );

  const handleCreateVaultFromBackup = useCallback(
    (filename: string) => {
      if (!modals.backupVault) return;
      modals.setCreateVaultInitialDraft(
        createDraftFromBackup(filename, modals.backupVault.id, existingOrders),
      );
      modals.setCreateVaultInitialStep(null);
      modals.setBackupVaultId(null);
      modals.setCreateVaultOpen(true);
    },
    [existingOrders, modals],
  );

  const openCreateVaultWithDraft = useCallback(
    (draft: ReturnType<typeof createDraftFromImportArchive>, step: "source" | null = "source") => {
      modals.setCreateVaultInitialDraft(draft);
      modals.setCreateVaultInitialStep(step);
      modals.setCreateVaultOpen(true);
    },
    [modals],
  );

  const handleCreateFromScratch = useCallback(() => {
    openCreateVaultWithDraft(createDraftForScratchSource(existingOrders), "source");
  }, [existingOrders, openCreateVaultWithDraft]);

  const handleImportArchive = useCallback(() => {
    openCreateVaultWithDraft(createDraftForImportSource(existingOrders), "source");
  }, [existingOrders, openCreateVaultWithDraft]);

  const handleDroppedSevenZip = useCallback(
    (file: File, absolutePath?: string) => {
      openCreateVaultWithDraft(
        createDraftFromImportArchive(file.name, existingOrders, { filePath: absolutePath }),
        "source",
      );
    },
    [existingOrders, openCreateVaultWithDraft],
  );

  const handleRejectNonSevenZipDrop = useCallback(() => {
    showToast(t("empty.drop_archive_rejected"));
  }, [showToast, t]);

  const blockingUiOpen = Boolean(
    modals.createVaultOpen ||
    modals.settingsGroupId ||
    modals.groupAssignmentVaultId ||
    modals.appSettingsOpen ||
    modals.dataFolderOpen ||
    modals.logsOpen ||
    modals.helpOpen ||
    modals.noteVaultId ||
    modals.backupVaultId ||
    modals.settingsVaultId ||
    modals.lifecycleRequest ||
    modals.recoveryVaultId ||
    maximizedVaultId ||
    lifecycle.pipeline.run?.foreground,
  );

  const archiveDrop = useVaultArchiveDrop({
    enabled: !blockingUiOpen,
    onAcceptSevenZip: handleDroppedSevenZip,
    onRejectNonSevenZip: handleRejectNonSevenZipDrop,
  });

  const handleNoteChange = useCallback(
    (vaultId: string, note: string) => {
      updateNote(vaultId, note);
      const nextGeneration = (noteSaveGenerationRef.current.get(vaultId) ?? 0) + 1;
      noteSaveGenerationRef.current.set(vaultId, nextGeneration);
      void vaultService.getSettings(vaultId).then((settings) => {
        if (!settings) return;
        if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return;
        void vaultService
          .registerSettings(vaultId, {
            ...settings,
            vault: { ...settings.vault, note },
          })
          .catch((error) => {
            if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return;
            showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
          });
      });
    },
    [showError, updateNote, vaultService],
  );

  const handleVaultDelete = useCallback(
    async (vaultId: string) => {
      if (lifecycle.pipeline.isVaultPipelineBusy(vaultId)) {
        showToast(t("toast.pipeline_busy"));
        return;
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
        return;
      }

      lifecycle.handleVaultDelete(vaultId);
      removeVault(vaultId);
      modals.setSettingsVaultId(null);
      modals.setNoteVaultId(null);
      modals.setBackupVaultId(null);
      if (modals.groupAssignmentVaultId === vaultId) {
        modals.setGroupAssignmentVaultId(null);
      }
      if (modals.lifecycleRequest?.vaultId === vaultId) {
        modals.setLifecycleRequest(null);
      }
      if (modals.recoveryVaultId === vaultId) {
        modals.setRecoveryVaultId(null);
      }
    },
    [groups, lifecycle, modals, reloadGroups, removeVault, showError, showToast, t, vaultGroupService, vaultService],
  );

  const handleCreateGroup = useCallback(
    async (displayName: string, groupedVaultIds: string[] = []) => {
      const existingIds = groups.map((g) => g.id);
      const id = displayNameToGroupId(displayName, existingIds);
      await vaultGroupService.create({
        id,
        displayName,
        groupedVaults: [...groupedVaultIds],
      });
      const listed = await vaultGroupService.list();
      applyGroupListResult(listed);
    },
    [groups, applyGroupListResult, vaultGroupService],
  );

  const handleSaveGroup = useCallback(
    async (patch: {
      displayName: string;
      order: number;
      groupedVaults: string[];
      groupedVaultSort: GroupedVaultSortMode;
      groupedVaultSortDirection: VaultListSortDirection;
    }) => {
      if (!modals.settingsGroup) return;
      await vaultGroupService.update({
        id: modals.settingsGroup.id,
        displayName: patch.displayName,
        order: patch.order,
        groupedVaults: patch.groupedVaults,
        groupedVaultSort: patch.groupedVaultSort,
        groupedVaultSortDirection: patch.groupedVaultSortDirection,
      });
      const listed = await vaultGroupService.list();
      applyGroupListResult(listed);
    },
    [applyGroupListResult, modals.settingsGroup, vaultGroupService],
  );

  const handleDeleteGroup = useCallback(async () => {
    if (!modals.settingsGroup) return;
    await vaultGroupService.delete(modals.settingsGroup.id);
    const listed = await vaultGroupService.list();
    applyGroupListResult(listed);
    modals.setSettingsGroupId(null);
  }, [applyGroupListResult, modals, vaultGroupService]);

  const handleToggleGroupCollapsed = useCallback(
    (groupId: string) => {
      const current = groups.find((g) => g.id === groupId);
      if (!current) return;
      const nextCollapsed = !current.collapsed;
      setGroupCollapsed(groupId, nextCollapsed);
      // Only patch collapsed — full upsert would overwrite local/persisted groupedVaults
      // if the service response were stale (must not wipe in-group order).
      void vaultGroupService.setCollapsed(groupId, nextCollapsed).catch((error) => {
        setGroupCollapsed(groupId, current.collapsed);
        showError(error, "error.unexpected");
      });
    },
    [groups, setGroupCollapsed, showError, vaultGroupService],
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
      const currentGroup = groups.find((g) => g.groupedVaults.includes(vaultId)) ?? null;
      if ((currentGroup?.id ?? null) === groupId) return;

      try {
        if (groupId) {
          const target = groups.find((g) => g.id === groupId);
          if (!target) {
            throw new RpcError(
              VAULT_ERROR_CODES.GROUP_NOT_FOUND,
              `group not found: ${groupId}`,
            );
          }
          // One membership write: destination exclusivity ungroups the vault from siblings.
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
        const listed = await vaultGroupService.list();
        applyGroupListResult(listed);
      } catch (error) {
        try {
          await reloadGroups();
        } catch {
          // Keep the original error for the modal.
        }
        throw error;
      }
    },
    [groups, applyGroupListResult, reloadGroups, vaultGroupService],
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
            showError(error, "toast.refresh_failed");
          }
        })();
      },
      isRefreshing,
      onOpenSystemSettings: () => {
        if (!modals.setAppSettingsOpen(true)) {
          showToast(t("toast.settings_surface_blocked_dirty"));
        }
      },
      onOpenDataFolder: () => {
        if (!modals.setDataFolderOpen(true)) {
          showToast(t("toast.data_folder_blocked_dirty"));
        }
      },
      onViewLogs: () => modals.setLogsOpen(true),
      onOpenHelp: () => modals.setHelpOpen(true),
      onNewVault: () => {
        modals.setCreateVaultInitialDraft(null);
        modals.setCreateVaultInitialStep(null);
        modals.setCreateVaultOpen(true);
      },
    },
    list: {
      vaults,
      groups,
      displayRows,
      displayVaults,
      sort,
      onSortChange: handleSortChange,
      viewMode,
      onViewModeChange: handleViewModeChange,
      pipelineListStatus: lifecycle.pipelineListStatus,
      isVaultPipelineBusy: lifecycle.pipeline.isVaultPipelineBusy,
      allVaultsHidden: false,
      canReorder,
      allowDragVaultIntoGroup,
      draggingId,
      dragOverId,
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
      onImportArchive: handleImportArchive,
      onOpenBackups: modals.setBackupVaultId,
      onOpenNote: modals.setNoteVaultId,
      onOpenSettings: modals.setSettingsVaultId,
      onOpenGroupAssignment: modals.setGroupAssignmentVaultId,
      onOpenGroupSettings: modals.setSettingsGroupId,
      onToggleGroupCollapsed: handleToggleGroupCollapsed,
      onExportVault: lifecycle.handleExportVault,
      onOpenFolder: lifecycle.handleOpenFolder,
      onLockVault: lifecycle.handleLockVault,
      onUnlockVault: lifecycle.handleUnlockVault,
      onSealVault: lifecycle.handleSealVault,
      onRootDragStart,
      onRootDragOver,
      onRootDrop,
      onUngroupDragOver,
      onUngroupDrop,
      onMemberDragStart,
      onMemberDragOver,
      onMemberDrop,
      onDragEnd,
      onDragLeave,
    },
    archiveDrop,
    lifecycle: {
      lifecycleVault: modals.lifecycleVault,
      lifecycleIntent: modals.lifecycleRequest?.intent ?? null,
      lifecycleOpen: modals.lifecycleRequest !== null,
      onLifecycleClose: () => modals.setLifecycleRequest(null),
      onLifecycleConfirm: lifecycle.handleLifecycleConfirm,
      recoveryVault: modals.recoveryVault,
      recoveryOpen: modals.recoveryVaultId !== null,
      recoverySubmitting: modals.recoverySubmitting,
      onRecoveryClose: () => {
        if (!modals.recoverySubmitting) modals.setRecoveryVaultId(null);
      },
      onRecoveryAction: lifecycle.handleRecoveryAction,
      pipelineVault: lifecycle.pipelineVault,
      pipelineClosingIntent: lifecycle.pipelineClosingIntent,
      closingOverlayOpen: Boolean(
        lifecycle.pipeline.run?.foreground && lifecycle.pipelineClosingIntent,
      ),
      openingOverlayOpen: Boolean(
        lifecycle.pipeline.run?.foreground && lifecycle.pipeline.run?.kind === "open",
      ),
      activeStep: lifecycle.pipeline.run?.activeStep ?? 0,
      errorKey: lifecycle.pipeline.run?.errorKey ?? null,
      onPipelineBackground: lifecycle.handlePipelineBackground,
      onDismissPipelineError: lifecycle.pipeline.dismissFailure,
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
    settings: {
      vault: modals.settingsVault,
      open: modals.settingsVaultId !== null,
      onClose: () => modals.setSettingsVaultId(null),
      onVaultSettingsSaved: handleVaultSettingsSaved,
      onVaultDelete: handleVaultDelete,
      groups,
      onCommitGroupAssignment: async (
        vaultId: string,
        assignment: CreateVaultGroupAssignment,
      ) => {
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
    groupAssignment: {
      vault: modals.groupAssignmentVault,
      open: modals.groupAssignmentVaultId !== null,
      onClose: () => modals.setGroupAssignmentVaultId(null),
      onAssign: handleVaultGroupAssignmentChange,
      groups,
    },
    groupSettings: {
      group: modals.settingsGroup,
      open: modals.settingsGroupId !== null,
      onClose: () => modals.setSettingsGroupId(null),
      onSave: handleSaveGroup,
      onDelete: handleDeleteGroup,
      vaults: visibleVaults,
      includeHidden: showHiddenVaults,
      groups,
    },
    appSettings: {
      open: modals.appSettingsOpen,
      vaults: visibleVaults,
      groups,
      includeHidden: showHiddenVaults,
      onCreateGroup: handleCreateGroup,
      onClose: () => {
        void modals.setAppSettingsOpen(false);
      },
      onDirtyChange: modals.setAppSettingsDirty,
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
