import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  canRunIdleAutoClose,
  isVaultCredentialChallengeI18nKey,
  LOADING_BUDGET_MS,
  requiresCloseDialog,
  shouldRetainSessionRamPassword,
  type VaultExportRequest,
  type VaultLifecycleIntent,
  type VaultSession,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  touchVaultLastAccessed,
  vaultCanExport,
  isVaultOpenJobPending,
  type VaultListItem,
  type VaultPipelineKind,
  type VaultSettingsConfig,
  scheduleOpenFileManagerIfIdle,
  saveDirtyVaultDrafts,
} from "@upriv/shared";
import { useClosingDisplayHold, useVaultPipelineRun } from "@upriv/shared/react";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import {
  useVaultFileSystemService,
  useVaultLifecycleService,
  useVaultService,
} from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { exportVaultPackage } from "@/features/vaults/list";
import type { VaultListLifecycleModals } from "@/features/vaults/list";
import {
  fileManagerDismissIntent,
  hasUnsavedWorkspaceChanges,
  vaultCloseBlockingPrompt,
  useFileManager,
} from "@/features/vaults/file-manager";
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
  /** Vault ids whose settings persist is in flight — Open/Unlock must wait. */
  settingsPersistVaultIdsRef?: MutableRefObject<Set<string>>;
}

