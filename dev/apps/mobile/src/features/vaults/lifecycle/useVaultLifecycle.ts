import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  isVaultCredentialChallengeI18nKey,
  LOADING_BUDGET_MS,
  needsWorkspaceSetupOnOpen,
  requiresCloseDialog,
  resolveVaultDisplayStatus,
  shouldRetainSessionRamPassword,
  touchVaultLastAccessed,
  WORKSPACE_PATH_DEFAULT,
  shouldBumpVaultRootEpoch,
  isVaultOpenJobPending,
  type VaultLifecycleIntent,
  type VaultLifecycleRequest,
  type VaultListItem,
  type VaultPipelineKind,
  type VaultSession,
  type VaultSettingsConfig,
  scheduleOpenFileManagerIfIdle,
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
} from "@upriv/shared";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  useVaultLifecycleService,
  useVaultRootService,
  useVaultService,
} from "@/platform/services";
import { useClosingDisplayHold, useVaultPipelineRun } from "@upriv/shared/react";
import { useFileManager } from "@/features/vaults/file-manager";
import type { RecoveryAction } from "./VaultRecoveryModal";

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
  /** Close in-app file manager when recovery discards a vault session. */
  onDiscardWorkspace?: (vaultId: string) => void;
  /** Flush layout into the open session before `vault_close`. */
  onFlushWorkspace?: (vaultId: string) => Promise<void>;
  /** Open the in-app file manager after a successful unlock (settings-gated). */
  onOpenFileManager?: (vault: VaultListItem) => void;
  /** Vault ids whose settings persist is in flight — Open/Unlock must wait. */
  settingsPersistVaultIdsRef?: MutableRefObject<Set<string>>;
}

