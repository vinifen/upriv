import { useCallback, useMemo, useRef } from "react";
import { type VaultLifecycleIntent, type VaultPersistence, type VaultSession, resolveVaultDisplayStatus, resolveVaultListStatus, touchVaultLastAccessed, type VaultListItem } from "@upriv/shared";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { vaultBlocksBulkExport } from "@/features/app-settings/vaultBulkExport";
import { useFileManager } from "@/features/file-manager";
import type { I18nKey } from "@/i18n/types";
import { exportVaultArchive } from "@/features/vault-list/exportVaultArchive";
import type { useVaultListModals } from "@/features/vault-list/hooks/useVaultListModals";
import type { RecoveryAction } from "../VaultRecoveryModal";
import { useVaultAutoClose } from "../useVaultAutoClose";
import { useVaultPipelineRun } from "../useVaultPipelineRun";

interface UseVaultLifecycleActionsOptions {
  vaults: VaultListItem[];
  setVaultRuntimeState: (
    vaultId: string,
    patch: {
      session: VaultSession | null;
      persistence?: VaultPersistence;
      canSeal?: boolean;
      lastAccessedAt?: string;
      lastAccessedWhen?: string;
    },
  ) => void;
  modals: ReturnType<typeof useVaultListModals>;
  showToast: (message: string, durationMs?: number) => void;
  dismissToast: () => void;
  t: (key: I18nKey, params?: Record<string, string>) => string;
}

export function useVaultLifecycleActions({
  vaults,
  setVaultRuntimeState,
  modals,
  showToast,
  dismissToast,
  t,
}: UseVaultLifecycleActionsOptions) {
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const { purgeForVaultClose } = useFileManager();
  const pipeline = useVaultPipelineRun();
  const pipelineBackgroundRef = useRef(false);

  const {
    setLifecycleRequest,
    lifecycleRequest,
    lifecycleVault,
    setRecoveryVaultId,
    recoveryVaultId,
    setRecoverySubmitting,
  } = modals;

  const pipelineVault = useMemo(() => {
    if (!pipeline.run) return null;
    return vaults.find((vault) => vault.id === pipeline.run!.vaultId) ?? null;
  }, [pipeline.run, vaults]);

  const pipelineOpeningVaultId = pipeline.run?.kind === "open" ? pipeline.run.vaultId : null;

  const pipelineClosingIntent =
    pipeline.run?.kind === "close" || pipeline.run?.kind === "seal" ? pipeline.run.kind : null;

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
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [lifecycleService, purgeForVaultClose, setVaultRuntimeState],
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
        stepCount: lifecycleService.openingStepCount,
        runPipeline: lifecycleService.runOpeningPipeline.bind(lifecycleService),
        onComplete: () => {
          finishOpenVault(vaultId);
          notifyPipelineComplete(vaultId, "open");
        },
        onError: (errorKey) => handlePipelineError(vaultId, "open", errorKey),
      });
    },
    [finishOpenVault, handlePipelineError, lifecycleService, notifyPipelineComplete, pipeline],
  );

  const startClosePipeline = useCallback(
    (vault: VaultListItem, intent: Extract<VaultLifecycleIntent, "close" | "seal">) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;

      pipelineBackgroundRef.current = false;
      setVaultRuntimeState(vault.id, { session: "closing" });

      const started = pipeline.start({
        vaultId: vault.id,
        kind: intent,
        stepCount: lifecycleService.closingStepCount,
        runPipeline: lifecycleService.runClosingPipeline.bind(lifecycleService),
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
      lifecycleService,
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
    [pipeline, setLifecycleRequest],
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
    [pipeline, setLifecycleRequest, setRecoveryVaultId],
  );

  const handleSealVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;
      setLifecycleRequest({ vaultId: vault.id, intent: "seal" });
    },
    [pipeline, setLifecycleRequest],
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
      showToast(
        t("toast.open_folder_mock", {
          path: lifecycleService.resolveWorkspacePath(vault.displayName),
        }),
        8000,
      );
    },
    [lifecycleService, showToast, t],
  );

  const handleAutoCloseVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return;
      void vaultService.getSettings(vault.id).then((settings) => {
        if (!settings) return;
        const intent =
          vault.storageMode === "plain" || settings.close.default_action === "seal"
            ? "seal"
            : "close";
        startClosePipeline(vault, intent);
      });
    },
    [pipeline, startClosePipeline, vaultService],
  );

  useVaultAutoClose({
    vaults,
    isPipelineRunning: pipeline.isRunning,
    onWarn: (_vault, secondsLeft) => {
      showToast(t("warning.auto_close_soon", { seconds: String(secondsLeft) }));
    },
    onAutoClose: handleAutoCloseVault,
  });

  const handleLifecycleConfirm = useCallback(
    (password: string | null) => {
      if (!lifecycleRequest || !lifecycleVault) return;
      const { vaultId, intent } = lifecycleRequest;

      if (intent === "unlock") {
        setLifecycleRequest(null);
        if (password) lifecycleService.setPasswordInSession(vaultId, password);
        startOpenPipeline(vaultId);
        return;
      }

      setLifecycleRequest(null);
      if (password) lifecycleService.setPasswordInSession(vaultId, password);
      startClosePipeline(lifecycleVault, intent);
    },
    [
      lifecycleRequest,
      lifecycleService,
      lifecycleVault,
      setLifecycleRequest,
      startClosePipeline,
      startOpenPipeline,
    ],
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
          lifecycleService.clearPasswordInSession(recoveryVaultId);
        }

        setRecoveryVaultId(null);
      } finally {
        setRecoverySubmitting(false);
      }
    },
    [
      lifecycleService,
      pipeline.isRunning,
      purgeForVaultClose,
      recoveryVaultId,
      setRecoveryVaultId,
      setRecoverySubmitting,
      setVaultRuntimeState,
      startOpenPipeline,
    ],
  );

  const handleVaultDelete = useCallback(
    (vaultId: string) => {
      purgeForVaultClose(vaultId);
      lifecycleService.clearPasswordInSession(vaultId);
      void vaultService.unregisterSettings(vaultId);
    },
    [lifecycleService, purgeForVaultClose, vaultService],
  );

  return {
    pipeline,
    pipelineVault,
    pipelineOpeningVaultId,
    pipelineClosingIntent,
    handlePipelineBackground,
    handleLockVault,
    handleUnlockVault,
    handleSealVault,
    handleExportVault,
    handleOpenFolder,
    handleLifecycleConfirm,
    handleRecoveryAction,
    handleVaultDelete,
  };
}
