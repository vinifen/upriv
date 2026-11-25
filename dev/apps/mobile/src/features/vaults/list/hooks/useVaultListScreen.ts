import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  applyPendingCreateGroupEffect,
  applyVaultListHierarchySort,
  applyVaultSettingsListPatch,
  applyVaultStorageMode,
  applyVaultUnlockPreset,
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
  errorOnPasswordField,
  isVaultPipelineDisplayBusy,
  remapVaultIdInGroups,
  removeVaultFromGroups,
  sortVaultsByOrder,
  vaultIdsInHiddenGroups,
  vaultIdsUnhiddenByGroups,
  dataFolderCanExport,
  fileNameOfPath,
  isVaultDeleteUnfinished,
  vaultDeleteHold,
  vaultExportToast,
  vaultRowControls,
  VAULT_DELETE_HOLD_I18N_KEY,
  resolveVaultListStatus,
  vaultCanExport,
  vaultCanSaveBackupNow,
  RpcError,
  isRpcError,
  shouldBumpVaultRootEpoch,
  isVaultRootGoneError,
  VAULT_ROOT_ERROR_CODES,
  shouldRecordVaultHidden,
  validateDisplayName,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_ERROR_CODES,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_ROW_DENSITY,
  vaultBlocksColumnCount,
  buildVaultWelcomeFiles,
  createVaultImportPackage,
  unfinishedVaultsRemovedText,
  createVaultImportPackageKind,
  type CreateVaultDraft,
  type CreateVaultGroupAssignment,
  type CreateVaultResult,
  type CreateVaultStepId,
  type PendingCreateGroupEffect,
  type VaultExportRequest,
  type VaultExportRun,
  type VaultGroup,
  type KdfUnlockPreset,
  type StorageMode,
  type KeyCopies,
  type ImportBlockedReport,
  type VaultListItem,
  type VaultRuntimePatch,
  vaultRebuiltToast,
  vaultRowJobWork,
} from "@upriv/shared";
import {
  useBackupService,
  useDataFolderService,
  useJobService,
  useLogService,
  useVaultGroupService,
  useVaultLifecycleService,
  useVaultSecurityService,
  useVaultService,
} from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import type { DataFolderExportControls } from "@/features/system/data-folder-export";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  useBackupExportJob,
  useDataFolderExportJob,
  useFileManagerSelector,
  useOperationLimit,
  usePasswordChangeJob,
  useStorageChangeJob,
  useToast,
  useUnfinishedSweep,
  useUnlockRamChangeJob,
  useVaultBackupJob,
  useVaultDeleteJob,
  useVaultExportJob,
  useVaultRebuildJob,
  type PasswordChangeOutcome,
  type StorageChangeOutcome,
  type UnlockRamChangeOutcome,
} from "@upriv/shared/react";
import { CONTROL_HEIGHT_MD, MAX_WIDTH_VAULT_LIST, spacing } from "@/theme/tokens";
import { useExportFolder } from "@/hooks/useExportFolder";
import { useKeepAwakeWhile } from "@/hooks/useKeepAwakeWhile";
import { useVaultExportFolders } from "./useVaultExportFolders";
import { useVaultLifecycle } from "@/features/vaults/lifecycle";
import { useFileManager } from "@/features/vaults/file-manager";
import {
  claimContentTreeForCreate,
  contentTreeClaimedForCreate,
  releaseContentJob,
  releasePendingImport,
} from "@/platform/native/contentTreeImport";
import { releaseImportCache } from "@/platform/native/importCache";
import { useVaultListModals } from "./useVaultListModals";
import { useVaultListState } from "./useVaultListState";
import { flattenHierarchyRows, packRowsForBlocks } from "../lib/hierarchyRows";

const PAGE_PAD_H = spacing.md;

/** A folder or one document is streamed. A zip or 7z stays on the archive path. */
function claimsContentTree(result: CreateVaultResult): boolean {
  if (result.source !== "import") return false;
  if (result.importShape === "directory") return true;
  try {
    return createVaultImportPackageKind(result) === "os_tree";
  } catch {
    return false;
  }
}