export function useVaultLifecycle({
  vaults,
  setVaultRuntimeState,
  lifecycleRequest,
  setLifecycleRequest,
  showToast,
  dismissToast,
  onDiscardWorkspace,
  onFlushWorkspace,
  onOpenFileManager,
  settingsPersistVaultIdsRef,
}: UseVaultLifecycleOptions) {
  const { t } = useTranslation();
  const { settings, patchSettings, getSettingsSnapshot, reportVaultRootIntegrityFailure } =
    useAppSettingsContext();
  const lifecycleService = useVaultLifecycleService();
  const vaultService = useVaultService();
  const vaultRootService = useVaultRootService();
  const { entries, maximize, dispatchWorkspace } = useFileManager();
  const pipeline = useVaultPipelineRun(mobileErrorI18nKey);
  const closingHold = useClosingDisplayHold();
  const pipelineBackgroundRef = useRef(false);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  /** Close accepted into the queue, then unsaved edits or an import appeared. */
  const closeDeferredRef = useRef(new Set<string>());
  const closeStartedWhileOpenRef = useRef(new Map<string, boolean>());
  const submittingRef = useRef(false);
  const [workspaceSetupVaultId, setWorkspaceSetupVaultId] = useState<string | null>(null);
  const [workspaceSetupRootPath, setWorkspaceSetupRootPath] = useState("");
  const [recoveryVaultId, setRecoveryVaultId] = useState<string | null>(null);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
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
  /**
   * Security mode learned while this vault is open. Lock uses it so a second
   * vault can queue without waiting on a settings RPC behind the close in flight.
   */
  const securityModeRef = useRef(new Map<string, VaultSettingsConfig["security"]["mode"]>());
  const lifecycleRequestRef = useRef(lifecycleRequest);
  lifecycleRequestRef.current = lifecycleRequest;

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

  const lifecycleVault = useMemo(() => {
    if (!lifecycleRequest) return null;
    return vaults.find((v) => v.id === lifecycleRequest.vaultId) ?? null;
  }, [lifecycleRequest, vaults]);

  const recoveryVault = useMemo(() => {
    if (!recoveryVaultId) return null;
    return vaults.find((v) => v.id === recoveryVaultId) ?? null;
  }, [recoveryVaultId, vaults]);

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
    (vaultId: string, kind: VaultPipelineKind, errorI18nKey: I18nKey) => {
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
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [bumpOpenRetainGen, lifecycleService],
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
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
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
    [dismissToast, showToast, t],
  );

  const startOpenPipeline = useCallback(
    (vaultId: string): boolean => {
      if (settingsPersistVaultIdsRef?.current.has(vaultId)) return false;
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
          scheduleOpenFileManagerIfIdle(
            getSettingsSnapshot().ui.lifecycle_open_file_manager_on_open === true,
            () => {
              const vault = vaultsRef.current.find((item) => item.id === vaultId);
              if (!vault || !onOpenFileManager) return;
              // Force open session — list state may still be mid-commit after finishOpenVault.
              onOpenFileManager({ ...vault, session: "open" });
            },
          );
          const retainGen = bumpOpenRetainGen(vaultId);
          void vaultService
            .getSettings(vaultId)
            .then((vaultSettings) => {
              if (openRetainGenRef.current.get(vaultId) !== retainGen) return;
              if (vaultsRef.current.find((item) => item.id === vaultId)?.session !== "open") {
                return;
              }
              if (vaultSettings) {
                securityModeRef.current.set(vaultId, vaultSettings.security.mode);
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
      getSettingsSnapshot,
      handlePipelineError,
      isCredentialVerifying,
      lifecycleService,
      notifyPipelineComplete,
      onOpenFileManager,
      pipeline,
      setLifecycleRequest,
      settingsPersistVaultIdsRef,
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

  const startClosePipeline = useCallback(
    (vaultId: string): boolean => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;
      if (closingHold.holdIds.includes(vaultId)) return false;
      const fmEntry = entries[vaultId];
      const prompt = fmEntry ? fileManagerBlockingPrompt(fileManagerDismissIntent(fmEntry)) : null;
      if (fmEntry && prompt) {
        maximize(vaultId);
        if (fmEntry.workspace.unsavedPrompt?.type !== prompt.type) {
          dispatchWorkspace(vaultId, { type: "set_unsaved_prompt", prompt });
        }
        return false;
      }
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      closeStartedWhileOpenRef.current.set(vaultId, vault?.session === "open");
      const waiting = pipeline.isRunningNow();
      const started = pipeline.start({
        vaultId,
        kind: "close",
        stepCount: lifecycleService.closingStepCount,
        presentation: "background",
        failureMode: "advance",
        runPipeline: async (id, onStep) => {
          pipelineBackgroundRef.current = false;
          const entry = entriesRef.current[id];
          const blocked = entry ? fileManagerDismissIntent(entry) : "dismiss";
          if (blocked !== "dismiss" && entry) {
            closeDeferredRef.current.add(id);
            const prompt = fileManagerBlockingPrompt(blocked);
            if (prompt) {
              maximize(id);
              if (entry.workspace.unsavedPrompt?.type !== prompt.type) {
                dispatchWorkspace(id, { type: "set_unsaved_prompt", prompt });
              }
            }
            return;
          }
          closingHold.begin(vaultId);
          setVaultRuntimeState(vaultId, { session: "closing" });
          await onFlushWorkspace?.(id);
          const outcome = await lifecycleService.runClosingPipeline(id, onStep);
          if (outcome.backupFailed) {
            const name = vaultsRef.current.find((item) => item.id === id)?.displayName ?? id;
            showToast(t("toast.backup_on_close_failed", { name }), 8000);
          }
        },
        onComplete: () => {
          if (closeDeferredRef.current.delete(vaultId)) {
            if (typedClosePasswordRef.current === vaultId) {
              lifecycleService.clearPasswordInSession(vaultId);
              typedClosePasswordRef.current = null;
            }
            if (isCredentialVerifying(vaultId)) {
              clearCredentialVerify(vaultId);
            }
            setCredentialBusy(false);
            setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
            if (lifecycleRequestRef.current?.vaultId === vaultId) setLifecycleRequest(null);
            pipelineBackgroundRef.current = false;
            return;
          }
          if (isCredentialVerifying(vaultId)) {
            clearCredentialVerify(vaultId);
            if (lifecycleRequestRef.current?.vaultId === vaultId) {
              setCredentialBusy(false);
              setCredentialErrorKey(null);
            }
          }
          typedClosePasswordRef.current = null;
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vaultId) setLifecycleRequest(null);
          releaseClosedSession(vaultId);
          closingHold.settle(vaultId, () => {
            revealClosed(vaultId);
            notifyPipelineComplete(vaultId, "close");
          });
        },
        onError: (errorI18nKey) => {
          const typedClose = typedClosePasswordRef.current === vaultId;
          if (typedClose) {
            lifecycleService.clearPasswordInSession(vaultId);
            typedClosePasswordRef.current = null;
          }
          if (isCredentialVerifying(vaultId)) {
            clearCredentialVerify(vaultId);
            if (lifecycleRequestRef.current?.vaultId === vaultId) {
              setCredentialBusy(false);
            }
          }
          if (isVaultCredentialChallengeI18nKey(errorI18nKey)) {
            revertCloseFailure(vaultId);
            if (lifecycleRequestRef.current?.vaultId === vaultId) {
              setCredentialErrorKey(errorI18nKey);
            } else {
              const name =
                vaultsRef.current.find((item) => item.id === vaultId)?.displayName ?? vaultId;
              showToast(t("toast.lock_challenge_failed", { name, detail: t(errorI18nKey) }), 8000);
            }
            return;
          }
          if (lifecycleRequestRef.current?.vaultId === vaultId) {
            setCredentialErrorKey(null);
          }
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vaultId) setLifecycleRequest(null);
          handlePipelineError(vaultId, "close", errorI18nKey);
        },
      });
      if (!started) return false;
      if (waiting) {
        const name = vaultsRef.current.find((item) => item.id === vaultId)?.displayName ?? vaultId;
        showToast(t("toast.pipeline_queued", { name }));
      }
      return true;
    },
    [
      clearCredentialVerify,
      closingHold,
      dispatchWorkspace,
      entries,
      handlePipelineError,
      isCredentialVerifying,
      lifecycleService,
      maximize,
      notifyPipelineComplete,
      onFlushWorkspace,
      pipeline,
      releaseClosedSession,
      revealClosed,
      revertCloseFailure,
      setLifecycleRequest,
      setVaultRuntimeState,
      showToast,
      t,
    ],
  );

  const requestLifecycle = useCallback(
    (vaultId: string, intent: VaultLifecycleIntent) => {
      // Mid-open or queued open: bring the password modal back with busy UI + retained password.
      if (intent === "unlock" && isVaultOpenJobPending(vaultId, pipeline.run, pipeline.queued)) {
        markCredentialVerify(vaultId);
        setCredentialBusy(true);
        setCredentialErrorKey(null);
        setLifecycleRequest({ vaultId, intent: "unlock" });
        return;
      }
      if (pipeline.isVaultPipelineBusy(vaultId)) return;
      if (intent === "unlock" && settingsPersistVaultIdsRef?.current.has(vaultId)) return;
      if (intent === "close" && closingHold.holdIds.includes(vaultId)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      if (intent === "unlock") {
        const vault = vaultsRef.current.find((item) => item.id === vaultId);
        if (vault && resolveVaultDisplayStatus(vault) === "recovery") {
          setRecoveryVaultId(vaultId);
          return;
        }
      }
      if (intent === "close") {
        const beginClose = (mode: VaultSettingsConfig["security"]["mode"]) => {
          const vault = vaultsRef.current.find((item) => item.id === vaultId);
          if (!vault) return;
          if (requiresCloseDialog(vault, mode)) {
            setLifecycleRequest({ vaultId, intent });
            return;
          }
          startClosePipeline(vaultId);
        };
        const known = securityModeRef.current.get(vaultId);
        if (known) {
          beginClose(known);
          return;
        }
        void (async () => {
          let mode: VaultSettingsConfig["security"]["mode"] = "session_ram";
          try {
            const vaultSettings = await vaultService.getSettings(vaultId);
            if (vaultSettings) {
              mode = vaultSettings.security.mode;
              securityModeRef.current.set(vaultId, mode);
            }
          } catch {
            // Lock is the safe direction; missing settings → session keys, no prompt.
            // Do not cache that guess — the next lock must read the mode again.
          }
          beginClose(mode);
        })();
        return;
      }
      if (
        !needsWorkspaceSetupOnOpen(getSettingsSnapshot().workspace.path, WORKSPACE_PATH_DEFAULT)
      ) {
        setLifecycleRequest({ vaultId, intent: "unlock" });
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
      closingHold.holdIds,
      getSettingsSnapshot,
      markCredentialVerify,
      pipeline,
      reportVaultRootIntegrityFailure,
      setLifecycleRequest,
      settings.app.upriv_root_path,
      settings.app.vault_root_mode,
      settingsPersistVaultIdsRef,
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
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      const closeModalOnSubmit = getSettingsSnapshot().ui.lifecycle_close_modal_on_submit === true;
      submittingRef.current = true;
      if (intent === "unlock" || password) {
        if (pipeline.isVaultPipelineBusy(vaultId)) {
          submittingRef.current = false;
          showToast(t("toast.pipeline_busy"));
          return;
        }
        if (password) {
          lifecycleService.setPasswordInSession(vaultId, password);
          setTypedCredential({ vaultId, password });
          if (intent === "unlock") {
            unlockRetainPasswordsRef.current.set(vaultId, password);
          } else {
            typedClosePasswordRef.current = vaultId;
          }
        }
        setCredentialErrorKey(null);
        setCredentialBusy(true);
        markCredentialVerify(vaultId);
        const hadActiveJob = intent === "unlock" && pipeline.isRunningNow();
        const started =
          intent === "unlock" ? startOpenPipeline(vaultId) : startClosePipeline(vaultId);
        submittingRef.current = false;
        if (!started) {
          clearCredentialVerify(vaultId);
          typedClosePasswordRef.current = null;
          unlockRetainPasswordsRef.current.delete(vaultId);
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          setCredentialBusy(false);
          lifecycleService.clearPasswordInSession(vaultId);
          showToast(t("toast.pipeline_busy"));
          return;
        }
        if (hadActiveJob && vault) {
          showToast(t("toast.pipeline_queued", { name: vault.displayName }));
        }
        if (closeModalOnSubmit) {
          setLifecycleRequest(null);
          setCredentialBusy(false);
        }
        return;
      }

      // Close without password: keep the dialog if start fails (hold / busy).
      const started = startClosePipeline(vaultId);
      submittingRef.current = false;
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
      markCredentialVerify,
      pipeline,
      setLifecycleRequest,
      showToast,
      startClosePipeline,
      startOpenPipeline,
      t,
    ],
  );

  const closingVaultIds = useMemo(
    () => [...new Set([...pipeline.closingVaultIds, ...closingHold.holdIds])],
    [closingHold.holdIds, pipeline.closingVaultIds],
  );

  const cancelLifecycle = useCallback(() => {
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
    setLifecycleRequest(null);
  }, [
    clearCredentialVerify,
    isCredentialVerifying,
    lifecycleRequest?.vaultId,
    lifecycleService,
    pipeline,
    setLifecycleRequest,
  ]);

  const handleRecoveryAction = useCallback(
    (action: RecoveryAction) => {
      if (!recoveryVaultId) return;

      if (action === "resume_store") {
        const vaultId = recoveryVaultId;
        // Resume = unlock the existing `store/` store. Always ask for the
        // password — session RAM is empty after a dirty-close restart.
        if (pipeline.isVaultPipelineBusy(vaultId)) {
          showToast(t("toast.pipeline_busy"));
          return;
        }
        setRecoveryVaultId(null);
        setCredentialErrorKey(null);
        setCredentialBusy(false);
        setLifecycleRequest({ vaultId, intent: "unlock" });
        return;
      }

      // `discard_workspace` — only offered for `upriv_plain` leftover plaintext.
      const vaultId = recoveryVaultId;
      setRecoverySubmitting(true);
      void (async () => {
        try {
          await vaultService.recoverDirtyClose(vaultId);
          onDiscardWorkspace?.(vaultId);
          lifecycleService.clearPasswordInSession(vaultId);
          setVaultRuntimeState(vaultId, { session: null });
          setRecoveryVaultId(null);
          showToast(t("toast.recovery_discarded"));
        } catch {
          showToast(t("error.unexpected"));
        } finally {
          setRecoverySubmitting(false);
        }
      })();
    },
    [
      lifecycleService,
      onDiscardWorkspace,
      pipeline,
      recoveryVaultId,
      setLifecycleRequest,
      setVaultRuntimeState,
      showToast,
      t,
      vaultService,
    ],
  );

  return {
    lifecycleVault,
    lifecycleIntent: lifecycleRequest?.intent ?? null,
    confirmLifecycle,
    cancelLifecycle,
    cancelClosingHold: closingHold.cancel,
    invalidateOpenRetain: bumpOpenRetainGen,
    credentialBusy,
    credentialFieldPassword:
      lifecycleVault && typedCredential?.vaultId === lifecycleVault.id
        ? typedCredential.password
        : lifecycleVault
          ? unlockRetainPasswordsRef.current.get(lifecycleVault.id)
          : undefined,
    credentialPipelineStep:
      pipeline.run && lifecycleRequest && pipeline.run.vaultId === lifecycleRequest.vaultId
        ? pipeline.run.activeStep
        : 0,
    credentialErrorKey,
    requestLifecycle,
    recoveryVault,
    recoveryOpen: recoveryVaultId !== null,
    recoverySubmitting,
    handleRecoveryAction,
    cancelRecovery: () => {
      if (!recoverySubmitting) setRecoveryVaultId(null);
    },
    activePipelineVaultId: pipeline.run?.vaultId ?? null,
    activePipelineStartedAt: pipeline.run?.startedAt ?? null,
    openingVaultIds: pipeline.openingVaultIds,
    closingVaultIds,
    creatingVaultIds: pipeline.creatingVaultIds,
    queuedVaultIds: pipeline.queuedVaultIds,
    queuedOpenVaultIds: pipeline.queuedOpenVaultIds,
    isVaultPipelineBusy: pipeline.isVaultPipelineBusy,
    startCreatePipeline,
    workspaceSetupOpen: workspaceSetupVaultId !== null,
    workspaceSetupRootPath,
    handleWorkspaceSetupCancel,
    handleWorkspaceSetupConfigured,
  };
}
