import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppSettingsModal, useAppSettingsContext } from "@/features/app-settings";
import { vaultBlocksBulkExport } from "@/features/app-settings/vaultBulkExport";
import { CreateVaultWizardModal, type CreateVaultResult } from "@/features/vault-create";
import { createDraftFromBackup } from "@/features/vault-create/createDraftFromBackup";
import type { CreateVaultDraft } from "@/features/vault-create/createVaultTypes";
import { FileManagerLayer, useFileManager } from "@/features/file-manager";
import { HelpModal } from "@/features/help";
import { LogsModal } from "@/features/logs";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import { resolveVaultDisplayStatus, resolveVaultListStatus } from "@/types";
import { CLOSING_PIPELINE_STEPS, runMockClosingPipeline } from "./vaultClosingPipeline";
import { OPENING_PIPELINE_STEPS, runMockOpeningPipeline } from "./vaultOpeningPipeline";
import { useVaultPipelineRun } from "./useVaultPipelineRun";
import { exportVaultArchive } from "./exportVaultArchive";
import {
  getMockVaultSettings,
  registerMockVaultSettings,
  unregisterMockVaultSettings,
} from "./mockVaultSettings";
import { mockVaultWorkspacePath } from "./mockVaultFolder";
import { MOCK_VAULTS } from "./mockVaults";
import { touchVaultLastAccessed } from "./vaultLastAccessed";
import { VaultList } from "./VaultList";
import { VaultListHeader, useRefreshState } from "./VaultListHeader";
import { VaultListSectionHeader } from "./VaultListSectionHeader";
import { VaultBackupsModal } from "./VaultBackupsModal";
import { VaultClosingOverlay } from "./VaultClosingOverlay";
import { VaultOpeningOverlay } from "./VaultOpeningOverlay";
import { VaultListToast } from "./VaultListToast";
import { VaultNoteModal } from "./VaultNoteModal";
import { VaultRecoveryModal, type RecoveryAction } from "./VaultRecoveryModal";
import { VaultSettingsModal } from "./VaultSettingsModal";
import { VaultLifecycleModal } from "./VaultLifecycleModal";
import {
  clearVaultPasswordInRam,
  seedInitialOpenVaultPasswords,
  setVaultPasswordInRam,
} from "./mockVaultSessionPassword";
import type { VaultLifecycleRequest } from "./vaultLifecycleTypes";
import type { VaultLifecycleIntent } from "./vaultLifecycleTypes";
import type { VaultListItem } from "./types";
import type { VaultListSort } from "./vaultListSort";
import type { VaultListViewMode } from "./vaultListView";
import { useVaultAutoClose } from "./useVaultAutoClose";
import { useVaultListState } from "./useVaultListState";
import { useVaultListToast } from "./useVaultListToast";

