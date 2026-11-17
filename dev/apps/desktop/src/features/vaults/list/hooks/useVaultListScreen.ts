import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBackupService,
  useDataFolderService,
  useJobService,
  useVaultGroupService,
  useLogService,
  useVaultLifecycleService,
  useVaultSecurityService,
  useVaultService,
} from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useAppRefresh } from "@/features/system/refresh";
import type { CreateVaultGroupAssignment, CreateVaultResult } from "@upriv/shared";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  RpcError,
  VAULT_ERROR_CODES,
  VAULT_LIST_SEARCH_PERSIST_MS,
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromBackup,
  groupIdContainingVault,
  applyPendingCreateGroupEffect,
  buildCreatingVaultListItem,
  buildPendingCreateGroupEffect,
  buildVaultWelcomeFiles,
  createDraftFromImportPackage,
  createVaultImportPackage,
  dataFolderCanExport,
  fileNameOfPath,
  vaultCanSaveBackupNow,
  vaultDeleteHold,
  isVaultDeleteUnfinished,
  resolveVaultListStatus,
  vaultRowControls,
  vaultRebuiltToast,
  vaultRowJobWork,
  vaultStatusLabelKey,
  VAULT_DELETE_HOLD_I18N_KEY,
  displayNameToGroupId,
  resolveVaultDisplayStatus,
  mergePendingCreatingGroups,
  mergePendingCreatingVaults,
  pendingCreateGroupId,
  rollbackPendingCreateGroupEffect,
  filterVisibleVaults,
  filterVaultListRowsBySearch,
  normalizeVaultListSearch,
  shouldBumpVaultRootEpoch,
  isVaultRootGoneError,
  switchesMessage,
  shouldRecordVaultHidden,
  vaultIdsInHiddenGroups,
  vaultIdsUnhiddenByGroups,
  type KeyCopies,
  type VaultBackupEntry,
  type GroupedVaultSortMode,
  type PendingCreateGroupEffect,
  type VaultExportRun,
  type VaultListItem,
  type VaultListSort,
  type VaultListSortDirection,
  type VaultListViewMode,
  type VaultSettingsAreaId,
} from "@upriv/shared";
import { useFileManager } from "@/features/vaults/file-manager";
import { useTranslation, type I18nKey } from "@/i18n";
import { useVaultLifecycleActions } from "@/features/vaults/lifecycle";
import { useErrorToast } from "@/hooks/useErrorToast";
import {
  useBackupExportJob,
  useDataFolderExportJob,
  useFileManagerSelector,
  useOperationLimit,
  usePasswordChangeJob,
  useUnfinishedSweep,
  useUnlockRamChangeJob,
  useVaultBackupJob,
  useVaultDeleteJob,
  useVaultRebuildJob,
  type PasswordChangeOutcome,
  type UnlockRamChangeOutcome,
} from "@upriv/shared/react";
import { useDaemonReady } from "@/lib/useDaemonReady";
import { publishRunningWork, type RunningWorkItem } from "@/lib/runningWork";
import { useQuitCloseProgress } from "./useQuitCloseProgress";
import { useVaultListState } from "./useVaultListState";
import { useVaultListModals } from "./useVaultListModals";
import { useVaultImportDrop } from "./useVaultImportDrop";
import { useExportFolder } from "@/hooks/useExportFolder";
import { useVaultExportFolders } from "./useVaultExportFolders";
import type { VaultListDropSource } from "../lib/vaultImportDrop";

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function useVaultListScreen() {
  const { t, locale } = useTranslation();
  const vaultService = useVaultService();
  const vaultGroupService = useVaultGroupService();
  const logService = useLogService();
  const { openFromVault, syncWithVaultList, cancelImports } = useFileManager();
  const fileManagerMaximized = useFileManagerSelector((state) => state.maximizedVaultId !== null);
  /** Vaults whose file manager is importing files; the quit overlay lists them. */
  const importingVaultIds = useFileManagerSelector(
    (state) =>
      Object.values(state.entries)
        .filter((entry) => entry.importInFlight)
        .map((entry) => entry.vaultId),
    sameIds,
  );
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
    toast: toastState,
    show: showToast,
    showError: baseShowError,
    dismiss: dismissToast,
  } = useErrorToast();
  const showError = useCallback(
    (error: unknown, fallback: I18nKey = "error.unexpected") => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      baseShowError(error, fallback);
    },
    [baseShowError, reportVaultRootIntegrityFailure],
  );
  const daemonReady = useDaemonReady();
  const noteSaveGenerationRef = useRef<Map<string, number>>(new Map());
  const blockOpenVaultIdsRef = useRef(new Set<string>());
  const groupedOrderGenRef = useRef<Map<string, number>>(new Map());
  const rowControlsRef = useRef(new Map<string, ReturnType<typeof vaultRowControls>>());
  const groupCollapsedGenRef = useRef<Map<string, number>>(new Map());
  /** Shared across root reorder + assign/ungroup + create-vault group apply. */
  const groupsMutateGenRef = useRef(0);
  const vaultOrderGenRef = useRef(0);
  const repairGenRef = useRef(0);
  const [groupsRepairBusy, setGroupsRepairBusy] = useState(false);
  const groupsRepairLimit = useOperationLimit(groupsRepairBusy);
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
            if (rowControlsRef.current.get(id)?.dragBlocked) continue;
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
    updateVaultUnlockPreset,
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

  /** A group's settings are open; set once the modals are known, read when a refresh lands. */
  const groupSettingsOpenRef = useRef(false);
  const { isRefreshing, refresh } = useAppRefresh({
    applyVaultList,
    applyGroups: (result) => {
      // Keep the open group's draft: its groups are not replaced under it.
      if (groupSettingsOpenRef.current) {
        showToast(t("toast.groups_refresh_blocked_settings"));
        return;
      }
      applyGroupListResult(result);
    },
    onError: (error) => {
      if (!settingsOnDisk && isVaultRootGoneError(error)) return;
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
        if (!settingsOnDisk && isVaultRootGoneError(error)) return;
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

  useUnfinishedSweep(vaultService, settingsOnDisk, vaultRootEpoch);

  useEffect(() => {
    syncWithVaultList(vaults);
  }, [syncWithVaultList, vaults]);

  const modals = useVaultListModals(vaults, groups);
  const vaultName = (vaultId: string) =>
    vaults.find((vault) => vault.id === vaultId)?.displayName ?? vaultId;
  groupSettingsOpenRef.current = modals.settingsGroupId !== null;
  const { lifecycleRequest, setLifecycleRequest } = modals;
  const exportFolders = useVaultExportFolders();
  const backupService = useBackupService();
  const securityService = useVaultSecurityService();
  const lifecycleService = useVaultLifecycleService();
  const jobs = useJobService();
  const [backupListRefresh, setBackupListRefresh] = useState(0);
  const backupJob = useVaultBackupJob(backupService, jobs, {
    onSaved: (vaultId, saved) => {
      const done = t("toast.backup_now_saved", { name: vaultName(vaultId) });
      const switched = switchesMessage(saved.switches, t, vaultName);
      showToast(switched ? `${done} ${switched}` : done);
      setBackupListRefresh((token) => token + 1);
    },
    onFailed: (_vaultId, error) => {
      showError(error, "toast.backup_now_failed");
    },
    onCancelled: () => {
      showToast(t("toast.backup_now_cancelled"));
    },
    onStopRefused: (_vaultId, error) => showError(error, "error.job_not_stoppable"),
  });
  /** Read the rows again from core: a change or a delete moved a row's keys, state, or session. */
  const reloadVaults = useCallback(() => {
    const fetchStartedAt = Date.now();
    void vaultService.listVaults().then(
      (rows) => applyVaultList(rows, fetchStartedAt),
      (error: unknown) => showError(error, "toast.refresh_failed"),
    );
  }, [applyVaultList, showError, vaultService]);

  const changeSeqRef = useRef(0);
  /** The settings window shows this screen of the vault, so it shows the outcome itself. */
  const settingsShows = (vaultId: string, area: VaultSettingsAreaId) =>
    modals.settingsVaultId === vaultId && modals.settingsArea === area;
  /** A change's toast, saying when the key copies of its files wait for the next open. */
  const changedToast = (
    key: "toast.password_changed" | "toast.password_change_finished" | "toast.unlock_ram_changed",
    vaultId: string,
    keyCopies: KeyCopies,
  ) => {
    const name = vaultName(vaultId);
    const waiting = keyCopies === "waiting" ? ` ${t("toast.key_copies_waiting", { name })}` : "";
    showToast(`${t(key, { name })}${waiting}`);
  };
  const [passwordOutcome, setPasswordOutcome] = useState<PasswordChangeOutcome | null>(null);
  /** Hand the settings window how a password change or Finish ended. */
  const passwordEnded = (outcome: Omit<PasswordChangeOutcome, "seq">) =>
    setPasswordOutcome({ ...outcome, seq: ++changeSeqRef.current });
  const passwordChange = usePasswordChangeJob(securityService, jobs, {
    onChanged: (result, target) => {
      changedToast("toast.password_changed", target.vaultId, result.keyCopies);
      passwordEnded({ ...target, result, error: null, stopped: false });
      reloadVaults();
    },
    onFinished: (result, target) => {
      changedToast("toast.password_change_finished", target.vaultId, result.keyCopies);
      passwordEnded({ ...target, result, error: null, stopped: false });
      reloadVaults();
    },
    onFailed: (error, target) => {
      passwordEnded({ ...target, result: null, error, stopped: false });
      if (!settingsShows(target.vaultId, "password")) {
        showError(error, "error.settings_save_failed");
      }
      reloadVaults();
    },
    onCancelled: (target) => {
      passwordEnded({ ...target, result: null, error: null, stopped: true });
      showToast(
        target.kind === "finish"
          ? t("vault.change_password.finish_stopped")
          : t("toast.password_change_stopped", { name: vaultName(target.vaultId) }),
      );
      reloadVaults();
    },
    onStopRefused: (error) => showError(error, "error.job_not_stoppable"),
  });
  const [unlockRamOutcome, setUnlockRamOutcome] = useState<UnlockRamChangeOutcome | null>(null);
  /** Hand the settings window how an unlock-RAM change ended. */
  const unlockRamEnded = (outcome: Omit<UnlockRamChangeOutcome, "seq">) =>
    setUnlockRamOutcome({ ...outcome, seq: ++changeSeqRef.current });
  const unlockRamChange = useUnlockRamChangeJob(securityService, jobs, {
    onChanged: (result, target) => {
      updateVaultUnlockPreset(target.vaultId, target.nextPreset);
      changedToast("toast.unlock_ram_changed", target.vaultId, result.keyCopies);
      unlockRamEnded({ ...target, result, error: null, stopped: false });
    },
    onFailed: (error, target) => {
      unlockRamEnded({ ...target, result: null, error, stopped: false });
      if (!settingsShows(target.vaultId, "kdf")) showError(error, "error.settings_save_failed");
    },
    onCancelled: (target) => {
      unlockRamEnded({ ...target, result: null, error: null, stopped: true });
      showToast(t("toast.unlock_ram_change_stopped", { name: vaultName(target.vaultId) }));
    },
    onStopRefused: (error) => showError(error, "error.job_not_stoppable"),
  });
  /** The lifecycle's open with a password, set once it exists below. */
  const openWithPasswordRef = useRef<(vaultId: string, password: string) => boolean>(() => false);
  const rebuild = useVaultRebuildJob(securityService, jobs, {
    onRebuilt: (result, { vaultId }, password) => {
      // The header and the index are sealed and recorded: the vault is closed, not in recovery.
      setVaultRuntimeState(vaultId, { session: null, autoClosed: false });
      showToast(vaultRebuiltToast(result, vaultName(vaultId), t));
      reloadVaults();
      // Ready to use: it opens with the password the rebuild ran with. The
      // rebuild no longer holds it, though the list has not drawn that yet.
      if (!password) return;
      blockOpenVaultIdsRef.current.delete(vaultId);
      openWithPasswordRef.current(vaultId, password);
    },
    onFailed: (error) => showError(error, "toast.vault_rebuild_failed"),
    onCancelled: () => showToast(t("error.job_cancelled")),
    onStopRefused: (error) => showError(error, "error.job_not_stoppable"),
  });
  /** Running deletes already told to finish the Delete now way. */
  const [deleteNowIds, setDeleteNowIds] = useState<readonly string[]>([]);
  /** The vault whose Delete now waits for its confirmation. */
  const [deleteNowAsk, setDeleteNowAsk] = useState<string | null>(null);
  const deleteJob = useVaultDeleteJob(vaultService, jobs, {
    onDeleted: (outcome, target) => {
      setDeleteNowIds([]);
      const params = { name: target.displayName, folder: outcome.folder ?? "" };
      showToast(
        outcome.outside === "kept"
          ? t("toast.vault_deleted_outside_kept", params)
          : outcome.outside === "failed"
            ? t("toast.vault_deleted_outside_failed", params)
            : t("toast.vault_deleted", params),
      );
      forgetDeletedVault(target.vaultId);
    },
    // A refusal leaves the vault as it was; a failure once the delete began
    // leaves its row `deleting`, with Continue.
    onFailed: (error) => {
      setDeleteNowIds([]);
      showError(error);
      reloadVaults();
    },
    onCancelled: (target) => {
      setDeleteNowIds([]);
      showToast(t("toast.vault_delete_stopped", { name: target.displayName }));
      reloadVaults();
    },
  });
  const backupExportFolder = useExportFolder(t("modal.backup.export_picker_title"));
  const backupExport = useBackupExportJob(backupService, jobs, {
    onExported: (written) => {
      showToast(t("toast.backup_export_saved", { name: fileNameOfPath(written.path) }));
    },
    onFailed: (error) => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      showError(error, "toast.backup_export_failed");
    },
    onCancelled: () => {
      showToast(t("toast.backup_export_cancelled"));
    },
    onStopRefused: (error) => showError(error, "error.job_not_stoppable"),
  });
  const dataFolderService = useDataFolderService();
  const dataFolderExport = useDataFolderExportJob(dataFolderService, jobs, {
    onExported: (written) => {
      showToast(t("toast.data_folder_exported", { name: fileNameOfPath(written.path) }));
    },
    onFailed: (error) => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      showError(error, "toast.data_folder_export_failed");
    },
    onCancelled: () => {
      showToast(t("toast.data_folder_export_cancelled"));
    },
    onStopRefused: (error) => showError(error, "error.job_not_stoppable"),
  });
  // The export holds every vault: none may open until it ends.
  blockOpenVaultIdsRef.current = new Set(
    [
      passwordChange.job?.vaultId,
      unlockRamChange.job?.vaultId,
      rebuild.job?.vaultId,
      backupJob.job?.vaultId,
      deleteJob.job?.vaultId,
      ...(dataFolderExport.job ? vaults.map((vault) => vault.id) : []),
    ].filter((id): id is string => id != null),
  );

  const settingsPersistVaultIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!lifecycleRequest || !blockOpenVaultIdsRef.current.has(lifecycleRequest.vaultId)) return;
    setLifecycleRequest(null);
  }, [
    backupJob.job,
    dataFolderExport.job,
    deleteJob.job,
    lifecycleRequest,
    passwordChange.job,
    rebuild.job,
    setLifecycleRequest,
    unlockRamChange.job,
  ]);

  const lifecycle = useVaultLifecycleActions({
    vaults,
    setVaultRuntimeState,
    modals,
    showToast,
    showError,
    dismissToast,
    t,
    settingsPersistVaultIdsRef,
    blockOpenVaultIdsRef,
  });
  openWithPasswordRef.current = lifecycle.openWithPassword;
  // The Export window follows its vault's export while one runs.
  const shownExportJob =
    lifecycle.exportJob?.vaultId === modals.exportVaultId ? lifecycle.exportJob : null;
  const exportRun: VaultExportRun | null = shownExportJob
    ? {
        format: shownExportJob.format,
        startedAt: shownExportJob.startedAt,
        progress: shownExportJob.progress,
        stoppingSince: shownExportJob.stoppingSince,
      }
    : null;

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
  const existingDisplayNames = useMemo(() => vaults.map((vault) => vault.displayName), [vaults]);
  const visibleVaults = useMemo(
    () => filterVisibleVaults(vaults, showHiddenVaults),
    [showHiddenVaults, vaults],
  );
  const passwordJob = passwordChange.job;
  const unlockRamJob = unlockRamChange.job;
  const rebuildJob = rebuild.job;
  const backupNowJob = backupJob.job;
  const runningDelete = deleteJob.job;
  const quitClose = useQuitCloseProgress(vaults, setVaultRuntimeState);
  const pipelineListStatus = useMemo(() => {
    // A close this window started keeps its own row; the quit only adds the rest.
    const rowWork = { ...quitClose.rowWork, ...lifecycle.pipelineListStatus.rowWork };
    for (const job of [passwordJob, unlockRamJob, rebuildJob, backupNowJob]) {
      if (!job) continue;
      rowWork[job.vaultId] = vaultRowJobWork({
        startedAt: job.startedAt,
        stoppable: job.progress?.stoppable ?? true,
        stoppingSince: job.stoppingSince,
      });
    }
    // A delete has no row Stop: Delete now, in More options, ends it early.
    if (runningDelete) {
      rowWork[runningDelete.vaultId] = {
        startedAt: runningDelete.startedAt,
        timed: true,
        stop: null,
        stoppingSince: null,
      };
    }
    return {
      ...lifecycle.pipelineListStatus,
      closingVaultIds: [
        ...new Set([
          ...(lifecycle.pipelineListStatus.closingVaultIds ?? []),
          ...quitClose.closingVaultIds,
        ]),
      ],
      backingUpVaultIds: [
        ...new Set([
          ...(lifecycle.pipelineListStatus.backingUpVaultIds ?? []),
          ...quitClose.backingUpVaultIds,
        ]),
      ],
      recoveringVaultIds: [
        ...(lifecycle.pipelineListStatus.recoveringVaultIds ?? []),
        ...(rebuildJob ? [rebuildJob.vaultId] : []),
      ],
      passwordChangeVaultIds: passwordJob ? [passwordJob.vaultId] : undefined,
      kdfChangeVaultIds: unlockRamJob ? [unlockRamJob.vaultId] : undefined,
      deletingVaultIds: runningDelete ? [runningDelete.vaultId] : undefined,
      deleteNowVaultIds: deleteNowIds,
      backupJobVaultIds: backupNowJob ? [backupNowJob.vaultId] : undefined,
      backupExportVaultIds: backupExport.job ? [backupExport.job.vaultId] : undefined,
      dataFolderExporting: dataFolderExport.job !== null,
      rowWork,
    };
  }, [
    backupExport.job,
    backupNowJob,
    dataFolderExport.job,
    deleteNowIds,
    lifecycle.pipelineListStatus,
    passwordJob,
    quitClose,
    rebuildJob,
    runningDelete,
    unlockRamJob,
  ]);

  /** Stop the work a row shows, whichever owner runs it. */
  const stopRowWork = useCallback(
    (vaultId: string) => {
      if (passwordJob?.vaultId === vaultId) passwordChange.stop();
      else if (unlockRamJob?.vaultId === vaultId) unlockRamChange.stop();
      else if (rebuildJob?.vaultId === vaultId) rebuild.stop();
      else if (backupNowJob?.vaultId === vaultId) backupJob.stop();
      else lifecycle.stopVaultWork(vaultId);
    },
    [
      backupJob,
      backupNowJob,
      lifecycle,
      passwordChange,
      passwordJob,
      rebuild,
      rebuildJob,
      unlockRamChange,
      unlockRamJob,
    ],
  );

  // Everything running, for the quit overlay; the counts go to Electron main,
  // which asks before quitting and keeps the computer awake meanwhile.
  const closingCount = pipelineListStatus.closingVaultIds?.length ?? 0;
  useEffect(() => {
    const nameOf = (vaultId: string) =>
      vaults.find((vault) => vault.id === vaultId)?.displayName ?? vaultId;
    const items: RunningWorkItem[] = [];
    for (const [vaultId, work] of Object.entries(pipelineListStatus.rowWork ?? {})) {
      if (work.stop === null) continue;
      const vault = vaults.find((item) => item.id === vaultId);
      const status = vault ? resolveVaultListStatus(vault, pipelineListStatus) : "closed";
      items.push({
        key: `row:${vaultId}`,
        label: `${nameOf(vaultId)} · ${t(vaultStatusLabelKey(status, vaultId, pipelineListStatus))}`,
        startedAt: work.startedAt,
        stoppingSince: work.stoppingSince,
        stoppable: work.stop !== "final",
        stop: () => stopRowWork(vaultId),
      });
    }
    for (const job of [backupExport.job, dataFolderExport.job]) {
      if (!job) continue;
      const isBackup = job === backupExport.job;
      items.push({
        key: isBackup ? "backup_export" : "data_folder_export",
        label: isBackup
          ? `${nameOf(backupExport.job?.vaultId ?? "")} · ${t("modal.backup.export")}`
          : t("modal.data_folder_export.title"),
        startedAt: job.startedAt,
        stoppingSince: job.stoppingSince,
        stoppable: job.progress?.stoppable ?? true,
        stop: isBackup ? backupExport.stop : dataFolderExport.stop,
      });
    }
    // A normal quit waits for a delete; the quit's Close now leaves it where it is.
    if (runningDelete) {
      items.push({
        key: `delete:${runningDelete.vaultId}`,
        label: `${runningDelete.displayName} · ${t("vault.status.deleting")}`,
        startedAt: runningDelete.startedAt,
        stoppingSince: null,
        stoppable: false,
        stop: () => {},
      });
    }
    for (const vaultId of importingVaultIds) {
      items.push({
        key: `import:${vaultId}`,
        label: t("quit.work.files_importing", { name: nameOf(vaultId) }),
        startedAt: null,
        stoppingSince: null,
        stoppable: true,
        stop: () => cancelImports(vaultId),
      });
    }
    publishRunningWork({ items, closing: closingCount });
  }, [
    backupExport.job,
    backupExport.stop,
    cancelImports,
    closingCount,
    dataFolderExport.job,
    dataFolderExport.stop,
    importingVaultIds,
    runningDelete,
    pipelineListStatus,
    stopRowWork,
    t,
    vaults,
  ]);
  const dataFolderExportCanStart = dataFolderCanExport(vaults, pipelineListStatus);
  rowControlsRef.current = new Map(
    vaults.map((vault) => [vault.id, vaultRowControls(vault, pipelineListStatus)]),
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
      // Another vault being created only queues this one. The same id still in
      // flight is taken.
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

      const welcome = buildVaultWelcomeFiles(result, { t, locale });
      lifecycle.startCreatePipeline(
        result.vaultId,
        async (job) => {
          await vaultService.createVault(
            {
              password,
              unlockPreset: result.unlockPreset,
              settings: result.settings,
              importPackage: createVaultImportPackage(result, password),
              welcome,
            },
            job,
          );
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
          onRemoved: () => {
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
    },
    [
      addVault,
      applyGroupListResult,
      applyVaultList,
      lifecycle,
      locale,
      recordVaultHiddenIfNeeded,
      reloadGroups,
      removeVault,
      setGroups,
      showError,
      t,
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

  /** A new vault would land beside a data-folder copy in progress. Core refuses it too. */
  const refuseCreateWhileDataFolderExports = useCallback((): boolean => {
    if (!dataFolderExport.job) return false;
    showToast(t("error.data_folder_export_busy"));
    return true;
  }, [dataFolderExport.job, showToast, t]);

  const handleCreateVaultFromBackup = useCallback(
    (backup: VaultBackupEntry) => {
      if (!modals.backupVault) return;
      if (refuseCreateWhileDataFolderExports()) return;
      modals.setCreateVaultInitialDraft(
        createDraftFromBackup(
          backup,
          modals.backupVault.id,
          modals.backupVault.displayName,
          existingOrders,
          existingDisplayNames,
          groupIdContainingVault(groups, modals.backupVault.id),
        ),
      );
      modals.setCreateVaultInitialStep("source");
      modals.setBackupVaultId(null);
      modals.setCreateVaultOpen(true);
    },
    [existingDisplayNames, existingOrders, groups, modals, refuseCreateWhileDataFolderExports],
  );

  const openCreateVaultWithDraft = useCallback(
    (draft: ReturnType<typeof createDraftFromImportPackage>, step: "source" | null = "source") => {
      if (refuseCreateWhileDataFolderExports()) return;
      modals.setCreateVaultInitialDraft(draft);
      modals.setCreateVaultInitialStep(step);
      modals.setCreateVaultOpen(true);
    },
    [modals, refuseCreateWhileDataFolderExports],
  );

  const handleCreateFromScratch = useCallback(() => {
    openCreateVaultWithDraft(createDraftForScratchSource(existingOrders), "source");
  }, [existingOrders, openCreateVaultWithDraft]);

  const handleImportPackage = useCallback(() => {
    openCreateVaultWithDraft(createDraftForImportSource(existingOrders), "source");
  }, [existingOrders, openCreateVaultWithDraft]);

  const handleDroppedImportPackage = useCallback(
    (source: VaultListDropSource) => {
      if (!source.absolutePath) {
        showToast(t("vault.create.error.import_file_missing"));
        openCreateVaultWithDraft(createDraftForImportSource(existingOrders), "source");
        return;
      }
      openCreateVaultWithDraft(
        createDraftFromImportPackage(source.fileName, existingOrders, {
          filePath: source.absolutePath,
          existingDisplayNames,
          shape: source.shape,
        }),
        "source",
      );
    },
    [existingDisplayNames, existingOrders, openCreateVaultWithDraft, showToast, t],
  );

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
    modals.deleteVaultId ||
    modals.lifecycleRequest ||
    modals.recoveryVaultId ||
    fileManagerMaximized,
  );

  const importDrop = useVaultImportDrop({
    enabled: !blockingUiOpen,
    onAcceptImportPackage: handleDroppedImportPackage,
  });

  const handleNoteChange = useCallback(
    async (vaultId: string, note: string): Promise<boolean> => {
      if (rowControlsRef.current.get(vaultId)?.noteBlocked) return false;
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

  /** The vault's folder is gone: drop its row, its place in a group, and its windows. */
  function forgetDeletedVault(vaultId: string) {
    lifecycle.handleVaultDelete(vaultId);
    removeVault(vaultId);
    void reloadGroups().catch((error: unknown) => showError(error, "toast.refresh_failed"));
    if (modals.settingsVaultId === vaultId) {
      modals.setSettingsVaultId(null);
      modals.setSettingsArea(null);
    }
    if (modals.noteVaultId === vaultId) modals.setNoteVaultId(null);
    if (modals.backupVaultId === vaultId) modals.setBackupVaultId(null);
    if (modals.vaultInfoVaultId === vaultId) modals.setVaultInfoVaultId(null);
    if (modals.deleteVaultId === vaultId) modals.setDeleteVaultId(null);
    if (modals.lifecycleRequest?.vaultId === vaultId) modals.setLifecycleRequest(null);
    if (modals.recoveryVaultId === vaultId) modals.setRecoveryVaultId(null);
  }

  /**
   * Start the delete of `vaultId` as a job the list owns, or go on with one
   * that did not finish, which keeps the outside-backups choice it began
   * with. `now` removes the files with no overwrite. False when it cannot
   * start; the reason is a toast.
   */
  const startVaultDelete = useCallback(
    (vaultId: string, outsideBackups: boolean, now: boolean): boolean => {
      const target = vaults.find((vault) => vault.id === vaultId);
      if (!target) return false;
      if (!vaultService.canDeleteVault) {
        showError(new RpcError("not_implemented", "Vault delete is not implemented"));
        return false;
      }
      if (deleteJob.job) {
        showToast(t("vault.delete.busy"));
        return false;
      }
      if (!isVaultDeleteUnfinished(target, pipelineListStatus)) {
        if (lifecycle.pipeline.isVaultPipelineBusy(vaultId)) {
          showToast(t("toast.pipeline_busy"));
          return false;
        }
        const hold = vaultDeleteHold(target, pipelineListStatus);
        if (hold) {
          showToast(t(VAULT_DELETE_HOLD_I18N_KEY[hold]));
          return false;
        }
      }
      const started = deleteJob.deleteVault(
        { vaultId, displayName: target.displayName },
        outsideBackups,
        now,
      );
      if (started && now) setDeleteNowIds([vaultId]);
      return started;
    },
    [deleteJob, lifecycle, pipelineListStatus, showError, showToast, t, vaultService, vaults],
  );

  /** Continue a delete that did not finish, or ask before Delete now. */
  const handleDeleteWork = useCallback(
    (vault: VaultListItem, now: boolean) => {
      if (now) setDeleteNowAsk(vault.id);
      else startVaultDelete(vault.id, false, false);
    },
    [startVaultDelete],
  );

  /** Delete now, once confirmed: tell the running delete, or run one with no overwrite. */
  const confirmDeleteNow = useCallback(() => {
    const vaultId = deleteNowAsk;
    setDeleteNowAsk(null);
    if (!vaultId) return;
    if (deleteJob.job?.vaultId !== vaultId) {
      startVaultDelete(vaultId, false, true);
      return;
    }
    setDeleteNowIds([vaultId]);
    void deleteJob.hurry(vaultId).then(
      (running) => {
        if (!running) setDeleteNowIds([]);
      },
      (error: unknown) => {
        setDeleteNowIds([]);
        showError(error);
      },
    );
  }, [deleteJob, deleteNowAsk, showError, startVaultDelete]);

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
    if (!groupsRepairLimit.timedOut || !groupsRepairBusy) return;
    repairGenRef.current += 1;
    setGroupsRepairBusy(false);
    showError(
      new RpcError("rpc_timeout", "vault_group_repair timed out"),
      "error.operation_timed_out",
    );
  }, [groupsRepairLimit.timedOut, groupsRepairBusy, showError]);

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
        void refresh();
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
      showCloseAllVaults:
        vaults.filter((vault) => resolveVaultDisplayStatus(vault) === "open").length > 1,
      onCloseAllVaults: () => {
        lifecycle.closeAllOpenVaults();
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
      pipelineListStatus,
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
        // One change of each kind at a time: another vault's screen waits.
        if (area === "password" && passwordJob && passwordJob.vaultId !== vaultId) {
          showToast(t("vault.password_change.busy"));
          return;
        }
        if (area === "kdf" && unlockRamJob && unlockRamJob.vaultId !== vaultId) {
          showToast(t("vault.unlock_ram_change.busy"));
          return;
        }
        modals.setSettingsVaultId(vaultId);
        modals.setSettingsArea(area);
      },
      onOpenDelete: modals.setDeleteVaultId,
      onOpenGroupSettings: modals.setSettingsGroupId,
      onToggleGroupCollapsed: handleToggleGroupCollapsed,
      onExportVault: (vault: VaultListItem) => {
        if (dataFolderExport.job) {
          showToast(t("error.data_folder_export_busy"));
          return;
        }
        lifecycle.handleExportVault(vault);
      },
      onLockVault: lifecycle.handleLockVault,
      onUnlockVault: lifecycle.handleUnlockVault,
      onCloseNow: lifecycle.handleCloseNow,
      onStopWork: (vault: VaultListItem) => stopRowWork(vault.id),
      onDeleteWork: handleDeleteWork,
      deleteNowVault: deleteNowAsk
        ? (vaults.find((vault) => vault.id === deleteNowAsk) ?? null)
        : null,
      onCancelDeleteNow: () => setDeleteNowAsk(null),
      onConfirmDeleteNow: confirmDeleteNow,
      onPlainRecordRetry: () => void refresh(),
      onPlainRecordForget: (vault: VaultListItem, token: string) => {
        void lifecycleService
          .forgetPlainRecord(vault.id, token)
          .then(() => refresh())
          .catch((error: unknown) => showError(error, "toast.plain_record_forget_failed"));
      },
    },
    importDrop,
    lifecycle: {
      lifecycleVault: modals.lifecycleVault,
      lifecycleOpen: modals.lifecycleRequest !== null,
      lifecycleSubmitting: lifecycle.credentialBusy,
      lifecyclePipelineStep:
        lifecycle.pipeline.run && lifecycle.pipeline.run.vaultId === modals.lifecycleVault?.id
          ? lifecycle.pipeline.run.activeStep
          : 0,
      lifecycleWork: modals.lifecycleVault
        ? (pipelineListStatus.rowWork?.[modals.lifecycleVault.id] ?? null)
        : null,
      lifecycleVerifyErrorKey: lifecycle.credentialErrorKey,
      lifecycleFieldPassword: lifecycle.credentialFieldPassword,
      onLifecycleClose: () => {
        lifecycle.abandonCredentialVerify();
        modals.setLifecycleRequest(null);
      },
      onLifecycleConfirm: lifecycle.handleLifecycleConfirm,
      onLifecycleStop: () => {
        if (modals.lifecycleVault) lifecycle.stopVaultWork(modals.lifecycleVault.id);
      },
      onLifecycleRebuild: (password: string) => {
        const vault = modals.lifecycleVault;
        if (!vault) return;
        if (!rebuild.rebuild(vault.id, password)) {
          showToast(t("toast.vault_rebuild_busy"));
          return;
        }
        // The list owns the rebuild: the row shows it, and the window closes.
        lifecycle.abandonCredentialVerify();
        modals.setLifecycleRequest(null);
      },
      recoveryVault: modals.recoveryVault,
      recoveryOpen: modals.recoveryVaultId !== null,
      onRecoveryClose: () => modals.setRecoveryVaultId(null),
      onRecoveryAction: lifecycle.handleRecoveryAction,
      recoveryLeftover: lifecycle.recoveryLeftover,
      placeOpen: lifecycle.placeOpen,
      placeVaultName: lifecycle.placeVaultName,
      placeAppChoices: lifecycle.placeAppChoices,
      placeAppUnlocked: lifecycle.placeAppUnlocked,
      placeVaultUnlocked: lifecycle.placeVaultUnlocked,
      placeSubmitting: lifecycle.placeSubmitting,
      placeWarningClass: lifecycle.placeWarningClass,
      onPlaceClose: lifecycle.onPlaceClose,
      onPlaceContinue: lifecycle.onPlaceContinue,
      onPlaceAcceptWarning: lifecycle.onPlaceAcceptWarning,
      heldOpen: lifecycle.heldOpen,
      heldCount: lifecycle.heldCount,
      heldPaths: lifecycle.heldPaths,
      heldSubmitting: lifecycle.heldSubmitting,
      onHeldApply: lifecycle.onHeldApply,
      onHeldRestore: lifecycle.onHeldRestore,
      driverPromptVaultName: lifecycle.driverPromptVaultName,
      driverKind: lifecycle.driverKind,
      driverInstalling: lifecycle.driverInstalling,
      onDriverInstall: lifecycle.onDriverInstall,
      onDriverDismiss: lifecycle.onDriverDismiss,
      closePrompt: lifecycle.closePrompt,
      closePromptVaultName: lifecycle.closePromptVaultName,
      closePromptSaving: lifecycle.closePromptSaving,
      onClosePromptCancel: lifecycle.cancelClosePrompt,
      onClosePromptDiscard: lifecycle.confirmClosePromptDiscard,
      onClosePromptSave: lifecycle.confirmClosePromptSave,
      onClosePromptSaveTimeout: lifecycle.timeoutClosePromptSave,
      onClosePromptCancelImport: lifecycle.confirmClosePromptCancelImport,
      closeNowVault: lifecycle.closeNowVault,
      closeNowUnsaved: lifecycle.closeNowUnsaved,
      closeNowAsks: lifecycle.closeNowAsks,
      onCloseNowCancel: lifecycle.cancelCloseNow,
      onCloseNowConfirm: lifecycle.confirmCloseNow,
    },
    toast: {
      toast: toastState,
      onDismiss: dismissToast,
    },
    note: {
      vault: modals.noteVault,
      open: modals.noteVaultId !== null,
      onClose: () => modals.setNoteVaultId(null),
      onNoteChange: handleNoteChange,
      saveHeld:
        modals.noteVault != null &&
        vaultRowControls(modals.noteVault, pipelineListStatus).noteBlocked,
    },
    backups: {
      vault: modals.backupVault,
      open: modals.backupVaultId !== null,
      canSaveNow:
        modals.backupVault !== null &&
        vaultCanSaveBackupNow(modals.backupVault, pipelineListStatus),
      saveJob:
        backupJob.job !== null && backupJob.job.vaultId === modals.backupVault?.id
          ? backupJob.job
          : null,
      onStopSave: backupJob.stop,
      onSaveNow: () => {
        const vault = modals.backupVault;
        if (!vault) return;
        if (backupJob.job) {
          if (backupJob.job.vaultId !== vault.id) showToast(t("toast.backup_now_busy"));
          return;
        }
        if (!vaultCanSaveBackupNow(vault, pipelineListStatus)) return;
        backupJob.start(vault.id);
      },
      listRefreshToken: backupListRefresh,
      onClose: () => modals.setBackupVaultId(null),
      onCreateVaultFromBackup: handleCreateVaultFromBackup,
      exportFolder: backupExportFolder,
      exportJob: backupExport.job,
      onExport: (keys: readonly string[], destDir: string) => {
        const vault = modals.backupVault;
        if (vault) backupExport.start(vault.id, keys, destDir);
      },
      onExportBusy: () => showToast(t("toast.backup_export_busy")),
      onStopExport: backupExport.stop,
    },
    exportVault: {
      vault: modals.exportVault,
      open: modals.exportVaultId !== null,
      running: exportRun,
      passwordError:
        modals.exportPasswordError && modals.exportPasswordError.vaultId === modals.exportVaultId
          ? modals.exportPasswordError.message
          : null,
      folders: exportFolders,
      onClose: () => {
        modals.setExportVaultId(null);
        modals.setExportPasswordError(null);
      },
      onConfirm: lifecycle.handleConfirmExportVault,
      onStop: lifecycle.handleStopExportVault,
      onPasswordEdited: () => modals.setExportPasswordError(null),
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
      onNotice: showToast,
      passwordJob,
      passwordOutcome,
      onChangePassword: passwordChange.changePassword,
      onFinishPasswordChange: passwordChange.finish,
      onStopPasswordChange: passwordChange.stop,
      unlockRamJob,
      unlockRamOutcome,
      onChangeKdf: unlockRamChange.changeKdf,
      onStopUnlockRamChange: unlockRamChange.stop,
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
      onNotice: showToast,
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
      exportControls: dataFolderService
        ? {
            canStart: dataFolderExportCanStart,
            job: dataFolderExport.job,
            written: dataFolderExport.written,
            clearWritten: dataFolderExport.clearWritten,
            outsideBackups: vaults.filter((vault) => vault.outsideBackups).length,
            onStart: (destDir: string, name: string, includeBackups: boolean) =>
              dataFolderExportCanStart && dataFolderExport.start(destDir, name, includeBackups),
            onStop: dataFolderExport.stop,
          }
        : undefined,
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
    deleteVault: {
      vault: modals.deleteVault,
      job: runningDelete,
      onClose: () => modals.setDeleteVaultId(null),
      onDelete: (vaultId: string, outsideBackups: boolean) =>
        startVaultDelete(vaultId, outsideBackups, false),
    },
    createVault: {
      open: modals.createVaultOpen,
      existingVaultIds,
      existingOrders,
      existingDisplayNames,
      groups,
      initialDraft: modals.createVaultInitialDraft,
      initialStep: modals.createVaultInitialStep,
      onClose: modals.closeCreateVault,
      onCreate: handleCreateVault,
    },
  };
}