export function useVaultListScreen() {
  const { t, locale } = useTranslation();
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
    settingsReady,
    vaultRootEpoch,
  } = useAppSettingsContext();
  const insets = useSafeAreaInsets();
  const headerHeightFallback = insets.top + spacing.lg * 2 + CONTROL_HEIGHT_MD;
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState<number | null>(null);
  const appHeaderHeight = measuredHeaderHeight ?? headerHeightFallback;
  const { width: windowWidth } = useWindowDimensions();
  const { toast, show, dismiss } = useToast();
  const { openFromVault, syncWithVaultList, purgeForVaultClose, flushWorkspaceSnapshot } =
    useFileManager();

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
    deleteVaultId,
    setDeleteVaultId,
    exportVault,
    setExportVault,
    setExportPasswordError,
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
  const groupLimit = useOperationLimit(groupBusy);
  const repairLimit = useOperationLimit(repairBusy);
  const noteSaveGenerationRef = useRef(new Map<string, number>());
  const jobs = useJobService();
  const exportFolders = useVaultExportFolders();
  /** The vault the Export window shows now, read when an export settles. */
  const exportWindowVaultIdRef = useRef<string | null>(null);
  exportWindowVaultIdRef.current = exportVault?.id ?? null;
  const vaultExport = useVaultExportJob(vaultService, jobs, {
    onExported: (written, target) => {
      const toast = vaultExportToast(target, written, t);
      show(toast.message, toast.durationMs ?? undefined);
      setExportVault(null);
    },
    onFailed: (error, target) => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      const key = mobileErrorI18nKey(error, "vault.export.failed");
      // A refused password goes on the window's password field; a window
      // already closed, and every other failure, gets a toast.
      if (errorOnPasswordField(key) && exportWindowVaultIdRef.current === target.vaultId) {
        setExportPasswordError({ vaultId: target.vaultId, message: t(key) });
        return;
      }
      show(t(key));
    },
    onCancelled: () => {
      show(t("toast.vault_export_cancelled"));
      setExportVault(null);
    },
    onStopRefused: (error) => show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });
  const exportJob = vaultExport.job;
  // The Export window follows its vault's export while one runs.
  const shownExportJob = exportJob && exportVault?.id === exportJob.vaultId ? exportJob : null;
  const exportRun: VaultExportRun | null = shownExportJob
    ? {
        format: shownExportJob.format,
        startedAt: shownExportJob.startedAt,
        progress: shownExportJob.progress,
        stoppingSince: shownExportJob.stoppingSince,
      }
    : null;

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
  const existingDisplayNames = useMemo(() => vaults.map((vault) => vault.displayName), [vaults]);

  const dataFolderService = useDataFolderService();
  const {
    job: dataFolderExportJob,
    written: dataFolderExportWritten,
    clearWritten: clearDataFolderExportWritten,
    start: startDataFolderExport,
    stop: stopDataFolderExport,
  } = useDataFolderExportJob(dataFolderService, jobs, {
    onExported: (written) => {
      show(t("toast.data_folder_exported", { name: fileNameOfPath(written.path) }));
    },
    onFailed: (error) => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      show(t(mobileErrorI18nKey(error, "toast.data_folder_export_failed")));
    },
    onCancelled: () => {
      show(t("toast.data_folder_export_cancelled"));
    },
    onStopRefused: (error) => show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });

  const openCreate = useCallback(
    (draft: CreateVaultDraft | null = null, step: CreateVaultStepId | null = null) => {
      // A new vault would land beside a data-folder copy in progress. Core refuses it too.
      if (dataFolderExportJob) {
        show(t("error.data_folder_export_busy"));
        return;
      }
      setCreateDraft(draft);
      setCreateStep(step);
      setCreateOpen(true);
    },
    [dataFolderExportJob, setCreateDraft, setCreateOpen, setCreateStep, show, t],
  );

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateDraft(null);
    setCreateStep(null);
  }, [setCreateDraft, setCreateOpen, setCreateStep]);
  const noteVault = useMemo(
    () => vaults.find((vault) => vault.id === noteVaultId) ?? null,
    [vaults, noteVaultId],
  );
  const vaultInfoVault = useMemo(
    () => vaults.find((vault) => vault.id === vaultInfoVaultId) ?? null,
    [vaults, vaultInfoVaultId],
  );
  const deleteVault = useMemo(
    () => vaults.find((vault) => vault.id === deleteVaultId) ?? null,
    [vaults, deleteVaultId],
  );
  // The list row is the truth: a close or a recovery changes it while the window is up.
  const settingsVaultId = modals.settingsVault?.id ?? null;
  const settingsVault = useMemo(
    () => vaults.find((vault) => vault.id === settingsVaultId) ?? null,
    [vaults, settingsVaultId],
  );
  const backupsVaultId = modals.backupsVault?.id ?? null;
  const backupsVault = useMemo(
    () => vaults.find((vault) => vault.id === backupsVaultId) ?? null,
    [vaults, backupsVaultId],
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
  const blockOpenVaultIdsRef = useRef(new Set<string>());
  const prevVaultRootEpochRef = useRef(vaultRootEpoch);
  const vaultRootEpochRef = useRef(vaultRootEpoch);
  vaultRootEpochRef.current = vaultRootEpoch;

  const setVaultRuntimeState = useCallback(
    (vaultId: string, patch: VaultRuntimePatch) => {
      sessionWritesRef.current.set(vaultId, Date.now());
      setVaults((prev) =>
        prev.map((vault) => (vault.id === vaultId ? { ...vault, ...patch } : vault)),
      );
    },
    [setVaults],
  );

  /** The row follows the storage value a change sealed, or an open reset. */
  const setVaultStorageMode = useCallback(
    (vaultId: string, storageMode: StorageMode) => {
      setVaults((prev) =>
        prev.map((vault) =>
          vault.id === vaultId ? applyVaultStorageMode(vault, storageMode) : vault,
        ),
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
    onFlushWorkspace: flushWorkspaceSnapshot,
    onOpenFileManager: openFromVault,
    settingsPersistVaultIdsRef,
    blockOpenVaultIdsRef,
    onStorageReset: (vaultId) => setVaultStorageMode(vaultId, "encrypted_dir"),
  });

  /** Reloads in flight: `refreshing` stays on until the last one settles. */
  const reloadsInFlightRef = useRef(0);
  /** The reload the person asked for (Refresh, or a pull), shared while it runs. */
  const userRefreshRef = useRef<Promise<VaultListItem[]> | null>(null);

  const reload = useCallback(async (): Promise<VaultListItem[]> => {
    reloadsInFlightRef.current += 1;
    setRefreshing(true);
    const fetchStartedAt = Date.now();
    const epochAtStart = vaultRootEpochRef.current;
    try {
      const [list, groupResult] = await Promise.all([
        vaultService.listVaults(),
        vaultGroupService.list(),
      ]);
      if (vaultRootEpochRef.current !== epochAtStart) return [];
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
      if (vaultRootEpochRef.current !== epochAtStart) {
        // The data folder changed under this reload; the new one loads on its own.
      } else if (
        !settingsOnDisk &&
        (isVaultRootGoneError(error) ||
          (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.UNREACHABLE))
      ) {
        // Children stay mounted under Gate. First-run and an already-unplugged
        // folder are not a new integrity failure (that would loop the epoch).
      } else if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
      } else {
        show(t(mobileErrorI18nKey(error, "toast.refresh_failed")));
      }
      return [];
    } finally {
      reloadsInFlightRef.current -= 1;
      if (reloadsInFlightRef.current === 0) setRefreshing(false);
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

  // The vaults whose create or store copy a crash cut off go, and the toast
  // names them. Core runs inside this app, so no import outlives the screen
  // that started it.
  useUnfinishedSweep(vaultService, settingsOnDisk, vaultRootEpoch, (removed) => {
    const names = removed.map(
      (id) => vaultsRef.current.find((vault) => vault.id === id)?.displayName ?? id,
    );
    show(unfinishedVaultsRemovedText(names, t), 8000);
    void reload();
  });

  /**
   * Refresh from the menu or a pull. A second ask while one runs joins it, so
   * a pull during Refresh does not read the data folder twice.
   */
  const refresh = useCallback((): Promise<VaultListItem[]> => {
    if (!userRefreshRef.current) {
      userRefreshRef.current = reload().finally(() => {
        userRefreshRef.current = null;
      });
    }
    return userRefreshRef.current;
  }, [reload]);

  /** Drop a plain-text folder on record; its files stay where they are. */
  const forgetPlainRecord = useCallback(
    (vault: VaultListItem, token: string) => {
      void lifecycleService
        .forgetPlainRecord(vault.id, token)
        .then(() => refresh())
        .catch((error: unknown) => {
          show(t(mobileErrorI18nKey(error, "toast.plain_record_forget_failed")));
        });
    },
    [lifecycleService, refresh, show, t],
  );

  useEffect(() => {
    if (!settingsReady) return;
    void reload();
  }, [reload, settingsReady]);

  useEffect(() => {
    if (prevVaultRootEpochRef.current === vaultRootEpoch) return;
    prevVaultRootEpochRef.current = vaultRootEpoch;
    sessionWritesRef.current.clear();
    pendingCreatesRef.current.clear();
    pendingCreateGroupsRef.current.clear();
    setVaults([]);
    setGroups([]);
    if (!settingsReady) return;
    void reload();
  }, [reload, setGroups, setVaults, settingsReady, vaultRootEpoch]);

  useEffect(() => {
    syncWithVaultList(vaults);
  }, [syncWithVaultList, vaults]);

  const securityService = useVaultSecurityService();
  const vaultName = (vaultId: string) =>
    vaults.find((vault) => vault.id === vaultId)?.displayName ?? vaultId;
  /** Read the rows again from core: a change or a delete moved a row's keys, state, or session. */
  const reloadVaults = () => {
    void reload().catch(() => undefined);
  };
  const changeSeqRef = useRef(0);
  /** The settings window shows this screen of the vault, so it shows the outcome itself. */
  const settingsShows = (vaultId: string, area: "password" | "kdf" | "storage") =>
    modals.settingsVault?.id === vaultId && modals.settingsArea === area;
  /** A change's toast, saying when the key copies of its files wait for the next open. */
  const changedToast = (
    key: "toast.password_changed" | "toast.password_change_finished" | "toast.unlock_ram_changed",
    vaultId: string,
    keyCopies: KeyCopies,
  ) => {
    const name = vaultName(vaultId);
    const waiting = keyCopies === "waiting" ? ` ${t("toast.key_copies_waiting", { name })}` : "";
    show(`${t(key, { name })}${waiting}`);
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
        show(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
      }
      reloadVaults();
    },
    onCancelled: (target) => {
      passwordEnded({ ...target, result: null, error: null, stopped: true });
      show(
        target.kind === "finish"
          ? t("vault.change_password.finish_stopped")
          : t("toast.password_change_stopped", { name: vaultName(target.vaultId) }),
      );
      reloadVaults();
    },
    onStopRefused: (error) => show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });
  const passwordJob = passwordChange.job;
  const [unlockRamOutcome, setUnlockRamOutcome] = useState<UnlockRamChangeOutcome | null>(null);
  /** Hand the settings window how an unlock-RAM change ended. */
  const unlockRamEnded = (outcome: Omit<UnlockRamChangeOutcome, "seq">) =>
    setUnlockRamOutcome({ ...outcome, seq: ++changeSeqRef.current });
  const unlockRamChange = useUnlockRamChangeJob(securityService, jobs, {
    onChanged: (result, target) => {
      handleUnlockPresetSaved(target.vaultId, target.nextPreset);
      changedToast("toast.unlock_ram_changed", target.vaultId, result.keyCopies);
      unlockRamEnded({ ...target, result, error: null, stopped: false });
    },
    onFailed: (error, target) => {
      unlockRamEnded({ ...target, result: null, error, stopped: false });
      if (!settingsShows(target.vaultId, "kdf")) {
        show(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
      }
    },
    onCancelled: (target) => {
      unlockRamEnded({ ...target, result: null, error: null, stopped: true });
      show(t("toast.unlock_ram_change_stopped", { name: vaultName(target.vaultId) }));
    },
    onStopRefused: (error) => show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });
  const unlockRamJob = unlockRamChange.job;
  const [storageOutcome, setStorageOutcome] = useState<StorageChangeOutcome | null>(null);
  /** Hand the settings window how a Storage change ended. */
  const storageEnded = (outcome: Omit<StorageChangeOutcome, "seq">) =>
    setStorageOutcome({ ...outcome, seq: ++changeSeqRef.current });
  const storageChange = useStorageChangeJob(securityService, jobs, {
    onChanged: (result, target) => {
      setVaultStorageMode(target.vaultId, result.storage.mode);
      show(t("toast.storage_changed", { name: vaultName(target.vaultId) }));
      storageEnded({ ...target, result, error: null, stopped: false });
    },
    onFailed: (error, target) => {
      storageEnded({ ...target, result: null, error, stopped: false });
      if (!settingsShows(target.vaultId, "storage")) {
        show(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
      }
    },
    onCancelled: (target) => {
      storageEnded({ ...target, result: null, error: null, stopped: true });
      show(t("toast.storage_change_stopped", { name: vaultName(target.vaultId) }));
    },
    onStopRefused: (error) => show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });
  const storageJob = storageChange.job;
  const rebuild = useVaultRebuildJob(securityService, jobs, {
    onRebuilt: (result, { vaultId }, password) => {
      // The header and the index are sealed and recorded: the vault is closed, not in recovery.
      setVaultRuntimeState(vaultId, { session: null, autoClosed: false });
      show(vaultRebuiltToast(result, vaultName(vaultId), t));
      reloadVaults();
      // Ready to use: it opens with the password the rebuild ran with. The
      // rebuild no longer holds it, though the list has not drawn that yet.
      if (!password) return;
      blockOpenVaultIdsRef.current.delete(vaultId);
      lifecycle.openWithPassword(vaultId, password);
    },
    onFailed: (error) => show(t(mobileErrorI18nKey(error, "toast.vault_rebuild_failed"))),
    onCancelled: () => show(t("error.job_cancelled")),
    onStopRefused: (error) => show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });
  const rebuildJob = rebuild.job;
  /** Running deletes already told to finish the Delete now way. */
  const [deleteNowIds, setDeleteNowIds] = useState<readonly string[]>([]);
  /** The vault whose Delete now waits for its confirmation. */
  const [deleteNowAsk, setDeleteNowAsk] = useState<string | null>(null);
  const deleteJob = useVaultDeleteJob(vaultService, jobs, {
    onDeleted: (outcome, target) => {
      setDeleteNowIds([]);
      const params = { name: target.displayName, folder: outcome.folder ?? "" };
      show(
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
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      show(t(mobileErrorI18nKey(error, "error.unexpected")));
      reloadVaults();
    },
    onCancelled: (target) => {
      setDeleteNowIds([]);
      show(t("toast.vault_delete_stopped", { name: target.displayName }));
      reloadVaults();
    },
  });
  const runningDelete = deleteJob.job;
  const backupService = useBackupService();
  const [backupListRefresh, setBackupListRefresh] = useState(0);
  const changeBackup = passwordChange.backupStep;
  const changeBackupVaultId = changeBackup?.vaultId ?? null;
  const changeBackupSeenRef = useRef<string | null>(null);
  // Back up first that ended may have put a zip in place: the open Backups window lists it.
  useEffect(() => {
    if (changeBackupSeenRef.current !== null && changeBackupVaultId === null) {
      setBackupListRefresh((token) => token + 1);
    }
    changeBackupSeenRef.current = changeBackupVaultId;
  }, [changeBackupVaultId]);
  /**
   * A create refused for the items it names, until its window is closed. Its
   * row stays, as creating, until the person answers.
   */
  const [refusedImport, setRefusedImport] = useState<
    (ImportBlockedReport & { vaultId: string }) | null
  >(null);
  /**
   * What "Import without them" runs again while that window is open, with no
   * password when nothing can be imported without them. Kept out of render
   * state since it holds the new vault's password; dropped when the window
   * closes, which also lets a picked folder's listing go.
   */
  const refusedRetryRef = useRef<{ result: CreateVaultResult; password: string | null } | null>(
    null,
  );
  const backupJob = useVaultBackupJob(backupService, jobs, {
    onSaved: (vaultId) => {
      const name = vaults.find((vault) => vault.id === vaultId)?.displayName ?? vaultId;
      show(t("toast.backup_now_saved", { name }));
      setBackupListRefresh((token) => token + 1);
    },
    onFailed: (_vaultId, error) => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      show(t(mobileErrorI18nKey(error, "toast.backup_now_failed")));
    },
    onCancelled: () => show(t("toast.backup_now_cancelled")),
    onStopRefused: (_vaultId, error) =>
      show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });
  // The data folder export holds every vault: none may open until it ends.
  blockOpenVaultIdsRef.current = new Set(
    [
      exportJob?.vaultId,
      passwordJob?.vaultId,
      unlockRamJob?.vaultId,
      storageJob?.vaultId,
      rebuildJob?.vaultId,
      backupJob.job?.vaultId,
      runningDelete?.vaultId,
      ...(dataFolderExportJob ? vaults.map((vault) => vault.id) : []),
    ].filter((id): id is string => id != null),
  );

  useEffect(() => {
    if (!lifecycleRequest || !blockOpenVaultIdsRef.current.has(lifecycleRequest.vaultId)) return;
    setLifecycleRequest(null);
  }, [
    backupJob.job,
    dataFolderExportJob,
    exportJob,
    lifecycleRequest,
    passwordJob,
    rebuildJob,
    runningDelete,
    setLifecycleRequest,
    storageJob,
    unlockRamJob,
  ]);

  const backupExportFolder = useExportFolder(t("modal.backup.export_picker_title"));
  const backupExport = useBackupExportJob(backupService, jobs, {
    onExported: (written) => {
      show(t("toast.backup_export_saved", { name: fileNameOfPath(written.path) }));
    },
    onFailed: (error) => {
      if (shouldBumpVaultRootEpoch(error)) {
        void reportVaultRootIntegrityFailure(error);
        return;
      }
      show(t(mobileErrorI18nKey(error, "toast.backup_export_failed")));
    },
    onCancelled: () => {
      show(t("toast.backup_export_cancelled"));
    },
    onStopRefused: (error) => show(t(mobileErrorI18nKey(error, "error.job_not_stoppable"))),
  });

  const backupNowJob = backupJob.job;
  const pipelineStatus = useMemo(() => {
    const rowWork = { ...lifecycle.rowWork };
    for (const job of [
      exportJob,
      passwordJob,
      unlockRamJob,
      storageJob,
      rebuildJob,
      backupNowJob,
    ]) {
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
      openingVaultIds: [...lifecycle.openingVaultIds],
      closingVaultIds: [...lifecycle.closingVaultIds],
      backingUpVaultIds: [...lifecycle.backingUpVaultIds],
      exportingVaultIds: exportJob ? [exportJob.vaultId] : [],
      // A password change writing its Back up first zip shows as backing up.
      backupJobVaultIds: [
        ...(backupNowJob ? [backupNowJob.vaultId] : []),
        ...(changeBackupVaultId !== null ? [changeBackupVaultId] : []),
      ],
      backupExportVaultIds: backupExport.job ? [backupExport.job.vaultId] : undefined,
      recoveringVaultIds: [lifecycle.plainRemoveJob, rebuildJob].flatMap((job) =>
        job ? [job.vaultId] : [],
      ),
      passwordChangeVaultIds: passwordJob ? [passwordJob.vaultId] : undefined,
      kdfChangeVaultIds: unlockRamJob ? [unlockRamJob.vaultId] : undefined,
      storageChangeVaultIds: storageJob ? [storageJob.vaultId] : undefined,
      deletingVaultIds: runningDelete ? [runningDelete.vaultId] : undefined,
      deleteNowVaultIds: deleteNowIds,
      // A refused create waits for its window's answer, still creating.
      creatingVaultIds: refusedImport
        ? [...lifecycle.creatingVaultIds, refusedImport.vaultId]
        : [...lifecycle.creatingVaultIds],
      queuedVaultIds: [...lifecycle.queuedVaultIds],
      queuedOpenVaultIds: [...lifecycle.queuedOpenVaultIds],
      closeNowVaultIds: lifecycle.closeNowVaultIds,
      dataFolderExporting: dataFolderExportJob !== null,
      rowWork,
    };
  }, [
    lifecycle.backingUpVaultIds,
    lifecycle.closeNowVaultIds,
    lifecycle.closingVaultIds,
    lifecycle.creatingVaultIds,
    lifecycle.plainRemoveJob,
    lifecycle.rowWork,
    backupExport.job,
    backupNowJob,
    changeBackupVaultId,
    dataFolderExportJob,
    exportJob,
    lifecycle.openingVaultIds,
    lifecycle.queuedOpenVaultIds,
    lifecycle.queuedVaultIds,
    deleteNowIds,
    passwordJob,
    rebuildJob,
    refusedImport,
    runningDelete,
    storageJob,
    unlockRamJob,
  ]);

  /** Stop the work a row shows, whichever owner runs it. */
  const { stopVaultWork } = lifecycle;
  const stopRowWork = useCallback(
    (vaultId: string) => {
      if (exportJob?.vaultId === vaultId) vaultExport.stop();
      else if (passwordJob?.vaultId === vaultId) passwordChange.stop();
      else if (unlockRamJob?.vaultId === vaultId) unlockRamChange.stop();
      else if (storageJob?.vaultId === vaultId) storageChange.stop();
      else if (rebuildJob?.vaultId === vaultId) rebuild.stop();
      else if (backupNowJob?.vaultId === vaultId) backupJob.stop();
      else stopVaultWork(vaultId);
    },
    [
      backupJob,
      backupNowJob,
      exportJob,
      passwordChange,
      passwordJob,
      rebuild,
      rebuildJob,
      stopVaultWork,
      storageChange,
      storageJob,
      unlockRamChange,
      unlockRamJob,
      vaultExport,
    ],
  );

  /**
   * Rebuild the lost index of the vault the unlock window shows, with the
   * password typed there. The list owns the rebuild, so the window closes.
   */
  const { lifecycleVault, cancelLifecycle } = lifecycle;
  const rebuildFromUnlock = useCallback(
    (password: string) => {
      if (!lifecycleVault) return;
      if (!rebuild.rebuild(lifecycleVault.id, password)) {
        show(t("toast.vault_rebuild_busy"));
        return;
      }
      cancelLifecycle();
    },
    [cancelLifecycle, lifecycleVault, rebuild, show, t],
  );

  /** A file manager import runs in some vault. */
  const importingFiles = useFileManagerSelector((state) =>
    Object.values(state.entries).some((entry) => entry.importInFlight),
  );
  // Jobs, closes, and imports keep the phone awake until the last one ends.
  useKeepAwakeWhile(
    Object.keys(pipelineStatus.rowWork).length > 0 ||
      pipelineStatus.closingVaultIds.length > 0 ||
      backupExport.job !== null ||
      dataFolderExportJob !== null ||
      importingFiles,
    "upriv-vault-work",
  );

  const dataFolderExportCanStart = dataFolderCanExport(vaults, pipelineStatus);
  const outsideBackupVaults = vaults.filter((vault) => vault.outsideBackups).length;
  const dataFolderExportControls = useMemo<DataFolderExportControls | undefined>(
    () =>
      dataFolderService
        ? {
            canStart: dataFolderExportCanStart,
            job: dataFolderExportJob,
            written: dataFolderExportWritten,
            clearWritten: clearDataFolderExportWritten,
            onStart: (destDir, name, includeBackups) =>
              dataFolderExportCanStart && startDataFolderExport(destDir, name, includeBackups),
            onStop: stopDataFolderExport,
            outsideBackups: outsideBackupVaults,
          }
        : undefined,
    [
      clearDataFolderExportWritten,
      dataFolderExportCanStart,
      dataFolderExportJob,
      dataFolderExportWritten,
      dataFolderService,
      outsideBackupVaults,
      startDataFolderExport,
      stopDataFolderExport,
    ],
  );

  const { start: startBackupExport } = backupExport;
  const handleBackupExport = useCallback(
    (keys: readonly string[], destDir: string) => {
      if (backupsVaultId !== null) startBackupExport(backupsVaultId, keys, destDir);
    },
    [backupsVaultId, startBackupExport],
  );
  const handleBackupExportBusy = useCallback(() => {
    show(t("toast.backup_export_busy"));
  }, [show, t]);

  const backupSaveJob =
    backupJob.job !== null && backupJob.job.vaultId === backupsVaultId ? backupJob.job : null;
  const closeBackup = lifecycle.closeBackup;
  const backupCloseBackup =
    closeBackup !== null && closeBackup.vaultId === backupsVaultId
      ? {
          ...closeBackup,
          stoppingSince: lifecycle.closeNowAskedAt.get(closeBackup.vaultId) ?? null,
        }
      : null;
  const backupChangeBackup =
    changeBackup !== null && changeBackup.vaultId === backupsVaultId ? changeBackup : null;
  const closeBackupVaultId = closeBackup?.vaultId ?? null;
  const hurryRunningClose = lifecycle.hurryRunningClose;
  const handleCloseBackupStop = useCallback(() => {
    if (closeBackupVaultId !== null) hurryRunningClose(closeBackupVaultId);
  }, [closeBackupVaultId, hurryRunningClose]);
  const closeBackupSeenRef = useRef<string | null>(null);
  // A close's backup that ended put a zip in place: the open Backups window lists it.
  useEffect(() => {
    if (closeBackupSeenRef.current !== null && closeBackupVaultId === null) {
      setBackupListRefresh((token) => token + 1);
    }
    closeBackupSeenRef.current = closeBackupVaultId;
  }, [closeBackupVaultId]);
  const handleBackupSaveNow = useCallback(() => {
    const vault = backupsVault;
    if (!vault) return;
    if (backupJob.job) {
      if (backupJob.job.vaultId !== vault.id) show(t("toast.backup_now_busy"));
      return;
    }
    if (!vaultCanSaveBackupNow(vault, pipelineStatus)) return;
    backupJob.start(vault.id);
  }, [backupJob, backupsVault, pipelineStatus, show, t]);

  /** Write the export into the folder chosen in its window, named after the vault. */
  const { start: startVaultExport, stop: handleStopExportVault } = vaultExport;
  const handleConfirmExportVault = useCallback(
    (request: VaultExportRequest, destDir: string) => {
      if (!exportVault) return;
      if (startVaultExport(exportVault, request, destDir)) setExportPasswordError(null);
    },
    [exportVault, setExportPasswordError, startVaultExport],
  );

  const handleRowExport = useCallback(
    (vault: VaultListItem) => {
      const listStatus = resolveVaultListStatus(vault, pipelineStatus);
      if (!vaultService.canExportVault) return;
      if (dataFolderExportJob) {
        show(t("error.data_folder_export_busy"));
        return;
      }
      if (exportJob && exportJob.vaultId !== vault.id) {
        show(t("vault.export.busy"));
        return;
      }
      if (exportJob?.vaultId === vault.id) {
        const current = vaults.find((item) => item.id === vault.id) ?? vault;
        setExportVault(current);
        return;
      }
      if (isVaultPipelineDisplayBusy(listStatus)) {
        show(t("vault.export.blocked_opening"));
        return;
      }
      if (!vaultCanExport(vault, pipelineStatus)) {
        show(t("vault.export.blocked_open"));
        return;
      }
      setExportVault(vault);
    },
    [
      dataFolderExportJob,
      exportJob,
      pipelineStatus,
      setExportVault,
      show,
      t,
      vaultService.canExportVault,
      vaults,
    ],
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
    if (shouldBumpVaultRootEpoch(error)) {
      void reportVaultRootIntegrityFailure(error);
      return;
    }
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
      .filter(
        (vault) =>
          previous.find((item) => item.id === vault.id)?.order !== vault.order &&
          !vaultRowControls(vault, pipelineStatus).dragBlocked,
      )
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
        if (shouldBumpVaultRootEpoch(error)) {
          void reportVaultRootIntegrityFailure(error);
          return;
        }
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

  /** The vault's folder is gone: drop its row, its place in a group, and its windows. */
  function forgetDeletedVault(vaultId: string) {
    groupBusyGenRef.current += 1;
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
    if (modals.settingsVault?.id === vaultId) {
      setSettingsVault(null);
      setSettingsArea(null);
    }
    setNoteVaultId((current) => (current === vaultId ? null : current));
    setBackupsVault((current) => (current?.id === vaultId ? null : current));
    setDeleteVaultId((current) => (current === vaultId ? null : current));
    modals.setVaultInfoVaultId((current) => (current === vaultId ? null : current));
    purgeForVaultClose(vaultId);
    if (lifecycleRequest?.vaultId === vaultId) {
      setLifecycleRequest(null);
    }
  }

  /**
   * Start the delete of `vaultId` as a job the list owns, or go on with one
   * that did not finish, which keeps the outside-backups choice it began
   * with. `now` removes the files with no overwrite. False when it cannot
   * start; the reason is a toast.
   */
  const startVaultDelete = (vaultId: string, outsideBackups: boolean, now: boolean): boolean => {
    const target = vaults.find((vault) => vault.id === vaultId);
    if (!target) return false;
    if (!vaultService.canDeleteVault) {
      show(t("error.not_implemented"));
      return false;
    }
    if (runningDelete) {
      show(t("vault.delete.busy"));
      return false;
    }
    if (!isVaultDeleteUnfinished(target, pipelineStatus)) {
      if (isVaultPipelineBusy(vaultId)) {
        show(t("toast.pipeline_busy"));
        return false;
      }
      const hold = vaultDeleteHold(target, pipelineStatus);
      if (hold) {
        show(t(VAULT_DELETE_HOLD_I18N_KEY[hold]));
        return false;
      }
      lifecycle.cancelClosingHold(vaultId);
    }
    const started = deleteJob.deleteVault(
      { vaultId, displayName: target.displayName },
      outsideBackups,
      now,
    );
    if (started && now) setDeleteNowIds([vaultId]);
    return started;
  };

  /** Continue a delete that did not finish, or ask before Delete now. */
  const handleDeleteWork = (vault: VaultListItem, now: boolean) => {
    if (now) setDeleteNowAsk(vault.id);
    else startVaultDelete(vault.id, false, false);
  };

  /** Delete now, once confirmed: tell the running delete, or run one with no overwrite. */
  const confirmDeleteNow = () => {
    const vaultId = deleteNowAsk;
    setDeleteNowAsk(null);
    if (!vaultId) return;
    if (runningDelete?.vaultId !== vaultId) {
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
        show(t(mobileErrorI18nKey(error, "error.unexpected")));
      },
    );
  };

  const handleNoteChange = useCallback(
    async (vaultId: string, note: string): Promise<boolean> => {
      const heldRow = vaults.find((vault) => vault.id === vaultId);
      if (heldRow && vaultRowControls(heldRow, pipelineStatus).noteBlocked) return false;
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
        if (shouldBumpVaultRootEpoch(error)) {
          void reportVaultRootIntegrityFailure(error);
          return false;
        }
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
        if (shouldBumpVaultRootEpoch(error)) {
          void reportVaultRootIntegrityFailure(error);
          return false;
        }
        show(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
        return false;
      }
      if (noteSaveGenerationRef.current.get(vaultId) !== nextGeneration) return false;
      return true;
    },
    [pipelineStatus, reportVaultRootIntegrityFailure, setVaults, show, t, vaultService, vaults],
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

  const handleUnlockPresetSaved = useCallback(
    (vaultId: string, unlockPreset: KdfUnlockPreset) => {
      setVaults((prev) =>
        prev.map((vault) =>
          vault.id === vaultId ? applyVaultUnlockPreset(vault, unlockPreset) : vault,
        ),
      );
    },
    [setVaults],
  );

  const handlePersistBusyChange = useCallback((vaultIds: readonly string[] | null) => {
    settingsPersistVaultIdsRef.current = new Set(vaultIds ?? []);
  }, []);

  useEffect(() => {
    if (!groupLimit.timedOut || !groupBusy) return;
    groupBusyGenRef.current += 1;
    setGroupBusy(false);
    show(t("error.operation_timed_out"));
  }, [groupLimit.timedOut, groupBusy, setGroupBusy, show, t]);

  useEffect(() => {
    if (!repairLimit.timedOut || !repairBusy) return;
    repairGenRef.current += 1;
    setRepairBusy(false);
    show(t("error.operation_timed_out"));
  }, [repairLimit.timedOut, repairBusy, setRepairBusy, show, t]);

  /**
   * The vault a create listed was not made: what it picked is let go, and its
   * row and the group it would join go.
   */
  const dropCreatePlaceholder = (result: CreateVaultResult) => {
    const claimed = contentTreeClaimedForCreate(result.vaultId);
    if (claimed) releaseContentJob(claimed);
    if (result.source === "import") {
      void releaseImportCache(result.importFilePath ?? "").catch(() => undefined);
    }
    const pendingEffect = pendingCreateGroupsRef.current.get(result.vaultId);
    pendingCreatesRef.current.delete(result.vaultId);
    pendingCreateGroupsRef.current.delete(result.vaultId);
    sessionWritesRef.current.delete(result.vaultId);
    setVaults((current) => current.filter((vault) => vault.id !== result.vaultId));
    if (pendingEffect) {
      setGroups((current) => rollbackPendingCreateGroupEffect(current, pendingEffect));
    }
  };

  /**
   * Run the create of a vault whose row is listed. `leaveOut`: the person
   * chose to import without the items that cannot be imported.
   */
  const runCreate = (result: CreateVaultResult, password: string, leaveOut: boolean) => {
    // Take the picked folder now: the wizard lets go of it when it closes, and
    // this create may wait behind another.
    const claim = claimsContentTree(result)
      ? claimContentTreeForCreate(result.vaultId, result.importFilePath ?? "")
      : Promise.resolve();
    claim.catch(() => undefined);

    const welcome = buildVaultWelcomeFiles(result, { t, locale });
    const importPackage = createVaultImportPackage(result, password);
    lifecycle.startCreatePipeline(
      result.vaultId,
      async (job) => {
        await claim;
        const created = await vaultService.createVault(
          {
            password,
            unlockPreset: result.unlockPreset,
            settings: result.settings,
            importPackage:
              importPackage && leaveOut ? { ...importPackage, leaveOut } : importPackage,
            welcome,
          },
          job,
        );
        return created;
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
        // Core may have kept a stopped import in recovery: its answer says.
        onRemoved: () => {
          dropCreatePlaceholder(result);
          reloadVaults();
        },
        onBlocked: (blocked) => {
          refusedRetryRef.current = { result, password: blocked.whole ? null : password };
          setRefusedImport({
            vaultId: result.vaultId,
            vaultName: result.displayName,
            blocked,
            stage: "refused",
          });
        },
      },
    );
  };

  const handleCreateVault = (result: CreateVaultResult, password: string) => {
    // Another vault being created only queues this one. The same id still in
    // flight is taken.
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
    runCreate(result, password, false);
  };

  return {
    t,
    settings,
    patchSettings,
    show,
    dismiss,
    toast,
    refusedImport,
    retryRefusedImport: () => {
      const retry = refusedRetryRef.current;
      refusedRetryRef.current = null;
      setRefusedImport(null);
      if (retry?.password != null) runCreate(retry.result, retry.password, true);
      else if (retry) dropCreatePlaceholder(retry.result);
    },
    closeRefusedImport: () => {
      const retry = refusedRetryRef.current;
      refusedRetryRef.current = null;
      setRefusedImport(null);
      if (!retry) return;
      if (claimsContentTree(retry.result)) {
        void releasePendingImport(retry.result.importFilePath ?? "").catch(() => undefined);
      }
      dropCreatePlaceholder(retry.result);
    },
    openFromVault,
    setMeasuredHeaderHeight,
    ...state,
    ...modals,
    insets,
    appHeaderHeight,
    groupsRef,
    groupBusyGenRef,
    repairGenRef,
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
    existingDisplayNames,
    noteVault,
    vaultInfoVault,
    settingsVault,
    backupsVault,
    backupSaveJob,
    backupCloseBackup,
    backupChangeBackup,
    backupListRefresh,
    handleBackupSaveNow,
    backupExportFolder,
    backupExportJob: backupExport.job,
    handleBackupExport,
    handleBackupExportBusy,
    handleBackupExportStop: backupExport.stop,
    dataFolderExportControls,
    displayRowsRef,
    searchNoMatches,
    visibleVaults,
    allVaultsHidden,
    lifecycle,
    reload,
    refresh,
    forgetPlainRecord,
    openCreate,
    closeCreate,
    pipelineStatus,
    stopRowWork,
    rebuildFromUnlock,
    passwordJob,
    passwordOutcome,
    changePassword: passwordChange.changePassword,
    finishPasswordChange: passwordChange.finish,
    stopPasswordChange: passwordChange.stop,
    unlockRamJob,
    unlockRamOutcome,
    changeKdf: unlockRamChange.changeKdf,
    stopUnlockRamChange: unlockRamChange.stop,
    storageJob,
    storageOutcome,
    changeStorage: storageChange.changeStorage,
    stopStorageChange: storageChange.stop,
    deleteVault,
    runningDelete,
    startVaultDelete,
    handleDeleteWork,
    deleteNowVault: deleteNowAsk
      ? (vaults.find((vault) => vault.id === deleteNowAsk) ?? null)
      : null,
    cancelDeleteNow: () => setDeleteNowAsk(null),
    confirmDeleteNow,
    backupSaveStop: backupJob.stop,
    handleCloseBackupStop,
    handleChangeBackupStop: passwordChange.skipBackup,
    handleConfirmExportVault,
    handleStopExportVault,
    handleRowExport,
    exportFolders,
    exportRun,
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
    handleNoteChange,
    vaultsRef,
    handleVaultSettingsSaved,
    handlePersistBusyChange,
    handleCreateVault,
    vaultGroupService,
  };
}
