import { useCallback, useMemo, useRef, useState } from "react";
import {
  CLOSING_PIPELINE_STEPS,
  OPENING_PIPELINE_STEPS,
  needsWorkspaceSetupOnOpen,
  requiresCloseDialog,
  touchVaultLastAccessed,
  WORKSPACE_PATH_DEFAULT,
  shouldBumpVaultRootEpoch,
  type VaultLifecycleIntent,
  type VaultLifecycleRequest,
  type VaultListItem,
  type VaultPipelineKind,
  type VaultSession,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  useVaultLifecycleService,
  useVaultRootService,
  useVaultService,
} from "@/platform/services";
import { useVaultPipelineRun } from "@upriv/shared/react";
import type { VaultPipelinePresentation } from "@upriv/shared/react";

export type SetVaultRuntimeState = (
  vaultId: string,
  patch: {
    session: VaultSession | null;
    lastAccessedAt?: string;
    lastAccessedWhen?: string;
  },
) => void;

interface UseVaultLifecycleOptions {
  vaults: VaultListItem[];
  setVaultRuntimeState: SetVaultRuntimeState;
  lifecycleRequest: VaultLifecycleRequest | null;
  setLifecycleRequest: (next: VaultLifecycleRequest | null) => void;
  showToast: (message: string, durationMs?: number) => void;
  dismissToast: () => void;
}

