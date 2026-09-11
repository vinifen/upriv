import { useCallback, useMemo, useRef, useState } from "react";
import {
  canRunIdleAutoClose,
  needsWorkspaceSetupOnOpen,
  requiresCloseDialog,
  WORKSPACE_PATH_DEFAULT,
  type VaultExportRequest,
  type VaultLifecycleIntent,
  type VaultSession,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  shouldBumpVaultRootEpoch,
  touchVaultLastAccessed,
  vaultCanExport,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { useVaultPipelineRun } from "@upriv/shared/react";
import type { VaultPipelinePresentation } from "@upriv/shared/react";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import {
  useVaultLifecycleService,
  useVaultRootService,
  useVaultService,
} from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { exportVaultPackage } from "@/features/vaults/list";
import type { VaultListLifecycleModals } from "@/features/vaults/list";
import { hasUnsavedWorkspaceChanges, useFileManager } from "@/features/vaults/file-manager";
import type { I18nKey } from "@/i18n/types";
import type { RecoveryAction } from "../modals/VaultRecoveryModal";
import { useVaultAutoClose } from "./useVaultAutoClose";

interface UseVaultLifecycleActionsOptions {
  vaults: VaultListItem[];
  setVaultRuntimeState: (
    vaultId: string,
    patch: {
      session: VaultSession | null;
      lastAccessedAt?: string;
      lastAccessedWhen?: string;
    },
  ) => void;
  modals: VaultListLifecycleModals;
  showToast: (message: string, durationMs?: number) => void;
  showError: (error: unknown, fallback: I18nKey) => void;
  dismissToast: () => void;
  t: (key: I18nKey, params?: Record<string, string>) => string;
}

export function useVaultLifecycleActions({
  vaults,
  setVaultRuntimeState,
  modals,
  showToast,
  showError,
  dismissToast,
  t,
}: UseVaultLifecycleActionsOptions) {
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const vaultRootService = useVaultRootService();
  const { settings, patchSettings, getSettingsSnapshot, reportVaultRootIntegrityFailure } =
    useAppSettingsContext();
  const { purgeForVaultClose, entries, maximize, dispatchWorkspace } = useFileManager();
  const pipeline = useVaultPipelineRun(desktopErrorI18nKey);
  const pipelineBackgroundRef = useRef(false);
  const exportBusyGenRef = useRef(0);
  /** Aborted on export timeout so a late run cannot start the download. */
  const exportAbortRef = useRef<AbortController | null>(null);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const closeStartedWhileOpenRef = useRef(new Map<string, boolean>());
  const [workspaceSetupVaultId, setWorkspaceSetupVaultId] = useState<string | null>(null);
  const [workspaceSetupRootPath, setWorkspaceSetupRootPath] = useState("");

  const {
    setLifecycleRequest,
    lifecycleRequest,
    lifecycleVault,
    setRecoveryVaultId,
    recoveryVaultId,
    setRecoverySubmitting,
    setExportVaultId,
    exportVault,
    setExportSubmitting,
  } = modals;

  const pipelineVault = useMemo(() => {
    if (!pipeline.run) return null;
    return vaults.find((vault) => vault.id === pipeline.run!.vaultId) ?? null;
  }, [pipeline.run, vaults]);

  const pipelineListStatus = useMemo(
    () => ({
      openingVaultIds: pipeline.openingVaultIds,
      closingVaultIds: pipeline.closingVaultIds,
    }),
    [pipeline.closingVaultIds, pipeline.openingVaultIds],
  );

  const pipelineClosingIntent = pipeline.run?.kind === "close" ? pipeline.run.kind : null;

  const revertCloseFailure = useCallback(
    (vaultId: string) => {
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault) return;
      const wasOpen = closeStartedWhileOpenRef.current.get(vaultId) ?? false;
      closeStartedWhileOpenRef.current.delete(vaultId);
      if (wasOpen) {
        setVaultRuntimeState(vaultId, { session: "open" });
        return;
      }
      setVaultRuntimeState(vaultId, { session: null });
    },
    [setVaultRuntimeState],
  );

  const handlePipelineError = useCallback(
    (vaultId: string, kind: "open" | "close", errorI18nKey: I18nKey) => {
      const wasBackground = pipelineBackgroundRef.current;
      pipelineBackgroundRef.current = false;

      dismissToast();
      showToast(t(errorI18nKey), 8000);

      if (kind === "close") {
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
      setVaultRuntimeState(vaultId, {
        session: "open",
        ...touchVaultLastAccessed(t("vault.last_accessed.just_now")),
      });
      if (settings.app.last_opened_vault !== vaultId) {
        void patchSettings({ app: { last_opened_vault: vaultId } });
      }
    },
    [patchSettings, setVaultRuntimeState, settings.app.last_opened_vault, t],
  );

  const finishClose = useCallback(
    (vaultId: string) => {
      purgeForVaultClose(vaultId);
      setVaultRuntimeState(vaultId, { session: null });
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [lifecycleService, purgeForVaultClose, setVaultRuntimeState],
  );

  const notifyPipelineComplete = useCallback(
    (vaultId: string, kind: "open" | "close") => {
      dismissToast();
      if (!pipelineBackgroundRef.current) return;

      const vault = vaults.find((item) => item.id === vaultId);
      if (!vault) return;

      const key =
        kind === "open" ? "toast.pipeline_complete_open" : "toast.pipeline_complete_close";

      showToast(t(key, { name: vault.displayName }));
      pipelineBackgroundRef.current = false;
    },
    [dismissToast, showToast, t, vaults],
  );

  const startOpenPipeline = useCallback(
    (vaultId: string): boolean => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;

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
        onError: (errorI18nKey) => handlePipelineError(vaultId, "open", errorI18nKey),
      });
    },
    [finishOpenVault, handlePipelineError, lifecycleService, notifyPipelineComplete, pipeline],
  );

  // C-01: closing purges the workspace. Never discard unsaved drafts
  // silently — surface the file-manager unsaved prompt and block the close.
  const hasUnsavedForClose = useCallback(
    (vaultId: string): boolean => {
      const entry = entries[vaultId];
      return Boolean(entry && hasUnsavedWorkspaceChanges(entry.workspace));
    },
    [entries],
  );

  const promptUnsavedBeforeClose = useCallback(
    (vaultId: string): boolean => {
      if (!hasUnsavedForClose(vaultId)) return false;
      const entry = entries[vaultId];
      maximize(vaultId);
      if (entry && entry.workspace.unsavedPrompt?.type !== "dismiss_workspace") {
        dispatchWorkspace(vaultId, {
          type: "set_unsaved_prompt",
          prompt: { type: "dismiss_workspace" },
        });
      }
      return true;
    },
    [dispatchWorkspace, entries, hasUnsavedForClose, maximize],
  );

  type ClosePipelineOpts = {
    presentation?: VaultPipelinePresentation;
    source?: "user" | "auto_close";
  };

  const startClosePipeline = useCallback(
    (
      vault: VaultListItem,
      intent: Extract<VaultLifecycleIntent, "close">,
      opts?: ClosePipelineOpts,
    ): boolean => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return false;

      const presentation = opts?.presentation ?? "foreground";
      const source = opts?.source ?? "user";

      if (source === "auto_close") {
        if (hasUnsavedForClose(vault.id)) {
          showToast(t("warning.auto_close_unsaved", { name: vault.displayName }));
          return false;
        }
      } else if (promptUnsavedBeforeClose(vault.id)) {
        return false;
      }

      const wasOpen = resolveVaultDisplayStatus(vault) === "open";
      closeStartedWhileOpenRef.current.set(vault.id, wasOpen);

      const inBackground = presentation === "background";
      pipelineBackgroundRef.current = inBackground;
      setVaultRuntimeState(vault.id, { session: "closing" });

      if (inBackground) {
        showToast(t("toast.pipeline_background_close", { name: vault.displayName }), 0);
      }

      return pipeline.start({
        vaultId: vault.id,
        kind: intent,
        stepCount: lifecycleService.closingStepCount,
        presentation,
        runPipeline: lifecycleService.runClosingPipeline.bind(lifecycleService),
        onComplete: () => {
          closeStartedWhileOpenRef.current.delete(vault.id);
          finishClose(vault.id);
          notifyPipelineComplete(vault.id, intent);
        },
        onError: (errorI18nKey) => handlePipelineError(vault.id, intent, errorI18nKey),
      });
    },
    [
      finishClose,
      handlePipelineError,
      hasUnsavedForClose,
      notifyPipelineComplete,
      pipeline,
      promptUnsavedBeforeClose,
      lifecycleService,
      setVaultRuntimeState,
      showToast,
      t,
    ],
  );

  const handlePipelineBackground = useCallback(() => {
    if (!pipeline.run || !pipelineVault) return;

    pipelineBackgroundRef.current = true;
    pipeline.moveToBackground();

    const { kind } = pipeline.run;
    const toastKey =
      kind === "open" ? "toast.pipeline_background_open" : "toast.pipeline_background_close";

    showToast(t(toastKey, { name: pipelineVault.displayName }), 0);
  }, [pipeline, pipelineVault, showToast, t]);

  const handleLockVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      void (async () => {
        let securityMode: VaultSettingsConfig["security"]["mode"] = "session_ram";
        try {
          const vaultSettings = await vaultService.getSettings(vault.id);
          if (vaultSettings) securityMode = vaultSettings.security.mode;
        } catch {
          // Lock is the safe direction; missing settings → session keys, no prompt.
        }
        if (requiresCloseDialog(vault, securityMode)) {
          setLifecycleRequest({ vaultId: vault.id, intent: "close" });
          return;
        }
        startClosePipeline(vault, "close");
      })();
    },
    [pipeline, setLifecycleRequest, startClosePipeline, vaultService],
  );

  const handleUnlockVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      if (resolveVaultDisplayStatus(vault) === "recovery") {
        setRecoveryVaultId(vault.id);
        return;
      }
      void (async () => {
        try {
          const vaultSettings = await vaultService.getSettings(vault.id);
          const mountPath = vaultSettings?.mount.workspace_path ?? WORKSPACE_PATH_DEFAULT;
          if (!needsWorkspaceSetupOnOpen(getSettingsSnapshot().workspace.path, mountPath)) {
            setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
            return;
          }
          let rootPath = "";
          try {
            const resolved = await vaultRootService.resolve({
              vaultRootMode: settings.app.vault_root_mode,
            });
            if (resolved.status === "found") {
              rootPath = resolved.rootPath;
            } else {
              rootPath = resolved.defaultRootAnchor;
            }
          } catch (error) {
            if (shouldBumpVaultRootEpoch(error)) {
              await reportVaultRootIntegrityFailure(error);
            } else {
              showError(error, "error.settings_save_failed");
            }
            return;
          }
          if (!rootPath.trim()) {
            rootPath = settings.app.upriv_root_path.trim();
          }
          if (!rootPath.trim()) {
            try {
              const status = await vaultRootService.defaultRootStatus();
              rootPath = status.defaultRootAnchor.trim();
            } catch (error) {
              if (shouldBumpVaultRootEpoch(error)) {
                await reportVaultRootIntegrityFailure(error);
              } else {
                showError(error, "error.settings_save_failed");
              }
              return;
            }
          }
          if (!rootPath.trim()) {
            showError(
              new Error("vault-root path unavailable"),
              "modal.workspace.error.unavailable",
            );
            return;
          }
          setWorkspaceSetupRootPath(rootPath);
          setWorkspaceSetupVaultId(vault.id);
        } catch (error) {
          showError(error, "error.settings_save_failed");
        }
      })();
    },
    [
      getSettingsSnapshot,
      pipeline,
      reportVaultRootIntegrityFailure,
      setLifecycleRequest,
      setRecoveryVaultId,
      settings.app.upriv_root_path,
      settings.app.vault_root_mode,
      showError,
      vaultRootService,
      vaultService,
    ],
  );

  const handleWorkspaceSetupCancel = useCallback(() => {
    setWorkspaceSetupVaultId(null);
  }, []);

  const handleWorkspaceSetupConfigured = useCallback(() => {
    const vaultId = workspaceSetupVaultId;
    setWorkspaceSetupVaultId(null);
    if (!vaultId) return;
    // Read snapshot (patchSettings updates settingsRef before onConfigured) — not stale render.
    if (needsWorkspaceSetupOnOpen(getSettingsSnapshot().workspace.path, WORKSPACE_PATH_DEFAULT)) {
      showError(new Error("workspace unset after setup"), "modal.workspace.error.unset" as I18nKey);
      setWorkspaceSetupVaultId(vaultId);
      return;
    }
    setLifecycleRequest({ vaultId, intent: "unlock" });
  }, [getSettingsSnapshot, setLifecycleRequest, showError, workspaceSetupVaultId]);

  const handleExportVault = useCallback(
    (vault: VaultListItem) => {
      if (!vaultCanExport(vault, pipelineListStatus)) {
        const listStatus = resolveVaultListStatus(vault, pipelineListStatus);
        if (listStatus === "opening" || listStatus === "closing") {
          showToast(t("vault.export.blocked_opening"));
          return;
        }
        showToast(t("vault.export.blocked_open"));
        return;
      }
      setExportVaultId(vault.id);
    },
    [pipelineListStatus, setExportVaultId, showToast, t],
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
          showToast(t("vault.export.success", { name: vault.displayName }));
          setExportVaultId(null);
        })
        .catch((error) => {
          if (gen !== exportBusyGenRef.current) return;
          showError(error, "vault.export.failed");
        })
        .finally(() => {
          if (gen === exportBusyGenRef.current) setExportSubmitting(false);
        });
    },
    [exportVault, setExportSubmitting, setExportVaultId, showError, showToast, t, vaultService],
  );

  const handleExportTimeout = useCallback(() => {
    exportBusyGenRef.current += 1;
    exportAbortRef.current?.abort();
    setExportSubmitting(false);
    showToast(t("error.operation_timed_out"));
  }, [setExportSubmitting, showToast, t]);

  const handleOpenFolder = useCallback(
    (vault: VaultListItem) => {
      void (async () => {
        try {
          const vaultSettings = await vaultService.getSettings(vault.id);
          const path = lifecycleService.resolveWorkspacePath(vault.displayName, {
            globalWorkspacePath: settings.workspace.path,
            mountWorkspacePath: vaultSettings?.mount.workspace_path,
          });
          showToast(t("toast.open_folder_mock", { path }), 8000);
        } catch {
          showToast(
            t("toast.open_folder_mock", {
              path: lifecycleService.resolveWorkspacePath(vault.displayName, {
                globalWorkspacePath: settings.workspace.path,
              }),
            }),
            8000,
          );
        }
      })();
    },
    [lifecycleService, settings.workspace.path, showToast, t, vaultService],
  );

  const handleAutoCloseVault = useCallback(
    (vault: VaultListItem, settings: VaultSettingsConfig): boolean => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return false;
      if (!canRunIdleAutoClose(vault, settings.security.mode)) {
        return false;
      }
      return startClosePipeline(vault, "close", {
        presentation: "background",
        source: "auto_close",
      });
    },
    [pipeline, startClosePipeline],
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
    isVaultPipelineBusy: pipeline.isVaultPipelineBusy,
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
        const started = startOpenPipeline(vaultId);
        setLifecycleRequest(null);
        if (!started) {
          // M-11: pipeline busy — don't leave the password sitting in session.
          lifecycleService.clearPasswordInSession(vaultId);
          showToast(t("toast.pipeline_busy"));
          setLifecycleRequest({ vaultId, intent: "unlock" });
        }
        return;
      }

      if (password) lifecycleService.setPasswordInSession(vaultId, password);
      const started = startClosePipeline(lifecycleVault, intent);
      setLifecycleRequest(null);
      if (!started) {
        // Only "pipeline busy" reopens the dialog; an unsaved-changes block has
        // already surfaced its own prompt via startClosePipeline.
        if (pipeline.isVaultPipelineBusy(vaultId)) {
          lifecycleService.clearPasswordInSession(vaultId);
          showToast(t("toast.pipeline_busy"));
          setLifecycleRequest({ vaultId, intent });
        }
      }
    },
    [
      lifecycleRequest,
      lifecycleService,
      lifecycleVault,
      pipeline,
      setLifecycleRequest,
      showToast,
      startClosePipeline,
      startOpenPipeline,
      t,
    ],
  );

  const handleRecoveryAction = useCallback(
    (action: RecoveryAction) => {
      if (!recoveryVaultId) return;

      if (action === "resume_contents") {
        const vaultId = recoveryVaultId;
        setRecoveryVaultId(null);
        if (!startOpenPipeline(vaultId)) {
          showToast(t("toast.pipeline_busy"));
          setRecoveryVaultId(vaultId);
        }
        return;
      }

      setRecoverySubmitting(true);
      try {
        if (action === "create_from_backup") {
          setVaultRuntimeState(recoveryVaultId, { session: null });
          showToast(t("toast.recovery_prototype"));
        } else if (action === "discard_workspace") {
          purgeForVaultClose(recoveryVaultId);
          setVaultRuntimeState(recoveryVaultId, { session: null });
          lifecycleService.clearPasswordInSession(recoveryVaultId);
          showToast(t("toast.recovery_prototype"));
        }

        setRecoveryVaultId(null);
      } finally {
        setRecoverySubmitting(false);
      }
    },
    [
      lifecycleService,
      purgeForVaultClose,
      recoveryVaultId,
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

  const workspaceSetupVault = useMemo(() => {
    if (!workspaceSetupVaultId) return null;
    return vaults.find((vault) => vault.id === workspaceSetupVaultId) ?? null;
  }, [vaults, workspaceSetupVaultId]);

  return {
    pipeline,
    pipelineVault,
    pipelineListStatus,
    pipelineClosingIntent,
    handlePipelineBackground,
    handleLockVault,
    handleUnlockVault,
    handleExportVault,
    handleConfirmExportVault,
    handleExportTimeout,
    handleOpenFolder,
    handleLifecycleConfirm,
    handleRecoveryAction,
    handleVaultDelete,
    workspaceSetupVault,
    workspaceSetupOpen: workspaceSetupVaultId !== null,
    workspaceSetupRootPath,
    handleWorkspaceSetupCancel,
    handleWorkspaceSetupConfigured,
  };
}
