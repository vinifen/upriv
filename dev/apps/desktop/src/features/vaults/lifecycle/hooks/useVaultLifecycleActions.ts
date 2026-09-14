import { useCallback, useMemo, useRef, useState } from "react";
import {
  canRunIdleAutoClose,
  isVaultCredentialChallengeI18nKey,
  LOADING_BUDGET_MS,
  needsWorkspaceSetupOnOpen,
  requiresCloseDialog,
  shouldRetainSessionRamPassword,
  WORKSPACE_PATH_DEFAULT,
  type VaultExportRequest,
  type VaultLifecycleIntent,
  type VaultSession,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  shouldBumpVaultRootEpoch,
  touchVaultLastAccessed,
  vaultCanExport,
  isVaultOpenJobPending,
  type VaultListItem,
  type VaultPipelineKind,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { useClosingDisplayHold, useVaultPipelineRun } from "@upriv/shared/react";
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
  const closingHold = useClosingDisplayHold();
  const pipelineBackgroundRef = useRef(false);
  const exportBusyGenRef = useRef(0);
  /** Aborted on export timeout so a late run cannot start the download. */
  const exportAbortRef = useRef<AbortController | null>(null);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const closeStartedWhileOpenRef = useRef(new Map<string, boolean>());
  const [workspaceSetupVaultId, setWorkspaceSetupVaultId] = useState<string | null>(null);
  const [workspaceSetupRootPath, setWorkspaceSetupRootPath] = useState("");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialErrorKey, setCredentialErrorKey] = useState<I18nKey | null>(null);
  const [typedCredential, setTypedCredential] = useState<{
    vaultId: string;
    password: string;
  } | null>(null);
  const credentialVerifyIdsRef = useRef(new Set<string>());
  /** Close that used a just-typed password — drop it from RAM if that attempt fails. */
  const typedClosePasswordRef = useRef<string | null>(null);
  /** Unlock passwords to restore into session RAM after open when mode allows (per vault). */
  const unlockRetainPasswordsRef = useRef(new Map<string, string>());
  /** Invalidate late getSettings restores after close / re-open / failed open. */
  const openRetainGenRef = useRef(new Map<string, number>());

  const bumpOpenRetainGen = useCallback((vaultId: string): number => {
    const next = (openRetainGenRef.current.get(vaultId) ?? 0) + 1;
    openRetainGenRef.current.set(vaultId, next);
    return next;
  }, []);

  const markCredentialVerify = useCallback((vaultId: string) => {
    credentialVerifyIdsRef.current.add(vaultId);
  }, []);

  const clearCredentialVerify = useCallback((vaultId: string) => {
    credentialVerifyIdsRef.current.delete(vaultId);
  }, []);

  const isCredentialVerifying = useCallback((vaultId: string) => {
    return credentialVerifyIdsRef.current.has(vaultId);
  }, []);

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
  const lifecycleRequestRef = useRef(lifecycleRequest);
  lifecycleRequestRef.current = lifecycleRequest;

  const pipelineListStatus = useMemo(
    () => ({
      openingVaultIds: pipeline.openingVaultIds,
      closingVaultIds: [...new Set([...pipeline.closingVaultIds, ...closingHold.holdIds])],
      creatingVaultIds: pipeline.creatingVaultIds,
      queuedVaultIds: pipeline.queuedVaultIds,
      activeVaultId: pipeline.run?.vaultId,
      activeStartedAt: pipeline.run?.startedAt,
    }),
    [
      closingHold.holdIds,
      pipeline.closingVaultIds,
      pipeline.creatingVaultIds,
      pipeline.openingVaultIds,
      pipeline.queuedVaultIds,
      pipeline.run?.startedAt,
      pipeline.run?.vaultId,
    ],
  );

  const revertCloseFailure = useCallback(
    (vaultId: string) => {
      closingHold.cancel(vaultId);
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
    [closingHold, setVaultRuntimeState],
  );

  const handlePipelineError = useCallback(
    (vaultId: string, kind: "open" | "close", errorI18nKey: I18nKey) => {
      const wasBackground = pipelineBackgroundRef.current;
      pipelineBackgroundRef.current = false;

      dismissToast();
      showToast(t(errorI18nKey), 8000);

      if (kind === "open") {
        lifecycleService.clearPasswordInSession(vaultId);
      }

      if (kind === "close") {
        revertCloseFailure(vaultId);
      }

      if (wasBackground) {
        pipeline.dismissFailure();
      }
    },
    [dismissToast, lifecycleService, pipeline, revertCloseFailure, showToast, t],
  );

  const finishOpenVault = useCallback(
    (vaultId: string) => {
      closingHold.cancel(vaultId);
      setVaultRuntimeState(vaultId, {
        session: "open",
        ...touchVaultLastAccessed(t("vault.last_accessed.just_now")),
      });
      if (settings.app.last_opened_vault !== vaultId) {
        void patchSettings({ app: { last_opened_vault: vaultId } });
      }
    },
    [closingHold, patchSettings, setVaultRuntimeState, settings.app.last_opened_vault, t],
  );

  const releaseClosedSession = useCallback(
    (vaultId: string) => {
      bumpOpenRetainGen(vaultId);
      purgeForVaultClose(vaultId);
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [bumpOpenRetainGen, lifecycleService, purgeForVaultClose],
  );

  const revealClosed = useCallback(
    (vaultId: string) => {
      closeStartedWhileOpenRef.current.delete(vaultId);
      setVaultRuntimeState(vaultId, { session: null });
    },
    [setVaultRuntimeState],
  );

  const notifyPipelineComplete = useCallback(
    (vaultId: string, kind: VaultPipelineKind) => {
      dismissToast();
      if (!pipelineBackgroundRef.current) return;

      const vault = vaults.find((item) => item.id === vaultId);
      if (!vault) return;

      const key =
        kind === "open"
          ? "toast.pipeline_complete_open"
          : kind === "close"
            ? "toast.pipeline_complete_close"
            : "toast.pipeline_complete_create";

      showToast(t(key, { name: vault.displayName }));
      pipelineBackgroundRef.current = false;
    },
    [dismissToast, showToast, t, vaults],
  );

  const startOpenPipeline = useCallback(
    (vaultId: string): boolean => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;
      closingHold.cancel(vaultId);
      pipelineBackgroundRef.current = false;
      bumpOpenRetainGen(vaultId);

      return pipeline.start({
        vaultId,
        kind: "open",
        stepCount: lifecycleService.openingStepCount,
        presentation: "background",
        failureMode: "advance",
        runPipeline: lifecycleService.runOpeningPipeline.bind(lifecycleService),
        onComplete: () => {
          if (isCredentialVerifying(vaultId)) {
            clearCredentialVerify(vaultId);
            if (lifecycleRequestRef.current?.vaultId === vaultId) {
              setCredentialBusy(false);
              setCredentialErrorKey(null);
            }
          }
          const retain = unlockRetainPasswordsRef.current.get(vaultId) ?? null;
          unlockRetainPasswordsRef.current.delete(vaultId);
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vaultId) setLifecycleRequest(null);
          finishOpenVault(vaultId);
          const retainGen = bumpOpenRetainGen(vaultId);
          void vaultService
            .getSettings(vaultId)
            .then((vaultSettings) => {
              if (openRetainGenRef.current.get(vaultId) !== retainGen) return;
              if (vaultsRef.current.find((item) => item.id === vaultId)?.session !== "open") {
                return;
              }
              if (
                vaultSettings &&
                shouldRetainSessionRamPassword(vaultSettings.security.mode) &&
                retain
              ) {
                lifecycleService.setPasswordInSession(vaultId, retain);
              } else {
                lifecycleService.clearPasswordInSession(vaultId);
              }
            })
            .catch(() => {
              if (openRetainGenRef.current.get(vaultId) !== retainGen) return;
              if (vaultsRef.current.find((item) => item.id === vaultId)?.session !== "open") {
                return;
              }
              lifecycleService.clearPasswordInSession(vaultId);
            });
          notifyPipelineComplete(vaultId, "open");
        },
        onError: (errorI18nKey) => {
          bumpOpenRetainGen(vaultId);
          if (isCredentialVerifying(vaultId)) {
            clearCredentialVerify(vaultId);
            if (lifecycleRequestRef.current?.vaultId === vaultId) {
              setCredentialBusy(false);
            }
          }
          unlockRetainPasswordsRef.current.delete(vaultId);
          lifecycleService.clearPasswordInSession(vaultId);
          if (isVaultCredentialChallengeI18nKey(errorI18nKey)) {
            if (lifecycleRequestRef.current?.vaultId === vaultId) {
              setCredentialErrorKey(errorI18nKey);
            } else {
              const name =
                vaultsRef.current.find((item) => item.id === vaultId)?.displayName ?? vaultId;
              showToast(
                t("toast.unlock_challenge_failed", { name, detail: t(errorI18nKey) }),
                8000,
              );
            }
            return;
          }
          if (lifecycleRequestRef.current?.vaultId === vaultId) {
            setCredentialErrorKey(null);
          }
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vaultId) setLifecycleRequest(null);
          handlePipelineError(vaultId, "open", errorI18nKey);
        },
        onTimeout: () => {
          if (isCredentialVerifying(vaultId)) {
            return;
          }
          lifecycleService.clearPasswordInSession(vaultId);
        },
      });
    },
    [
      bumpOpenRetainGen,
      clearCredentialVerify,
      closingHold,
      finishOpenVault,
      handlePipelineError,
      isCredentialVerifying,
      lifecycleService,
      notifyPipelineComplete,
      pipeline,
      setLifecycleRequest,
      showToast,
      t,
      vaultService,
    ],
  );

  const startCreatePipeline = useCallback(
    (
      vaultId: string,
      runCreate: () => Promise<void>,
      hooks: {
        onComplete: () => void;
        onError: () => void;
      },
    ): boolean => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;
      pipelineBackgroundRef.current = true;
      return pipeline.start({
        vaultId,
        kind: "create",
        stepCount: 1,
        presentation: "background",
        budgetMs: LOADING_BUDGET_MS.vaultCreate,
        failureMode: "advance",
        runPipeline: async () => {
          await runCreate();
        },
        onComplete: () => {
          hooks.onComplete();
          notifyPipelineComplete(vaultId, "create");
        },
        onError: (errorI18nKey) => {
          hooks.onError();
          dismissToast();
          showToast(t(errorI18nKey), 8000);
          pipelineBackgroundRef.current = false;
        },
        onTimeout: () => {
          showToast(t("error.operation_timed_out"));
        },
      });
    },
    [dismissToast, notifyPipelineComplete, pipeline, showToast, t],
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
    source?: "user" | "auto_close";
  };

  const startClosePipeline = useCallback(
    (
      vault: VaultListItem,
      intent: Extract<VaultLifecycleIntent, "close">,
      opts?: ClosePipelineOpts,
    ): boolean => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return false;
      if (closingHold.holdIds.includes(vault.id)) return false;

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

      pipelineBackgroundRef.current = source === "auto_close";

      if (source === "auto_close") {
        showToast(t("toast.pipeline_background_close", { name: vault.displayName }), 0);
      }

      const started = pipeline.start({
        vaultId: vault.id,
        kind: intent,
        stepCount: lifecycleService.closingStepCount,
        presentation: "background",
        failureMode: "advance",
        runPipeline: lifecycleService.runClosingPipeline.bind(lifecycleService),
        onComplete: () => {
          if (isCredentialVerifying(vault.id)) {
            clearCredentialVerify(vault.id);
            if (lifecycleRequestRef.current?.vaultId === vault.id) {
              setCredentialBusy(false);
              setCredentialErrorKey(null);
            }
          }
          typedClosePasswordRef.current = null;
          setTypedCredential((current) => (current?.vaultId === vault.id ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vault.id) setLifecycleRequest(null);
          releaseClosedSession(vault.id);
          closingHold.settle(vault.id, () => {
            revealClosed(vault.id);
            notifyPipelineComplete(vault.id, intent);
          });
        },
        onError: (errorI18nKey) => {
          const typedClose = typedClosePasswordRef.current === vault.id;
          if (typedClose) {
            lifecycleService.clearPasswordInSession(vault.id);
            typedClosePasswordRef.current = null;
          }
          if (isCredentialVerifying(vault.id)) {
            clearCredentialVerify(vault.id);
            if (lifecycleRequestRef.current?.vaultId === vault.id) {
              setCredentialBusy(false);
            }
          }
          if (isVaultCredentialChallengeI18nKey(errorI18nKey)) {
            revertCloseFailure(vault.id);
            if (lifecycleRequestRef.current?.vaultId === vault.id) {
              setCredentialErrorKey(errorI18nKey);
            } else {
              showToast(
                t("toast.lock_challenge_failed", {
                  name: vault.displayName,
                  detail: t(errorI18nKey),
                }),
                8000,
              );
            }
            return;
          }
          if (lifecycleRequestRef.current?.vaultId === vault.id) {
            setCredentialErrorKey(null);
          }
          setTypedCredential((current) => (current?.vaultId === vault.id ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vault.id) setLifecycleRequest(null);
          handlePipelineError(vault.id, intent, errorI18nKey);
        },
      });
      if (started) {
        closingHold.begin(vault.id);
        setVaultRuntimeState(vault.id, { session: "closing" });
      }
      return started;
    },
    [
      clearCredentialVerify,
      closingHold,
      handlePipelineError,
      hasUnsavedForClose,
      isCredentialVerifying,
      notifyPipelineComplete,
      pipeline,
      promptUnsavedBeforeClose,
      releaseClosedSession,
      revealClosed,
      revertCloseFailure,
      lifecycleService,
      setLifecycleRequest,
      setVaultRuntimeState,
      showToast,
      t,
    ],
  );

  const handleLockVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      if (closingHold.holdIds.includes(vault.id)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
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
    [
      closingHold.holdIds,
      pipeline,
      setLifecycleRequest,
      showToast,
      startClosePipeline,
      t,
      vaultService,
    ],
  );

  const handleUnlockVault = useCallback(
    (vault: VaultListItem) => {
      // Mid-open or queued open: bring the password modal back with busy UI + retained password.
      if (isVaultOpenJobPending(vault.id, pipeline.run, pipeline.queued)) {
        markCredentialVerify(vault.id);
        setCredentialBusy(true);
        setCredentialErrorKey(null);
        setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
        return;
      }
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      if (resolveVaultDisplayStatus(vault) === "recovery") {
        setRecoveryVaultId(vault.id);
        return;
      }
      // Prefer not to await vault settings here: unlock always needs a password,
      // and a slow resolve/settings call would delay opening the credential modal.
      // (Daemon Argon2 is off the stdin loop now, so light RPCs no longer hang.)
      if (
        !needsWorkspaceSetupOnOpen(getSettingsSnapshot().workspace.path, WORKSPACE_PATH_DEFAULT)
      ) {
        setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
        return;
      }
      void (async () => {
        try {
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
      markCredentialVerify,
      pipeline,
      reportVaultRootIntegrityFailure,
      setLifecycleRequest,
      setRecoveryVaultId,
      settings.app.upriv_root_path,
      settings.app.vault_root_mode,
      showError,
      vaultRootService,
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
      if (!vaultService.canExportVault) return;
      if (!vaultCanExport(vault, pipelineListStatus)) {
        const listStatus = resolveVaultListStatus(vault, pipelineListStatus);
        if (
          listStatus === "opening" ||
          listStatus === "closing" ||
          listStatus === "creating" ||
          listStatus === "queued"
        ) {
          showToast(t("vault.export.blocked_opening"));
          return;
        }
        showToast(t("vault.export.blocked_open"));
        return;
      }
      setExportVaultId(vault.id);
    },
    [pipelineListStatus, setExportVaultId, showToast, t, vaultService.canExportVault],
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

  const handleAutoCloseVault = useCallback(
    (vault: VaultListItem, settings: VaultSettingsConfig): boolean => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return false;
      if (!canRunIdleAutoClose(vault, settings.security.mode)) {
        return false;
      }
      return startClosePipeline(vault, "close", {
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
      const closeModalOnSubmit = getSettingsSnapshot().ui.lifecycle_close_modal_on_submit === true;

      if (intent === "unlock") {
        if (pipeline.isVaultPipelineBusy(vaultId)) {
          showToast(t("toast.pipeline_busy"));
          return;
        }
        if (password) {
          lifecycleService.setPasswordInSession(vaultId, password);
          setTypedCredential({ vaultId, password });
          unlockRetainPasswordsRef.current.set(vaultId, password);
        }
        setCredentialErrorKey(null);
        setCredentialBusy(true);
        markCredentialVerify(vaultId);
        const hadActiveJob = pipeline.isRunningNow();
        const started = startOpenPipeline(vaultId);
        if (!started) {
          clearCredentialVerify(vaultId);
          unlockRetainPasswordsRef.current.delete(vaultId);
          setCredentialBusy(false);
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          lifecycleService.clearPasswordInSession(vaultId);
          showToast(t("toast.pipeline_busy"));
          return;
        }
        if (hadActiveJob) {
          showToast(t("toast.pipeline_queued", { name: lifecycleVault.displayName }));
        }
        if (closeModalOnSubmit) {
          setLifecycleRequest(null);
          setCredentialBusy(false);
        }
        return;
      }

      if (password) {
        if (pipeline.isVaultPipelineBusy(vaultId)) {
          showToast(t("toast.pipeline_busy"));
          return;
        }
        lifecycleService.setPasswordInSession(vaultId, password);
        typedClosePasswordRef.current = vaultId;
        setTypedCredential({ vaultId, password });
        setCredentialErrorKey(null);
        setCredentialBusy(true);
        markCredentialVerify(vaultId);
        const started = startClosePipeline(lifecycleVault, intent);
        if (!started) {
          clearCredentialVerify(vaultId);
          typedClosePasswordRef.current = null;
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          setCredentialBusy(false);
          lifecycleService.clearPasswordInSession(vaultId);
          showToast(t("toast.pipeline_busy"));
          return;
        }
        if (closeModalOnSubmit) {
          setLifecycleRequest(null);
          setCredentialBusy(false);
        }
        return;
      }

      // Close without password: keep the dialog if start fails (hold / busy).
      const started = startClosePipeline(lifecycleVault, intent);
      if (!started) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      setLifecycleRequest(null);
    },
    [
      clearCredentialVerify,
      getSettingsSnapshot,
      lifecycleRequest,
      lifecycleService,
      lifecycleVault,
      markCredentialVerify,
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
      bumpOpenRetainGen(vaultId);
      closingHold.cancel(vaultId);
      purgeForVaultClose(vaultId);
      lifecycleService.clearPasswordInSession(vaultId);
      void vaultService.unregisterSettings(vaultId);
    },
    [bumpOpenRetainGen, closingHold, lifecycleService, purgeForVaultClose, vaultService],
  );

  const workspaceSetupVault = useMemo(() => {
    if (!workspaceSetupVaultId) return null;
    return vaults.find((vault) => vault.id === workspaceSetupVaultId) ?? null;
  }, [vaults, workspaceSetupVaultId]);

  return {
    pipeline,
    pipelineListStatus,
    startCreatePipeline,
    credentialBusy,
    credentialErrorKey,
    abandonCredentialVerify: () => {
      // Only abandon the vault for the modal being closed — never steal another
      // vault's in-flight verify (close-on-submit keeps verify without a request).
      const modalVaultId = lifecycleRequest?.vaultId ?? null;
      if (modalVaultId && isCredentialVerifying(modalVaultId)) {
        if (pipeline.isVaultPipelineBusy(modalVaultId)) {
          pipelineBackgroundRef.current = true;
        } else {
          lifecycleService.clearPasswordInSession(modalVaultId);
          typedClosePasswordRef.current = null;
          unlockRetainPasswordsRef.current.delete(modalVaultId);
          setTypedCredential((current) => (current?.vaultId === modalVaultId ? null : current));
        }
        clearCredentialVerify(modalVaultId);
      }
      setCredentialBusy(false);
      setCredentialErrorKey(null);
    },
    credentialFieldPassword:
      lifecycleVault && typedCredential?.vaultId === lifecycleVault.id
        ? typedCredential.password
        : lifecycleVault
          ? unlockRetainPasswordsRef.current.get(lifecycleVault.id)
          : undefined,
    handleLockVault,
    handleUnlockVault,
    handleExportVault,
    handleConfirmExportVault,
    handleExportTimeout,
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
