import { useCallback, useMemo, useRef } from "react";
import {
  canRunIdleAutoClose,
  resolveIdleAutoCloseIntent,
  securityModeToUi,
  type VaultLifecycleIntent,
  type VaultPersistence,
  type VaultSession,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  touchVaultLastAccessed,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { exportVaultArchive } from "@/features/vaults/list";
import type { VaultListLifecycleModals } from "@/features/vaults/list";
import { vaultBlocksBulkExport } from "@/features/system/settings";
import { useFileManager } from "@/features/vaults/file-manager";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { isTauri } from "@/lib/tauri/invoke";
import { resolveVaultRecovery } from "@/platform/tauri/vaultRecoveryService";
import type { I18nKey } from "@/i18n/types";
import type { RecoveryAction } from "../modals/VaultRecoveryModal";
import { useVaultAutoClose } from "./useVaultAutoClose";
import { useVaultPipelineRun } from "./useVaultPipelineRun";

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
  modals: VaultListLifecycleModals;
  showToast: (message: string, durationMs?: number) => void;
  dismissToast: () => void;
  t: (key: I18nKey, params?: Record<string, string>) => string;
  onVaultListRefresh?: () => Promise<void>;
}

export function useVaultLifecycleActions({
  vaults,
  setVaultRuntimeState,
  modals,
  showToast,
  dismissToast,
  t,
  onVaultListRefresh,
}: UseVaultLifecycleActionsOptions) {
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const { purgeForVaultClose } = useFileManager();
  const pipeline = useVaultPipelineRun();
  const pipelineBackgroundRef = useRef(false);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;

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
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault) return;
      setVaultRuntimeState(vaultId, {
        session: "open",
        persistence: vault.storageMode === "plain" ? "sealed" : "closed",
      });
    },
    [setVaultRuntimeState],
  );

  const handlePipelineError = useCallback(
    (vaultId: string, kind: "open" | "close" | "seal", errorKey: I18nKey) => {
      const wasBackground = pipelineBackgroundRef.current;
      pipelineBackgroundRef.current = false;

      dismissToast();
      if (wasBackground) {
        showToast(t(errorKey), 8000);
      }

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
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (intent === "close") {
        // A `closed` encrypted_dir vault can still be sealed (drop the store cache).
        setVaultRuntimeState(vaultId, {
          session: null,
          persistence: "closed",
          canSeal: vault?.storageMode === "encrypted_dir",
        });
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
    (vaultId: string): boolean => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vaultId)) return false;

      pipelineBackgroundRef.current = false;
      return pipeline.start({
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
    (vault: VaultListItem, intent: Extract<VaultLifecycleIntent, "close" | "seal">): boolean => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return false;

      pipelineBackgroundRef.current = false;
      setVaultRuntimeState(vault.id, { session: "closing" });

      const started = pipeline.start({
        vaultId: vault.id,
        kind: intent,
        stepCount: lifecycleService.closingStepCount,
        runPipeline: (vaultId, onStep) =>
          lifecycleService.runClosingPipeline(vaultId, onStep, intent === "seal"),
        onComplete: () => {
          finishCloseOrSeal(vault.id, intent);
          notifyPipelineComplete(vault.id, intent);
        },
        onError: (errorKey) => handlePipelineError(vault.id, intent, errorKey),
      });

      if (!started) {
        revertCloseFailure(vault.id);
      }

      return started;
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

      const tryAutoUnlock = async () => {
        const settings = await vaultService.getSettings(vault.id);
        if (!settings) {
          setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
          return;
        }

        if (securityModeToUi(settings.security.mode) === "disk_open_close") {
          const hasDisk = await lifecycleService.hasDiskSession(vault.id);
          if (hasDisk) {
            const started = startOpenPipeline(vault.id);
            if (!started) showToast(t("toast.pipeline_busy"));
            return;
          }
        }

        setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
      };

      void tryAutoUnlock();
    },
    [
      lifecycleService,
      pipeline,
      setLifecycleRequest,
      showToast,
      startOpenPipeline,
      t,
      vaultService,
    ],
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
      void exportVaultArchive(vault, (row) => vaultService.getArchiveExportBytes(row))
        .then(() => {
          showToast(t("vault.export.success", { name: vault.displayName }));
        })
        .catch(() => {
          showToast(t("vault.export.failed"));
        });
    },
    [pipelineOpeningVaultId, showToast, t, vaultService],
  );

  const handleOpenFolder = useCallback(
    (vault: VaultListItem) => {
      const open = async () => {
        const settings = await vaultService.getSettings(vault.id);
        if (settings && !settings.policy.allow_external_editors) {
          showToast(t("error.external_editor_blocked"));
          return;
        }

        const path = lifecycleService.resolveWorkspacePath(vault.displayName);
        if (isTauri()) {
          const { resolveVaultRootPath } = await import("@/platform/tauri/vaultRoot");
          const vaultRoot = await resolveVaultRootPath();
          void tauriInvoke(TAURI_COMMANDS.OPEN_PATH_IN_FILE_MANAGER, {
            vaultRoot,
            vaultId: vault.id,
            path,
          }).catch(() => {
            showToast(t("error.open_folder_failed"));
          });
          return;
        }
        showToast(
          t("toast.open_folder_mock", {
            path,
          }),
          8000,
        );
      };

      void open();
    },
    [lifecycleService, showToast, t, vaultService],
  );

  const handleAutoCloseVault = useCallback(
    (vault: VaultListItem, settings: VaultSettingsConfig): boolean => {
      if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) return false;
      const hasPasswordInRam = lifecycleService.hasPasswordInSession(vault.id);
      if (
        !canRunIdleAutoClose(
          vault,
          vault.storageMode,
          settings.security.mode,
          settings.close.default_action,
          hasPasswordInRam,
        )
      ) {
        return false;
      }
      const intent = resolveIdleAutoCloseIntent(vault.storageMode, settings.close.default_action);
      return startClosePipeline(vault, intent);
    },
    [lifecycleService, pipeline, startClosePipeline],
  );

  const handleAutoCloseWarn = useCallback(
    (vault: VaultListItem, secondsLeft: number) => {
      showToast(
        t("warning.auto_close_soon", {
          name: vault.displayName,
          seconds: String(secondsLeft),
        }),
      );
    },
    [showToast, t],
  );

  const handleAutoCloseBlocked = useCallback(
    (vault: VaultListItem) => {
      showToast(t("warning.auto_close_no_password", { name: vault.displayName }));
    },
    [showToast, t],
  );

  useVaultAutoClose({
    vaults,
    isPipelineRunning: pipeline.isRunning,
    onWarn: handleAutoCloseWarn,
    onAutoCloseBlocked: handleAutoCloseBlocked,
    onAutoClose: handleAutoCloseVault,
  });

  const handleLifecycleConfirm = useCallback(
    (password: string | null) => {
      if (!lifecycleRequest || !lifecycleVault) return;
      const { vaultId, intent } = lifecycleRequest;

      if (intent === "unlock") {
        if (password) lifecycleService.setPasswordInSession(vaultId, password);
        if (lifecycleVault && resolveVaultDisplayStatus(lifecycleVault) === "recovery") {
          setRecoveryVaultId(vaultId);
          setLifecycleRequest(null);
          return;
        }
        const started = startOpenPipeline(vaultId);
        setLifecycleRequest(null);
        if (!started) {
          showToast(t("toast.pipeline_busy"));
          setLifecycleRequest({ vaultId, intent: "unlock" });
        }
        return;
      }

      if (password) lifecycleService.setPasswordInSession(vaultId, password);
      const started = startClosePipeline(lifecycleVault, intent);
      setLifecycleRequest(null);
      if (!started) {
        showToast(t("toast.pipeline_busy"));
        setLifecycleRequest({ vaultId, intent });
      }
    },
    [
      lifecycleRequest,
      lifecycleService,
      lifecycleVault,
      setLifecycleRequest,
      setRecoveryVaultId,
      showToast,
      startClosePipeline,
      startOpenPipeline,
      t,
    ],
  );

  const handleRecoveryAction = useCallback(
    (action: RecoveryAction) => {
      if (!recoveryVaultId || action === "compare") return;

      const vaultId = recoveryVaultId;

      const runResolve = async () => {
        setRecoverySubmitting(true);
        try {
          if (isTauri()) {
            const password = lifecycleService.getPasswordInSession(vaultId);
            if (!password && action !== "discard_workspace") {
              setLifecycleRequest({ vaultId, intent: "unlock" });
              return;
            }
            await resolveVaultRecovery(vaultId, password ?? "", action);
            await onVaultListRefresh?.();
            showToast(t("toast.recovery_success"));
          } else {
            if (action === "reimport_archive") {
              setVaultRuntimeState(vaultId, { session: null, persistence: "closed" });
            } else if (action === "discard_workspace") {
              purgeForVaultClose(vaultId);
              setVaultRuntimeState(vaultId, { session: null, persistence: "sealed" });
              lifecycleService.clearPasswordInSession(vaultId);
            }
            showToast(t("toast.recovery_prototype"));
          }

          setRecoveryVaultId(null);

          if (action === "use_store") {
            if (!startOpenPipeline(vaultId)) {
              showToast(t("toast.pipeline_busy"));
            }
          }
        } catch {
          showToast(t("error.archive_test_failed"));
        } finally {
          setRecoverySubmitting(false);
        }
      };

      void runResolve();
    },
    [
      lifecycleService,
      onVaultListRefresh,
      purgeForVaultClose,
      recoveryVaultId,
      setLifecycleRequest,
      setRecoverySubmitting,
      setRecoveryVaultId,
      setVaultRuntimeState,
      showToast,
      startOpenPipeline,
      t,
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

  const closeVaultForExit = useCallback(
    (vault: VaultListItem, intent: Extract<VaultLifecycleIntent, "close" | "seal">) => {
      return new Promise<boolean>((resolve) => {
        if (pipeline.isRunning || pipeline.isVaultPipelineBusy(vault.id)) {
          resolve(false);
          return;
        }

        setVaultRuntimeState(vault.id, { session: "closing" });
        const started = pipeline.start({
          vaultId: vault.id,
          kind: intent,
          stepCount: lifecycleService.closingStepCount,
          runPipeline: (vaultId, onStep) =>
            lifecycleService.runClosingPipeline(vaultId, onStep, intent === "seal"),
          onComplete: () => {
            finishCloseOrSeal(vault.id, intent);
            resolve(true);
          },
          onError: () => {
            revertCloseFailure(vault.id);
            resolve(false);
          },
        });

        if (!started) {
          revertCloseFailure(vault.id);
          resolve(false);
        }
      });
    },
    [
      finishCloseOrSeal,
      lifecycleService,
      pipeline,
      revertCloseFailure,
      setVaultRuntimeState,
    ],
  );

  const getVaultSettingsForLifecycle = useCallback(
    (vaultId: string) => vaultService.getSettings(vaultId),
    [vaultService],
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
    closeVaultForExit,
    getVaultSettingsForLifecycle,
    hasPasswordInSession: lifecycleService.hasPasswordInSession.bind(lifecycleService),
  };
}
