import { useCallback, useEffect, useMemo } from "react";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useAppRefresh } from "@/features/system/refresh";
import type { CreateVaultResult } from "@/features/vaults/create";
import { createDraftFromBackup, type VaultListSort, type VaultListViewMode } from "@upriv/shared";
import { useFileManager } from "@/features/vaults/file-manager";
import { useTranslation } from "@/i18n";
import { useVaultLifecycleActions } from "@/features/vaults/lifecycle";
import { useToast } from "@/hooks/useToast";
import { useVaultListState } from "./useVaultListState";
import { useVaultListModals } from "./useVaultListModals";

export function useVaultListScreen() {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const { openFromVault } = useFileManager();
  const { settings, patchSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const showHiddenVaults = settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useToast();

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

  const { isRefreshing, refresh } = useAppRefresh({ applyVaultList: initializeVaults });

  useEffect(() => {
    let cancelled = false;
    void vaultService.listVaults().then((rows) => {
      if (cancelled) return;
      initializeVaults(rows);
      lifecycleService.seedInitialOpenVaultPasswords(
        rows.filter((vault) => vault.session === "open").map((vault) => vault.id),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [initializeVaults, lifecycleService, vaultService]);

  const modals = useVaultListModals(vaults);

  const lifecycle = useVaultLifecycleActions({
    vaults,
    setVaultRuntimeState,
    modals,
    showToast,
    dismissToast,
    t,
  });

  const handleSortChange = useCallback(
    (next: VaultListSort) => {
      setSort(next);
      patchSettings({
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
      patchSettings({ ui: { vault_list_view: next } });
    },
    [patchSettings, setViewMode],
  );

  const existingVaultIds = useMemo(() => vaults.map((vault) => vault.id), [vaults]);
  const existingOrders = useMemo(() => vaults.map((vault) => vault.order ?? 0), [vaults]);

  const handleCreateVault = useCallback(
    (result: CreateVaultResult) => {
      void vaultService.registerSettings(result.vaultId, result.settings);
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
    [addVault, t, vaultService],
  );

  const handleCreateVaultFromBackup = useCallback(
    (filename: string) => {
      if (!modals.backupVault) return;
      modals.setCreateVaultInitialDraft(
        createDraftFromBackup(filename, modals.backupVault.id, existingOrders),
      );
      modals.setBackupVaultId(null);
      modals.setCreateVaultOpen(true);
    },
    [existingOrders, modals],
  );

  const handleNoteChange = useCallback(
    (vaultId: string, note: string) => {
      updateNote(vaultId, note);
      void vaultService.getSettings(vaultId).then((settings) => {
        if (!settings) return;
        void vaultService.registerSettings(vaultId, {
          ...settings,
          vault: { ...settings.vault, note },
        });
      });
    },
    [updateNote, vaultService],
  );

  const handleVaultDelete = useCallback(
    (vaultId: string) => {
      lifecycle.handleVaultDelete(vaultId);
      removeVault(vaultId);
    },
    [lifecycle, removeVault],
  );

  return {
    isReady,
    openFromVault,
    header: {
      onRefresh: () => {
        void refresh();
      },
      isRefreshing,
      onOpenSystemSettings: () => modals.setAppSettingsOpen(true),
      onViewLogs: () => modals.setLogsOpen(true),
      onOpenHelp: () => modals.setHelpOpen(true),
      onNewVault: () => modals.setCreateVaultOpen(true),
    },
    list: {
      vaults,
      displayVaults,
      sort,
      onSortChange: handleSortChange,
      viewMode,
      onViewModeChange: handleViewModeChange,
      pipelineOpeningVaultId: lifecycle.pipelineOpeningVaultId,
      pipelineActiveVaultId: lifecycle.pipeline.run?.vaultId ?? null,
      allVaultsHidden: displayVaults.length === 0 && vaults.some((vault) => vault.hidden),
      canReorder,
      draggingId,
      dragOverId,
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
      onVaultSettingsSaved: updateVaultSettings,
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
      onClose: modals.closeCreateVault,
      onCreate: handleCreateVault,
    },
  };
}