export function useVaultLifecycleActions({
  vaults,
  setVaultRuntimeState,
  modals,
  showToast,
  showError,
  dismissToast,
  t,
  settingsPersistVaultIdsRef,
}: UseVaultLifecycleActionsOptions) {
  const vaultService = useVaultService();
  const fs = useVaultFileSystemService();
  const lifecycleService = useVaultLifecycleService();
  const { settings, patchSettings, getSettingsSnapshot } = useAppSettingsContext();
  const {
    purgeForVaultClose,
    flushWorkspaceSnapshot,
    entries,
    maximize,
    dispatchWorkspace,
    openFromVault,
  } = useFileManager();
  const pipeline = useVaultPipelineRun(desktopErrorI18nKey);
  const closingHold = useClosingDisplayHold();
  const pipelineBackgroundRef = useRef(false);
  const exportBusyGenRef = useRef(0);
  /** Aborted on export timeout so a late run cannot start the download. */
  const exportAbortRef = useRef<AbortController | null>(null);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  /** Close accepted into the queue, then unsaved edits or an import appeared. */
  const closeDeferredRef = useRef(new Set<string>());
  const closeStartedWhileOpenRef = useRef(new Map<string, boolean>());
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
   * Mode cannot change while the vault is open.
   */
  const securityModeRef = useRef(new Map<string, VaultSettingsConfig["security"]["mode"]>());
  /** Drops a stale close-all loop when the user starts another. */
  const closeAllGenRef = useRef(0);
  const closeAllSaveGenRef = useRef(0);
  const closeAllSaveInFlightRef = useRef(false);
  const [closeAllUnsavedOpen, setCloseAllUnsavedOpen] = useState(false);
  const [closeAllUnsavedSaving, setCloseAllUnsavedSaving] = useState(false);

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
    exportJobVaultId,
    setExportJob,
  } = modals;
  const lifecycleRequestRef = useRef(lifecycleRequest);
  lifecycleRequestRef.current = lifecycleRequest;

  const pipelineListStatus = useMemo(
    () => ({
      openingVaultIds: pipeline.openingVaultIds,
      closingVaultIds: [...new Set([...pipeline.closingVaultIds, ...closingHold.holdIds])],
      backingUpVaultIds: pipeline.backingUpVaultIds,
      creatingVaultIds: pipeline.creatingVaultIds,
      queuedVaultIds: pipeline.queuedVaultIds,
      queuedOpenVaultIds: pipeline.queuedOpenVaultIds,
      activeVaultId: pipeline.run?.vaultId,
      activeStartedAt: pipeline.run?.startedAt,
    }),
    [
      closingHold.holdIds,
      pipeline.backingUpVaultIds,
      pipeline.closingVaultIds,
      pipeline.creatingVaultIds,
      pipeline.openingVaultIds,
      pipeline.queuedOpenVaultIds,
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
              if (!vault) return;
              // Force open session — list state may still be mid-commit after finishOpenVault.
              openFromVault({ ...vault, session: "open" });
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
              setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
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
      openFromVault,
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
        onAbandoned?: (ok: boolean) => void;
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
        invalidateOnTimeout: true,
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
          hooks.onError();
          showToast(t("error.operation_timed_out"));
          pipelineBackgroundRef.current = false;
        },
        onAbandoned: (ok) => {
          hooks.onAbandoned?.(ok);
          if (!ok) return;
          hooks.onComplete();
          notifyPipelineComplete(vaultId, "create");
        },
      });
    },
    [dismissToast, notifyPipelineComplete, pipeline, showToast, t],
  );

  // Closing purges the workspace. Never discard unsaved drafts or interrupt
  // an in-flight import silently — surface the file-manager prompt and block.
  const hasUnsavedForClose = useCallback(
    (vaultId: string): boolean => {
      const entry = entries[vaultId];
      return Boolean(entry && fileManagerDismissIntent(entry) !== "dismiss");
    },
    [entries],
  );

  const promptUnsavedBeforeClose = useCallback(
    (vaultId: string, unsavedResolved?: boolean): boolean => {
      const entry = entries[vaultId];
      if (!entry) return false;
      const intent = fileManagerDismissIntent(entry);
      if (unsavedResolved && intent === "unsaved") return false;
      const prompt = vaultCloseBlockingPrompt(intent);
      if (!prompt) return false;
      maximize(vaultId);
      if (entry.workspace.unsavedPrompt?.type !== prompt.type) {
        dispatchWorkspace(vaultId, {
          type: "set_unsaved_prompt",
          prompt,
        });
      }
      return true;
    },
    [dispatchWorkspace, entries, maximize],
  );

  type ClosePipelineOpts = {
    source?: "user" | "auto_close";
    /** Close-all shows one summary instead of a toast per queued vault. */
    quietQueue?: boolean;
    /** Save or discard already ran. Skip the unsaved prompt; an import still blocks. */
    unsavedResolved?: boolean;
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
          const entry = entries[vault.id];
          showToast(
            t(
              entry?.importInFlight ? "warning.auto_close_importing" : "warning.auto_close_unsaved",
              { name: vault.displayName },
            ),
          );
          return false;
        }
      } else if (promptUnsavedBeforeClose(vault.id, opts?.unsavedResolved)) {
        return false;
      }

      const wasOpen = resolveVaultDisplayStatus(vault) === "open";
      closeStartedWhileOpenRef.current.set(vault.id, wasOpen);

      const waiting = pipeline.isRunningNow();

      const started = pipeline.start({
        vaultId: vault.id,
        kind: intent,
        stepCount: lifecycleService.closingStepCount,
        presentation: "background",
        failureMode: "advance",
        runPipeline: async (vaultId, onStep) => {
          // Set when this job runs. A later queued close must not clear it early.
          pipelineBackgroundRef.current = source === "auto_close";
          const entry = entriesRef.current[vaultId];
          let blocked = entry ? fileManagerDismissIntent(entry) : "dismiss";
          if (opts?.unsavedResolved && blocked === "unsaved") blocked = "dismiss";
          if (blocked !== "dismiss" && entry) {
            closeDeferredRef.current.add(vaultId);
            if (source === "auto_close") {
              showToast(
                t(
                  entry.importInFlight
                    ? "warning.auto_close_importing"
                    : "warning.auto_close_unsaved",
                  { name: vault.displayName },
                ),
              );
            } else {
              const prompt = vaultCloseBlockingPrompt(blocked);
              if (prompt) {
                maximize(vaultId);
                if (entry.workspace.unsavedPrompt?.type !== prompt.type) {
                  dispatchWorkspace(vaultId, { type: "set_unsaved_prompt", prompt });
                }
              }
            }
            return;
          }
          closingHold.begin(vault.id);
          setVaultRuntimeState(vault.id, { session: "closing" });
          await flushWorkspaceSnapshot(vaultId);
          const outcome = await lifecycleService.runClosingPipeline(vaultId, onStep);
          if (outcome.backupFailed) {
            showToast(t("toast.backup_on_close_failed", { name: vault.displayName }), 8000);
          }
        },
        onComplete: () => {
          if (closeDeferredRef.current.delete(vault.id)) {
            if (typedClosePasswordRef.current === vault.id) {
              lifecycleService.clearPasswordInSession(vault.id);
              typedClosePasswordRef.current = null;
            }
            if (isCredentialVerifying(vault.id)) {
              clearCredentialVerify(vault.id);
            }
            setCredentialBusy(false);
            setTypedCredential((current) => (current?.vaultId === vault.id ? null : current));
            if (lifecycleRequestRef.current?.vaultId === vault.id) setLifecycleRequest(null);
            pipelineBackgroundRef.current = false;
            return;
          }
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
              setTypedCredential((current) => (current?.vaultId === vault.id ? null : current));
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
      if (!started) return false;
      if (waiting && !opts?.quietQueue) {
        showToast(t("toast.pipeline_queued", { name: vault.displayName }));
      } else if (source === "auto_close") {
        showToast(t("toast.pipeline_background_close", { name: vault.displayName }), 0);
      }
      return true;
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
      dispatchWorkspace,
      flushWorkspaceSnapshot,
      maximize,
      setLifecycleRequest,
      setVaultRuntimeState,
      showToast,
      t,
      entries,
    ],
  );

  const securityModeFor = useCallback(
    async (vaultId: string): Promise<VaultSettingsConfig["security"]["mode"]> => {
      const known = securityModeRef.current.get(vaultId);
      if (known) return known;
      let securityMode: VaultSettingsConfig["security"]["mode"] = "session_ram";
      try {
        const vaultSettings = await vaultService.getSettings(vaultId);
        if (vaultSettings) {
          securityMode = vaultSettings.security.mode;
          securityModeRef.current.set(vaultId, securityMode);
        }
      } catch {
        // The mode could not be read. Ask before closing so an always_prompt
        // vault cannot skip the password check. Do not cache this guess.
        return "always_prompt";
      }
      return securityMode;
    },
    [vaultService],
  );

  const handleLockVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      if (closingHold.holdIds.includes(vault.id)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      const beginClose = (securityMode: VaultSettingsConfig["security"]["mode"]) => {
        if (requiresCloseDialog(vault, securityMode)) {
          setLifecycleRequest({ vaultId: vault.id, intent: "close" });
          return;
        }
        startClosePipeline(vault, "close");
      };
      const known = securityModeRef.current.get(vault.id);
      if (known) {
        beginClose(known);
        return;
      }
      void securityModeFor(vault.id).then(beginClose);
    },
    [
      closingHold.holdIds,
      pipeline,
      setLifecycleRequest,
      showToast,
      securityModeFor,
      startClosePipeline,
      t,
    ],
  );

  const closeAllOpenVaults = useCallback(
    (opts?: { unsavedResolved?: boolean }) => {
      const generation = ++closeAllGenRef.current;
      void (async () => {
        const open = vaultsRef.current.filter(
          (vault) => resolveVaultDisplayStatus(vault) === "open",
        );
        if (!opts?.unsavedResolved) {
          const unsaved = open.some((vault) => {
            const entry = entriesRef.current[vault.id];
            return Boolean(entry && hasUnsavedWorkspaceChanges(entry.workspace));
          });
          if (unsaved) {
            for (const vault of open) {
              if (entriesRef.current[vault.id]?.workspace.unsavedPrompt) {
                dispatchWorkspace(vault.id, { type: "set_unsaved_prompt", prompt: null });
              }
            }
            setCloseAllUnsavedOpen(true);
            return;
          }
        }
        const alreadyRunning = pipeline.isRunningNow();
        const needsConfirm: VaultListItem[] = [];
        let started = 0;
        let queuedName = "";
        for (const vault of open) {
          if (generation !== closeAllGenRef.current) return;
          if (pipeline.isVaultPipelineBusy(vault.id)) continue;
          if (closingHold.holdIds.includes(vault.id)) continue;
          const mode = await securityModeFor(vault.id);
          if (generation !== closeAllGenRef.current) return;
          if (pipeline.isVaultPipelineBusy(vault.id)) continue;
          if (requiresCloseDialog(vault, mode)) {
            needsConfirm.push(vault);
            continue;
          }
          if (
            startClosePipeline(vault, "close", {
              quietQueue: true,
              unsavedResolved: opts?.unsavedResolved,
            })
          ) {
            started += 1;
            queuedName = vault.displayName;
          }
        }
        if (generation !== closeAllGenRef.current) return;
        const pendingConfirm = needsConfirm[0];
        if (pendingConfirm) {
          setLifecycleRequest({ vaultId: pendingConfirm.id, intent: "close" });
        }
        const leftBehind = needsConfirm.length - (pendingConfirm ? 1 : 0);
        if (leftBehind > 0) {
          showToast(t("toast.close_all_needs_confirm", { count: String(leftBehind) }));
          return;
        }
        if (started > 1) {
          showToast(t("toast.close_all_queued", { count: String(started) }));
          return;
        }
        if (started === 1 && alreadyRunning) {
          showToast(t("toast.pipeline_queued", { name: queuedName }));
        }
      })();
    },
    [
      closingHold.holdIds,
      dispatchWorkspace,
      pipeline,
      securityModeFor,
      setLifecycleRequest,
      showToast,
      startClosePipeline,
      t,
    ],
  );

  const closeVaultAfterUnsaved = useCallback(
    (vaultId: string) => {
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault) return;
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      if (closingHold.holdIds.includes(vault.id)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      void (async () => {
        const mode = await securityModeFor(vault.id);
        if (requiresCloseDialog(vault, mode)) {
          setLifecycleRequest({ vaultId: vault.id, intent: "close" });
          return;
        }
        startClosePipeline(vault, "close", { unsavedResolved: true });
      })();
    },
    [
      closingHold.holdIds,
      pipeline,
      securityModeFor,
      setLifecycleRequest,
      showToast,
      startClosePipeline,
      t,
    ],
  );

  const cancelCloseAllUnsaved = useCallback(() => {
    closeAllSaveGenRef.current += 1;
    closeAllSaveInFlightRef.current = false;
    setCloseAllUnsavedSaving(false);
    setCloseAllUnsavedOpen(false);
  }, []);

  const timeoutCloseAllSave = useCallback(() => {
    if (!closeAllSaveInFlightRef.current) return;
    closeAllSaveGenRef.current += 1;
    closeAllSaveInFlightRef.current = false;
    setCloseAllUnsavedSaving(false);
    showToast(t("error.operation_timed_out"));
  }, [showToast, t]);

  const confirmCloseAllDiscard = useCallback(() => {
    if (closeAllSaveInFlightRef.current) return;
    const open = vaultsRef.current.filter((vault) => resolveVaultDisplayStatus(vault) === "open");
    for (const vault of open) {
      const entry = entriesRef.current[vault.id];
      if (!entry || !hasUnsavedWorkspaceChanges(entry.workspace)) continue;
      dispatchWorkspace(vault.id, { type: "discard_all_dirty" });
    }
    setCloseAllUnsavedOpen(false);
    closeAllOpenVaults({ unsavedResolved: true });
  }, [closeAllOpenVaults, dispatchWorkspace]);

  const confirmCloseAllSave = useCallback(() => {
    if (closeAllSaveInFlightRef.current) return;
    closeAllSaveInFlightRef.current = true;
    const generation = ++closeAllSaveGenRef.current;
    setCloseAllUnsavedSaving(true);
    void (async () => {
      const result = await saveDirtyVaultDrafts({
        readVaults: () =>
          vaultsRef.current.flatMap((vault) => {
            if (resolveVaultDisplayStatus(vault) !== "open") return [];
            const entry = entriesRef.current[vault.id];
            return entry ? [{ vaultId: vault.id, workspace: entry.workspace }] : [];
          }),
        writeFile: async (vaultId, path, content) => {
          await fs.setFileContent(vaultId, path, content);
        },
        markSaved: (vaultId, path, content) => {
          dispatchWorkspace(vaultId, { type: "mark_saved", path, content });
        },
        isCancelled: () => generation !== closeAllSaveGenRef.current,
      });
      if (generation !== closeAllSaveGenRef.current) return;
      if (result === "missing_draft") {
        showToast(t("modal.file_manager.toast.read_failed"));
        return;
      }
      if (result === "failed") {
        showToast(t("modal.file_manager.toast.save_failed"));
        return;
      }
      if (result !== "saved") return;
      setCloseAllUnsavedOpen(false);
      closeAllOpenVaults({ unsavedResolved: true });
    })().finally(() => {
      if (generation !== closeAllSaveGenRef.current) return;
      closeAllSaveInFlightRef.current = false;
      setCloseAllUnsavedSaving(false);
    });
  }, [closeAllOpenVaults, dispatchWorkspace, fs, showToast, t]);

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
      if (settingsPersistVaultIdsRef?.current.has(vault.id)) return;
      if (resolveVaultDisplayStatus(vault) === "recovery") {
        setRecoveryVaultId(vault.id);
        return;
      }
      // Encrypted open does not wait on a workspace folder. The in-app file
      // manager is always available; a desktop mount is optional.
      setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
    },
    [
      markCredentialVerify,
      pipeline,
      setLifecycleRequest,
      setRecoveryVaultId,
      settingsPersistVaultIdsRef,
    ],
  );

  const handleExportVault = useCallback(
    (vault: VaultListItem) => {
      if (!vaultService.canExportVault) return;
      if (exportJobVaultId && exportJobVaultId !== vault.id) {
        showToast(t("vault.export.busy"));
        return;
      }
      if (exportJobVaultId === vault.id) {
        setExportVaultId(vault.id);
        return;
      }
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
    [
      exportJobVaultId,
      pipelineListStatus,
      setExportVaultId,
      showToast,
      t,
      vaultService.canExportVault,
    ],
  );

  const handleConfirmExportVault = useCallback(
    (request: VaultExportRequest) => {
      if (!exportVault || exportJobVaultId) return;
      const vault = exportVault;
      const gen = ++exportBusyGenRef.current;
      exportAbortRef.current?.abort();
      const abort = new AbortController();
      exportAbortRef.current = abort;
      setExportJob({ vaultId: vault.id, startedAt: Date.now() });
      setExportSubmitting(true);
      void exportVaultPackage(
        vault,
        {
          getExportBytes: (row, exportRequest) => vaultService.getExportBytes(row, exportRequest),
          exportToPath: (row, exportRequest, destPath) =>
            vaultService.exportToPath(row, exportRequest, destPath),
        },
        request,
        abort.signal,
      )
        .then((outcome) => {
          if (gen !== exportBusyGenRef.current) return;
          if (outcome === "cancelled") return;
          showToast(t("vault.export.success", { name: vault.displayName }));
          setExportVaultId(null);
        })
        .catch((error) => {
          if (gen !== exportBusyGenRef.current) return;
          showError(error, "vault.export.failed");
        })
        .finally(() => {
          if (gen !== exportBusyGenRef.current) return;
          setExportSubmitting(false);
          setExportJob(null);
        });
    },
    [
      exportJobVaultId,
      exportVault,
      setExportJob,
      setExportSubmitting,
      setExportVaultId,
      showError,
      showToast,
      t,
      vaultService,
    ],
  );

  const handleExportTimeout = useCallback(() => {
    exportBusyGenRef.current += 1;
    exportAbortRef.current?.abort();
    setExportSubmitting(false);
    setExportJob(null);
    showToast(t("error.operation_timed_out"));
  }, [setExportJob, setExportSubmitting, showToast, t]);

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
          purgeForVaultClose(vaultId);
          lifecycleService.clearPasswordInSession(vaultId);
          setVaultRuntimeState(vaultId, { session: null });
          setRecoveryVaultId(null);
          showToast(t("toast.recovery_discarded"));
        } catch (error) {
          showError(error, "error.unexpected");
        } finally {
          setRecoverySubmitting(false);
        }
      })();
    },
    [
      lifecycleService,
      pipeline,
      purgeForVaultClose,
      recoveryVaultId,
      setLifecycleRequest,
      setRecoverySubmitting,
      setRecoveryVaultId,
      setVaultRuntimeState,
      showError,
      showToast,
      t,
      vaultService,
    ],
  );

  const handleVaultDelete = useCallback(
    (vaultId: string) => {
      bumpOpenRetainGen(vaultId);
      closingHold.cancel(vaultId);
      purgeForVaultClose(vaultId);
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [bumpOpenRetainGen, closingHold, lifecycleService, purgeForVaultClose],
  );

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
      } else if (modalVaultId) {
        setTypedCredential((current) => (current?.vaultId === modalVaultId ? null : current));
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
    closeAllOpenVaults,
    closeVaultAfterUnsaved,
    closeAllUnsavedOpen,
    closeAllUnsavedSaving,
    cancelCloseAllUnsaved,
    confirmCloseAllDiscard,
    confirmCloseAllSave,
    timeoutCloseAllSave,
    handleUnlockVault,
    handleExportVault,
    handleConfirmExportVault,
    handleExportTimeout,
    handleLifecycleConfirm,
    handleRecoveryAction,
    handleVaultDelete,
  };
}