export function VaultListPage() {
  const { t } = useTranslation();
  const { openFromVault, purgeForVaultClose } = useFileManager();
  const { settings, patchSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const showHiddenVaults = settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [backupVaultId, setBackupVaultId] = useState<string | null>(null);
  const [settingsVaultId, setSettingsVaultId] = useState<string | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
  const [createVaultInitialDraft, setCreateVaultInitialDraft] = useState<CreateVaultDraft | null>(
    null,
  );
  const [lifecycleRequest, setLifecycleRequest] = useState<VaultLifecycleRequest | null>(null);
  const [recoveryVaultId, setRecoveryVaultId] = useState<string | null>(null);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const pipeline = useVaultPipelineRun();
  const pipelineBackgroundRef = useRef(false);
  const { message: toastMessage, show: showToast, dismiss: dismissToast } = useVaultListToast();

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

  const {
    vaults,
    displayVaults,
    sort,
    setSort,
    viewMode,
    setViewMode,
    canReorder,
    draggingId,
    dragOverId,
    resetList,
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
  } = useVaultListState(MOCK_VAULTS, { ...listDefaults, showHiddenVaults });

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

  const noteVault = useMemo(
    () => vaults.find((vault) => vault.id === noteVaultId) ?? null,
    [vaults, noteVaultId],
  );

  const backupVault = useMemo(
    () => vaults.find((vault) => vault.id === backupVaultId) ?? null,
    [vaults, backupVaultId],
  );

  const settingsVault = useMemo(
    () => vaults.find((vault) => vault.id === settingsVaultId) ?? null,
    [vaults, settingsVaultId],
  );

  const lifecycleVault = useMemo(
    () =>
      lifecycleRequest
        ? (vaults.find((vault) => vault.id === lifecycleRequest.vaultId) ?? null)
        : null,
    [lifecycleRequest, vaults],
  );

  const recoveryVault = useMemo(
    () => vaults.find((vault) => vault.id === recoveryVaultId) ?? null,
    [vaults, recoveryVaultId],
  );

  const pipelineVault = useMemo(() => {
    if (!pipeline.run) return null;
    return vaults.find((vault) => vault.id === pipeline.run!.vaultId) ?? null;
  }, [pipeline.run, vaults]);

  const pipelineOpeningVaultId = pipeline.run?.kind === "open" ? pipeline.run.vaultId : null;

  const pipelineClosingIntent =
    pipeline.run?.kind === "close" || pipeline.run?.kind === "seal" ? pipeline.run.kind : null;

  useEffect(() => {
    seedInitialOpenVaultPasswords(
      MOCK_VAULTS.filter((vault) => vault.session === "open").map((vault) => vault.id),
    );
  }, []);

  const revertCloseFailure = useCallback(
    (vaultId: string) => {
      const vault = vaults.find((item) => item.id === vaultId);
      if (!vault) return;
      setVaultRuntimeState(vaultId, {
        session: "open",
        persistence: vault.storageMode === "plain" ? "sealed" : "closed",
      });
    },
    [setVaultRuntimeState, vaults],
  );

  const handlePipelineError = useCallback(
    (vaultId: string, kind: "open" | "close" | "seal", errorKey: I18nKey) => {
      const wasBackground = pipelineBackgroundRef.current;
      pipelineBackgroundRef.current = false;

      dismissToast();
      showToast(t(errorKey), 8000);

      if (kind === "close" || kind === "seal") {
        revertCloseFailure(vaultId);
      }

      if (wasBackground) {
        pipeline.dismissFailure();
      }
    },
    [dismissToast, pipeline, revertCloseFailure, showToast, t],
  );

  const existingVaultIds = useMemo(() => vaults.map((vault) => vault.id), [vaults]);
  const existingOrders = useMemo(() => vaults.map((vault) => vault.order ?? 0), [vaults]);

  const handleCreateVault = useCallback(
    (result: CreateVaultResult) => {
      registerMockVaultSettings(result.settings);
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
    [addVault, t],
  );

  const handleCreateVaultFromBackup = useCallback(
    (filename: string) => {
      if (!backupVault) return;
      setCreateVaultInitialDraft(createDraftFromBackup(filename, backupVault.id, existingOrders));
      setBackupVaultId(null);
      setCreateVaultOpen(true);
    },
    [backupVault, existingOrders],
  );

  const handleCloseCreateVault = useCallback(() => {
    setCreateVaultOpen(false);
    setCreateVaultInitialDraft(null);
  }, []);

  const handleRefresh = useCallback(() => {
    resetList();
    runRefreshAnimation();
  }, [resetList, runRefreshAnimation]);

  const finishOpenVault = useCallback(
    (vaultId: string) => {
      const vault = vaults.find((item) => item.id === vaultId);
      setVaultRuntimeState(vaultId, {
        session: "open",
        persistence: vault?.storageMode === "plain" ? "sealed" : "closed",
        canSeal: vault?.storageMode === "encrypted_dir",
        ...touchVaultLastAccessed(t("vault.last_accessed.just_now")),
      });
    },
    [setVaultRuntimeState, t, vaults],
  );

  const finishCloseOrSeal = useCallback(
    (vaultId: string, intent: Extract<VaultLifecycleIntent, "close" | "seal">) => {
      purgeForVaultClose(vaultId);
      if (intent === "close") {
        setVaultRuntimeState(vaultId, { session: null, persistence: "closed", canSeal: false });
      } else {
        setVaultRuntimeState(vaultId, { session: null, persistence: "sealed", canSeal: false });
      }
      clearVaultPasswordInRam(vaultId);
    },
    [purgeForVaultClose, setVaultRuntimeState],
  );

  const notifyPipelineComplete = useCallback(
    (vaultId: string, kind: "open" | "close" | "seal") => {
      dismissToast();
      if (!pipelineBackgroundRef.current) return;

      const vault = vaults.find((item) => item.id === vaultId);
      if (!vault) return;

      const key =
        kind === "open"
          ? "toast.pipeline_complete_open"
          : kind === "seal"
            ? "toast.pipeline_complete_seal"
            : "toast.pipeline_complete_close";

      showToast(t(key, { name: vault.displayName }));
      pipelineBackgroundRef.current = false;
    },
    [dismissToast, showToast, t, vaults],
  );

  const startOpenPipeline = useCallback(
    (vaultId: string) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vaultId)) return;

      pipelineBackgroundRef.current = false;
      pipeline.start({
        vaultId,
        kind: "open",
        stepCount: OPENING_PIPELINE_STEPS.length,
        runPipeline: runMockOpeningPipeline,
        onComplete: () => {
          finishOpenVault(vaultId);
          notifyPipelineComplete(vaultId, "open");
        },
        onError: (errorKey) => handlePipelineError(vaultId, "open", errorKey),
      });
    },
    [finishOpenVault, handlePipelineError, notifyPipelineComplete, pipeline],
  );

  const startClosePipeline = useCallback(
    (vault: VaultListItem, intent: Extract<VaultLifecycleIntent, "close" | "seal">) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;

      pipelineBackgroundRef.current = false;
      setVaultRuntimeState(vault.id, { session: "closing" });

      const started = pipeline.start({
        vaultId: vault.id,
        kind: intent,
        stepCount: CLOSING_PIPELINE_STEPS.length,
        runPipeline: runMockClosingPipeline,
        onComplete: () => {
          finishCloseOrSeal(vault.id, intent);
          notifyPipelineComplete(vault.id, intent);
        },
        onError: (errorKey) => handlePipelineError(vault.id, intent, errorKey),
      });

      if (!started) {
        revertCloseFailure(vault.id);
      }
    },
    [
      finishCloseOrSeal,
      handlePipelineError,
      notifyPipelineComplete,
      pipeline,
      revertCloseFailure,
      setVaultRuntimeState,
    ],
  );

  const handlePipelineBackground = useCallback(() => {
    if (!pipeline.run || !pipelineVault) return;

    pipelineBackgroundRef.current = true;
    pipeline.moveToBackground();

    const { kind } = pipeline.run;
    const toastKey =
      kind === "open"
        ? "toast.pipeline_background_open"
        : kind === "seal"
          ? "toast.pipeline_background_seal"
          : "toast.pipeline_background_close";

    showToast(t(toastKey, { name: pipelineVault.displayName }), 0);
  }, [pipeline, pipelineVault, showToast, t]);

  const handleLockVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;
      const intent = vault.storageMode === "plain" ? "seal" : "close";
      setLifecycleRequest({ vaultId: vault.id, intent });
    },
    [pipeline],
  );

  const handleUnlockVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;
      if (resolveVaultDisplayStatus(vault) === "recovery") {
        setRecoveryVaultId(vault.id);
        return;
      }
      setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
    },
    [pipeline],
  );

  const handleSealVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;
      setLifecycleRequest({ vaultId: vault.id, intent: "seal" });
    },
    [pipeline],
  );

  const handleExportVault = useCallback(
    (vault: VaultListItem) => {
      if (resolveVaultListStatus(vault, pipelineOpeningVaultId) === "opening") {
        showToast(t("vault.export.blocked_opening"));
        return;
      }
      if (vaultBlocksBulkExport(vault)) {
        showToast(t("vault.export.blocked_open"));
        return;
      }
      exportVaultArchive(vault);
      showToast(t("vault.export.success", { name: vault.displayName }));
    },
    [pipelineOpeningVaultId, showToast, t],
  );

  const handleOpenFolder = useCallback(
    (vault: VaultListItem) => {
      showToast(t("toast.open_folder_mock", { path: mockVaultWorkspacePath(vault) }), 8000);
    },
    [showToast, t],
  );

  const handleAutoCloseVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;
      const { close: closeSettings } = getMockVaultSettings(vault.id);
      const intent =
        vault.storageMode === "plain" || closeSettings.default_action === "seal" ? "seal" : "close";
      startClosePipeline(vault, intent);
    },
    [pipeline, startClosePipeline],
  );

  useVaultAutoClose({
    vaults,
    isPipelineRunning: pipeline.isRunning,
    onWarn: (_vault, secondsLeft) => {
      showToast(t("warning.auto_close_soon", { seconds: String(secondsLeft) }));
    },
    onAutoClose: handleAutoCloseVault,
  });

  const handleNoteChange = useCallback(
    (vaultId: string, note: string) => {
      updateNote(vaultId, note);
      const settings = getMockVaultSettings(vaultId);
      registerMockVaultSettings({
        ...settings,
        vault: { ...settings.vault, note },
      });
    },
    [updateNote],
  );

  const handleLifecycleConfirm = useCallback(
    (password: string | null) => {
      if (!lifecycleRequest || !lifecycleVault) return;
      const { vaultId, intent } = lifecycleRequest;

      if (intent === "unlock") {
        setLifecycleRequest(null);
        if (password) setVaultPasswordInRam(vaultId, password);
        startOpenPipeline(vaultId);
        return;
      }

      setLifecycleRequest(null);
      if (password) setVaultPasswordInRam(vaultId, password);
      startClosePipeline(lifecycleVault, intent);
    },
    [lifecycleRequest, lifecycleVault, startClosePipeline, startOpenPipeline],
  );

  const handleRecoveryAction = useCallback(
    (action: RecoveryAction) => {
      if (!recoveryVaultId || action === "compare") return;

      if (action === "use_store") {
        const vaultId = recoveryVaultId;
        setRecoveryVaultId(null);
        if (pipeline.isRunning) return;
        startOpenPipeline(vaultId);
        return;
      }

      setRecoverySubmitting(true);
      try {
        if (action === "reimport_archive") {
          setVaultRuntimeState(recoveryVaultId, { session: null, persistence: "closed" });
        } else if (action === "discard_workspace") {
          purgeForVaultClose(recoveryVaultId);
          setVaultRuntimeState(recoveryVaultId, { session: null, persistence: "sealed" });
          clearVaultPasswordInRam(recoveryVaultId);
        }

        setRecoveryVaultId(null);
      } finally {
        setRecoverySubmitting(false);
      }
    },
    [
      pipeline.isRunning,
      purgeForVaultClose,
      recoveryVaultId,
      setVaultRuntimeState,
      startOpenPipeline,
    ],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      <VaultListHeader
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onOpenSystemSettings={() => setAppSettingsOpen(true)}
        onViewLogs={() => setLogsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onNewVault={() => setCreateVaultOpen(true)}
      />
      <main className="flex flex-1 flex-col items-center py-10 md:py-12">
        <section className="w-full max-w-vault-list px-margin-mobile md:px-margin-desktop">
          <VaultListSectionHeader
            sort={sort}
            onSortChange={handleSortChange}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
          />
          <VaultList
            vaults={displayVaults}
            pipelineOpeningVaultId={pipelineOpeningVaultId}
            pipelineActiveVaultId={pipeline.run?.vaultId ?? null}
            allVaultsHidden={displayVaults.length === 0 && vaults.some((vault) => vault.hidden)}
            viewMode={viewMode}
            canReorder={canReorder}
            draggingId={draggingId}
            dragOverId={dragOverId}
            onOpenBackups={setBackupVaultId}
            onOpenNote={setNoteVaultId}
            onOpenSettings={setSettingsVaultId}
            onExportVault={handleExportVault}
            onOpenFolder={handleOpenFolder}
            onOpenFileManager={openFromVault}
            onLockVault={handleLockVault}
            onUnlockVault={handleUnlockVault}
            onSealVault={handleSealVault}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        </section>
      </main>
      <VaultLifecycleModal
        vault={lifecycleVault}
        intent={lifecycleRequest?.intent ?? null}
        open={lifecycleRequest !== null}
        onClose={() => setLifecycleRequest(null)}
        onConfirm={handleLifecycleConfirm}
      />
      <VaultRecoveryModal
        vault={recoveryVault}
        open={recoveryVaultId !== null}
        submitting={recoverySubmitting}
        onClose={() => {
          if (!recoverySubmitting) setRecoveryVaultId(null);
        }}
        onAction={handleRecoveryAction}
      />
      <VaultClosingOverlay
        vault={pipelineVault}
        intent={pipelineClosingIntent}
        open={Boolean(pipeline.run?.foreground && pipelineClosingIntent)}
        activeStep={pipeline.run?.activeStep ?? 0}
        errorKey={pipeline.run?.errorKey ?? null}
        onBackground={handlePipelineBackground}
        onDismissError={pipeline.dismissFailure}
      />
      <VaultOpeningOverlay
        vault={pipelineVault}
        open={Boolean(pipeline.run?.foreground && pipeline.run?.kind === "open")}
        activeStep={pipeline.run?.activeStep ?? 0}
        errorKey={pipeline.run?.errorKey ?? null}
        onBackground={handlePipelineBackground}
        onDismissError={pipeline.dismissFailure}
      />
      <VaultListToast message={toastMessage} onDismiss={dismissToast} />
      <VaultNoteModal
        vault={noteVault}
        open={noteVaultId !== null}
        onClose={() => setNoteVaultId(null)}
        onNoteChange={handleNoteChange}
      />
      <VaultBackupsModal
        vault={backupVault}
        open={backupVaultId !== null}
        onClose={() => setBackupVaultId(null)}
        onCreateVaultFromBackup={handleCreateVaultFromBackup}
      />
      <VaultSettingsModal
        vault={settingsVault}
        open={settingsVaultId !== null}
        onClose={() => setSettingsVaultId(null)}
        onVaultSettingsSaved={updateVaultSettings}
        onVaultDelete={(vaultId) => {
          purgeForVaultClose(vaultId);
          clearVaultPasswordInRam(vaultId);
          unregisterMockVaultSettings(vaultId);
          removeVault(vaultId);
        }}
      />
      <FileManagerLayer />
      <AppSettingsModal
        open={appSettingsOpen}
        vaults={vaults}
        onClose={() => setAppSettingsOpen(false)}
      />
      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CreateVaultWizardModal
        open={createVaultOpen}
        existingVaultIds={existingVaultIds}
        existingOrders={existingOrders}
        initialDraft={createVaultInitialDraft}
        onClose={handleCloseCreateVault}
        onCreate={handleCreateVault}
      />
    </div>
  );
}
