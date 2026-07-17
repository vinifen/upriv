import { useCallback, useEffect, useMemo, useRef } from "react";
import { useVaultService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useAppRefresh } from "@/features/system/refresh";
import type { CreateVaultResult } from "@upriv/shared";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  createDraftForImportSource,
  createDraftForScratchSource,
  createDraftFromBackup,
  createDraftFromImportArchive,
  type VaultListSort,
  type VaultListViewMode,
} from "@upriv/shared";
import { useFileManager } from "@/features/vaults/file-manager";
import { useTranslation } from "@/i18n";
import { useVaultLifecycleActions } from "@/features/vaults/lifecycle";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useDaemonReady } from "@/lib/useDaemonReady";
import { useVaultListState } from "./useVaultListState";
import { useVaultListModals } from "./useVaultListModals";
import { useVaultArchiveDrop } from "./useVaultArchiveDrop";

export function useVaultListScreen() {
  const { t } = useTranslation();
  const vaultService = useVaultService();
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

  const listState = useVaultListState([], { ...listDefaults, showHiddenVaults, reloadVaults });

  const {
    isReady,
    initializeVaults,
    vaults,
    displayVaults,
    sort,
    setSort,
    viewMode,
    setViewMode,
    canReorder,
    draggingId,
    dragOverId,
    updateNote,
    removeVault,
    addVault,
    setVaultRuntimeState,
    updateVaultSettings,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  } = listState;

  const { isRefreshing, refresh } = useAppRefresh({
    applyVaultList: initializeVaults,
    onError: (error) => showError(error, "toast.refresh_failed"),
  });

  useEffect(() => {
    let cancelled = false;
    void vaultService
      .listVaults()
      .then((rows) => {
        if (cancelled) return;
        initializeVaults(rows);
        syncWithVaultList(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        showError(error, "toast.refresh_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [initializeVaults, showError, syncWithVaultList, vaultService]);

  const modals = useVaultListModals(vaults);

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

  const handleCreateVault = useCallback(
    (result: CreateVaultResult) => {
      void vaultService
        .registerSettings(result.vaultId, result.settings)
        .catch((error) => showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED));
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
    },
    [addVault, showError, t, vaultService],
  );

  const handleVaultSettingsSaved = useCallback(
    (vaultId: string, patch: Parameters<typeof updateVaultSettings>[1]) => {
      const previous = vaults.find((vault) => vault.id === vaultId);
      updateVaultSettings(vaultId, patch);
      if (previous && previous.storageMode !== patch.storageMode) {
        purgeForVaultClose(vaultId);
        if (previous.session === "open") {
          setVaultRuntimeState(vaultId, {
            session: null,
            persistence: "closed",
            canSeal: patch.canSeal,
          });
          showToast(t("warning.storage_mode_requires_close"));
        }
      }
    },
    [purgeForVaultClose, setVaultRuntimeState, showToast, t, updateVaultSettings, vaults],
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
    modals.appSettingsOpen ||
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
        await vaultService.unregisterSettings(vaultId);
      } catch (error) {
        showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
        return;
      }

      lifecycle.handleVaultDelete(vaultId);
      removeVault(vaultId);
      modals.setSettingsVaultId(null);
      modals.setNoteVaultId(null);
      modals.setBackupVaultId(null);
      if (modals.lifecycleRequest?.vaultId === vaultId) {
        modals.setLifecycleRequest(null);
      }
      if (modals.recoveryVaultId === vaultId) {
        modals.setRecoveryVaultId(null);
      }
    },
    [lifecycle, modals, removeVault, showError, showToast, t, vaultService],
  );

  return {
    isReady: isReady && daemonReady,
    openFromVault,
    header: {
      onRefresh: () => {
        void refresh();
      },
      isRefreshing,
      onOpenSystemSettings: () => modals.setAppSettingsOpen(true),
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
      displayVaults,
      sort,
      onSortChange: handleSortChange,
      viewMode,
      onViewModeChange: handleViewModeChange,
      pipelineListStatus: lifecycle.pipelineListStatus,
      isVaultPipelineBusy: lifecycle.pipeline.isVaultPipelineBusy,
      allVaultsHidden: displayVaults.length === 0 && vaults.some((vault) => vault.hidden),
      canReorder,
      draggingId,
      dragOverId,
      onCreateFromScratch: handleCreateFromScratch,
      onImportArchive: handleImportArchive,
      onOpenBackups: modals.setBackupVaultId,
      onOpenNote: modals.setNoteVaultId,
      onOpenSettings: modals.setSettingsVaultId,
      onExportVault: lifecycle.handleExportVault,
      onOpenFolder: lifecycle.handleOpenFolder,
      onLockVault: lifecycle.handleLockVault,
      onUnlockVault: lifecycle.handleUnlockVault,
      onSealVault: lifecycle.handleSealVault,
      onDragStart,
      onDragEnd,
      onDragOver,
      onDragLeave,
      onDrop,
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
    },
    appSettings: {
      open: modals.appSettingsOpen,
      vaults,
      onClose: () => modals.setAppSettingsOpen(false),
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
      initialDraft: modals.createVaultInitialDraft,
      initialStep: modals.createVaultInitialStep,
      onClose: modals.closeCreateVault,
      onCreate: handleCreateVault,
    },
  };
}