export function useVaultLifecycle({
  vaults,
  setVaultRuntimeState,
  lifecycleRequest,
  setLifecycleRequest,
  showToast,
  dismissToast,
}: UseVaultLifecycleOptions) {
  const { t } = useTranslation();
  const { settings, patchSettings, getSettingsSnapshot, reportVaultRootIntegrityFailure } =
    useAppSettingsContext();
  const lifecycleService = useVaultLifecycleService();
  const vaultService = useVaultService();
  const vaultRootService = useVaultRootService();
  const pipeline = useVaultPipelineRun(mobileErrorI18nKey);
  const pipelineBackgroundRef = useRef(false);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const closeStartedWhileOpenRef = useRef(new Map<string, boolean>());
  const submittingRef = useRef(false);
  const [workspaceSetupVaultId, setWorkspaceSetupVaultId] = useState<string | null>(null);
  const [workspaceSetupRootPath, setWorkspaceSetupRootPath] = useState("");

  const lifecycleVault = useMemo(() => {
    if (!lifecycleRequest) return null;
    return vaults.find((v) => v.id === lifecycleRequest.vaultId) ?? null;
  }, [lifecycleRequest, vaults]);

  const pipelineVault = useMemo(() => {
    if (!pipeline.run) return null;
    return vaults.find((v) => v.id === pipeline.run!.vaultId) ?? null;
  }, [pipeline.run, vaults]);

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
    (vaultId: string, kind: VaultPipelineKind, errorI18nKey: I18nKey) => {
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
      setVaultRuntimeState(vaultId, { session: null });
      lifecycleService.clearPasswordInSession(vaultId);
      closeStartedWhileOpenRef.current.delete(vaultId);
    },
    [lifecycleService, setVaultRuntimeState],
  );

  const notifyPipelineComplete = useCallback(
    (vaultId: string, kind: VaultPipelineKind) => {
      dismissToast();
      if (!pipelineBackgroundRef.current) return;
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault) return;
      const key =
        kind === "open" ? "toast.pipeline_complete_open" : "toast.pipeline_complete_close";
      showToast(t(key, { name: vault.displayName }));
      pipelineBackgroundRef.current = false;
    },
    [dismissToast, showToast, t],
  );

  const startOpenPipeline = useCallback(
    (vaultId: string, presentation: VaultPipelinePresentation = "foreground"): boolean => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;
      const inBackground = presentation === "background";
      pipelineBackgroundRef.current = inBackground;
      if (inBackground) {
        const vault = vaultsRef.current.find((item) => item.id === vaultId);
        if (vault) {
          showToast(t("toast.pipeline_background_open", { name: vault.displayName }), 0);
        }
      }
      return pipeline.start({
        vaultId,
        kind: "open",
        stepCount: lifecycleService.openingStepCount,
        presentation,
        runPipeline: lifecycleService.runOpeningPipeline.bind(lifecycleService),
        onComplete: () => {
          finishOpenVault(vaultId);
          notifyPipelineComplete(vaultId, "open");
        },
        onError: (errorI18nKey) => handlePipelineError(vaultId, "open", errorI18nKey),
      });
    },
    [
      finishOpenVault,
      handlePipelineError,
      lifecycleService,
      notifyPipelineComplete,
      pipeline,
      showToast,
      t,
    ],
  );

  const startClosePipeline = useCallback(
    (vaultId: string, presentation: VaultPipelinePresentation = "foreground"): boolean => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      closeStartedWhileOpenRef.current.set(vaultId, vault?.session === "open");
      const inBackground = presentation === "background";
      pipelineBackgroundRef.current = inBackground;
      if (inBackground && vault) {
        showToast(t("toast.pipeline_background_close", { name: vault.displayName }), 0);
      }
      const started = pipeline.start({
        vaultId,
        kind: "close",
        stepCount: lifecycleService.closingStepCount,
        presentation,
        runPipeline: lifecycleService.runClosingPipeline.bind(lifecycleService),
        onComplete: () => {
          finishClose(vaultId);
          notifyPipelineComplete(vaultId, "close");
        },
        onError: (errorI18nKey) => handlePipelineError(vaultId, "close", errorI18nKey),
      });
      if (started) {
        setVaultRuntimeState(vaultId, {
          session: null,
        });
      }
      return started;
    },
    [
      finishClose,
      handlePipelineError,
      lifecycleService,
      notifyPipelineComplete,
      pipeline,
      setVaultRuntimeState,
      showToast,
      t,
    ],
  );

  const requestLifecycle = useCallback(
    (vaultId: string, intent: VaultLifecycleIntent) => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return;
      if (intent === "close") {
        void (async () => {
          const vault = vaultsRef.current.find((item) => item.id === vaultId);
          if (!vault) return;
          let mode: VaultSettingsConfig["security"]["mode"] = "session_ram";
          try {
            const vaultSettings = await vaultService.getSettings(vaultId);
            if (vaultSettings) mode = vaultSettings.security.mode;
          } catch {
            // Lock is the safe direction; missing settings → session keys, no prompt.
          }
          if (requiresCloseDialog(vault, mode)) {
            setLifecycleRequest({ vaultId, intent });
            return;
          }
          startClosePipeline(vaultId);
        })();
        return;
      }
      void (async () => {
        try {
          const vaultSettings = await vaultService.getSettings(vaultId);
          const mountPath = vaultSettings?.mount.workspace_path ?? WORKSPACE_PATH_DEFAULT;
          if (!needsWorkspaceSetupOnOpen(getSettingsSnapshot().workspace.path, mountPath)) {
            setLifecycleRequest({ vaultId, intent: "unlock" });
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
              showToast(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
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
                showToast(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
              }
              return;
            }
          }
          if (!rootPath.trim()) {
            showToast(t("modal.workspace.error.unavailable"));
            return;
          }
          setWorkspaceSetupRootPath(rootPath);
          setWorkspaceSetupVaultId(vaultId);
        } catch (error) {
          showToast(t(mobileErrorI18nKey(error, "error.settings_save_failed")));
        }
      })();
    },
    [
      getSettingsSnapshot,
      pipeline,
      reportVaultRootIntegrityFailure,
      setLifecycleRequest,
      settings.app.upriv_root_path,
      settings.app.vault_root_mode,
      showToast,
      startClosePipeline,
      t,
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
    if (needsWorkspaceSetupOnOpen(getSettingsSnapshot().workspace.path, WORKSPACE_PATH_DEFAULT)) {
      showToast(t("modal.workspace.error.unset"));
      setWorkspaceSetupVaultId(vaultId);
      return;
    }
    setLifecycleRequest({ vaultId, intent: "unlock" });
  }, [getSettingsSnapshot, setLifecycleRequest, showToast, t, workspaceSetupVaultId]);

  const confirmLifecycle = useCallback(
    (password: string | null) => {
      if (!lifecycleRequest || submittingRef.current) return;
      const { vaultId, intent } = lifecycleRequest;
      submittingRef.current = true;
      if (password) {
        lifecycleService.setPasswordInSession(vaultId, password);
      }
      setLifecycleRequest(null);
      const started =
        intent === "unlock" ? startOpenPipeline(vaultId) : startClosePipeline(vaultId);
      submittingRef.current = false;
      if (!started) {
        showToast(t("toast.pipeline_busy"));
      }
    },
    [
      lifecycleRequest,
      lifecycleService,
      setLifecycleRequest,
      showToast,
      startClosePipeline,
      startOpenPipeline,
      t,
    ],
  );

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

  const cancelLifecycle = useCallback(() => {
    setLifecycleRequest(null);
  }, [setLifecycleRequest]);

  const sendPipelineToBackground = useCallback(() => {
    pipelineBackgroundRef.current = true;
    pipeline.moveToBackground();
  }, [pipeline]);

  const overlayProps = useMemo(() => {
    const run = pipeline.run;
    if (!run || !run.foreground) {
      return { open: false as const };
    }
    const isOpen = run.kind === "open";
    return {
      open: true as const,
      title: t(isOpen ? "open.overlay.title" : "close.overlay.title_close", {
        name: pipelineVault?.displayName ?? "",
      }),
      hint: t(isOpen ? "open.overlay.hint" : "close.overlay.hint"),
      stepKeys: isOpen ? OPENING_PIPELINE_STEPS : CLOSING_PIPELINE_STEPS,
      activeStep: run.activeStep,
      errorKey: run.errorKey ?? null,
    };
  }, [pipeline.run, pipelineVault?.displayName, t]);

  return {
    lifecycleVault,
    lifecycleIntent: lifecycleRequest?.intent ?? null,
    confirmLifecycle,
    cancelLifecycle,
    requestLifecycle,
    handleOpenFolder,
    pipelineVault,
    pipelineOverlay: overlayProps,
    sendPipelineToBackground,
    dismissPipelineFailure: pipeline.dismissFailure,
    openingVaultIds: pipeline.openingVaultIds,
    closingVaultIds: pipeline.closingVaultIds,
    workspaceSetupOpen: workspaceSetupVaultId !== null,
    workspaceSetupRootPath,
    handleWorkspaceSetupCancel,
    handleWorkspaceSetupConfigured,
  };
}
