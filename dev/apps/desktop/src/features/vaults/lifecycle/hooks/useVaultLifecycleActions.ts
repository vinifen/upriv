import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  appConfigEditAllowed,
  applyPlainPlaceChoice,
  canRunIdleAutoClose,
  currentWorkspaceSystem,
  errorOnPasswordField,
  idleWarningText,
  type IdleAutoCloseWarning,
  type IdleLockResult,
  isJobCancelled,
  isRpcError,
  isRpcTimeout,
  isVaultCredentialChallengeI18nKey,
  LOADING_BUDGET_MS,
  newJobId,
  vaultExportFilename,
  vaultExportSavedAs,
  normalizeVaultSettingsConfig,
  plainFolderClassI18nKey,
  storageModeIsPlaintext,
  BACKUP_CLOSE_TOAST_MS,
  backupCloseFailureToastKey,
  type BackupFailureReason,
  type PlainCloseSummary,
  type PlainFolderClass,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultExportRequest,
  type VaultLifecycleIntent,
  type VaultSession,
  askCloseToHurry,
  closeNowApplies,
  closeNowNeedsConfirm,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  touchVaultLastAccessed,
  vaultCanExport,
  isVaultOpenJobPending,
  type VaultListItem,
  type VaultPipelineKind,
  scheduleOpenFileManagerIfIdle,
  saveDirtyVaultDrafts,
  WORKSPACE_ERROR_CODES,
} from "@upriv/shared";
import { TOAST_DEFAULT_MS, useClosingDisplayHold, useVaultPipelineRun } from "@upriv/shared/react";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import {
  useJobService,
  useVaultFileSystemService,
  useVaultLifecycleService,
  useVaultService,
} from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import type { VaultListLifecycleModals } from "@/features/vaults/list";
import {
  closeIntentAfterUnsavedResolved,
  fileManagerDismissIntent,
  hasUnsavedWorkspaceChanges,
  vaultCloseBlockingPrompt,
  useFileManager,
} from "@/features/vaults/file-manager";
import type { I18nKey } from "@/i18n/types";
import {
  rpcVaultConfigGet,
  rpcVaultConfigSave,
  rpcVaultPlainDeletions,
  rpcVaultPlainDestination,
  rpcVaultPlainHeld,
  rpcVaultPlainLeftover,
  rpcVaultPlainRemove,
} from "@/lib/rpc";
import { useVaultAutoClose } from "./useVaultAutoClose";

interface UseVaultLifecycleActionsOptions {
  vaults: VaultListItem[];
  setVaultRuntimeState: (
    vaultId: string,
    patch: {
      session: VaultSession | null;
      lastAccessedAt?: string;
      lastAccessedWhen?: string;
      autoClosed?: boolean;
    },
  ) => void;
  modals: VaultListLifecycleModals;
  showToast: (message: string, durationMs?: number) => void;
  showError: (error: unknown, fallback: I18nKey) => void;
  dismissToast: () => void;
  t: (key: I18nKey, params?: Record<string, string>) => string;
  /** Vault ids whose settings persist is in flight — Open/Unlock must wait. */
  settingsPersistVaultIdsRef?: MutableRefObject<Set<string>>;
  /** Closed-vault work (password / unlock RAM) that must refuse open. */
  blockOpenVaultIdsRef?: MutableRefObject<Set<string>>;
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
  blockOpenVaultIdsRef,
}: UseVaultLifecycleActionsOptions) {
  const vaultService = useVaultService();
  const fs = useVaultFileSystemService();
  const lifecycleService = useVaultLifecycleService();
  const jobs = useJobService();
  const { settings, patchSettings, getSettingsSnapshot } = useAppSettingsContext();
  const {
    purgeForVaultClose,
    flushWorkspaceSnapshot,
    getEntry,
    subscribe: subscribeFileManager,
    maximize,
    dispatchWorkspace,
    openFromVault,
  } = useFileManager();
  const pipeline = useVaultPipelineRun(desktopErrorI18nKey);
  const closingHold = useClosingDisplayHold();
  const pipelineBackgroundRef = useRef(false);
  const exportBusyGenRef = useRef(0);
  /** The job of the export in flight, told to stop on timeout so core removes the partial file. */
  const exportJobRef = useRef<string | null>(null);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const reportIdleCloseFailureRef = useRef<(vaultId: string) => void>(() => {});
  const scheduleIdleRetryRef = useRef<() => void>(() => {});
  /** Vaults told "closes after the import"; an import that ends lets the next one tell again. */
  const importCloseNoticeRef = useRef(new Set<string>());
  const idleNoticeAtRef = useRef(0);
  useEffect(
    () =>
      subscribeFileManager(() => {
        for (const id of importCloseNoticeRef.current) {
          if (!getEntry(id)?.importInFlight) importCloseNoticeRef.current.delete(id);
        }
      }),
    [getEntry, subscribeFileManager],
  );
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
  /** Unlock passwords to put back in session RAM after a successful open. */
  const unlockRetainPasswordsRef = useRef(new Map<string, string>());
  /** Drops a stale close-all loop when the user starts another. */
  const closeAllGenRef = useRef(0);
  const closeAllSaveGenRef = useRef(0);
  const closeAllSaveInFlightRef = useRef(false);
  const [closeAllUnsavedOpen, setCloseAllUnsavedOpen] = useState(false);
  const [closeAllUnsavedSaving, setCloseAllUnsavedSaving] = useState(false);
  const [closeNowPrompt, setCloseNowPrompt] = useState<{
    vaultId: string;
    unsaved: boolean;
  } | null>(null);
  /** Running or waiting closes told to finish the Close now way. */
  const closeNowAskedRef = useRef(new Set<string>());
  const [closeNowVaultIds, setCloseNowVaultIds] = useState<readonly string[]>([]);

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
    exportVaultId,
    setExportVaultId,
    exportVault,
    exportJobVaultId,
    setExportJob,
    setExportPasswordError,
  } = modals;
  /** The vault the Export window shows now, read when an export settles. */
  const exportWindowVaultIdRef = useRef(exportVaultId);
  exportWindowVaultIdRef.current = exportVaultId;
  const lifecycleRequestRef = useRef(lifecycleRequest);
  lifecycleRequestRef.current = lifecycleRequest;
  const plainCloseRef = useRef<PlainCloseSummary | null>(null);
  const backupFailureRef = useRef<BackupFailureReason | null>(null);
  const [placeVaultId, setPlaceVaultId] = useState<string | null>(null);
  const [placeSubmitting, setPlaceSubmitting] = useState(false);
  const [placeWarningClass, setPlaceWarningClass] = useState<PlainFolderClass | null>(null);
  const [heldPrompt, setHeldPrompt] = useState<{
    vaultId: string;
    count: number;
    paths: string[];
  } | null>(null);
  const [heldSubmitting, setHeldSubmitting] = useState(false);
  const [recoveryLeftover, setRecoveryLeftover] = useState<PlainLeftover | null | undefined>(null);

  useEffect(() => {
    if (!recoveryVaultId) {
      setRecoveryLeftover(null);
      return;
    }
    const vault = vaultsRef.current.find((item) => item.id === recoveryVaultId);
    if (!vault || !storageModeIsPlaintext(vault.storageMode)) {
      setRecoveryLeftover(null);
      return;
    }
    let cancelled = false;
    setRecoveryLeftover(undefined);
    void rpcVaultPlainLeftover(recoveryVaultId)
      .then((leftover) => {
        if (!cancelled) setRecoveryLeftover(leftover);
      })
      .catch((error) => {
        if (!cancelled) showError(error, "error.unexpected");
      });
    return () => {
      cancelled = true;
    };
  }, [recoveryVaultId, showError]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const openPlain = vaultsRef.current.filter(
        (vault) =>
          storageModeIsPlaintext(vault.storageMode) && resolveVaultDisplayStatus(vault) === "open",
      );
      for (const vault of openPlain) {
        void rpcVaultPlainHeld(vault.id)
          .then((status) => {
            if (status.heldCount > 0) {
              setHeldPrompt({
                vaultId: vault.id,
                count: status.heldCount,
                paths: status.heldDeletions,
              });
            }
          })
          .catch(() => undefined);
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const vaultOpenHeld = useCallback(
    (vaultId: string) =>
      exportJobVaultId === vaultId || (blockOpenVaultIdsRef?.current.has(vaultId) ?? false),
    [blockOpenVaultIdsRef, exportJobVaultId],
  );

  useEffect(() => {
    if (!exportJobVaultId || lifecycleRequest?.vaultId !== exportJobVaultId) return;
    // Close a leftover unlock dialog. The busy toast stays on the open attempt.
    setLifecycleRequest(null);
  }, [exportJobVaultId, lifecycleRequest, setLifecycleRequest]);

  const pipelineListStatus = useMemo(
    () => ({
      openingVaultIds: pipeline.openingVaultIds,
      closingVaultIds: [...new Set([...pipeline.closingVaultIds, ...closingHold.holdIds])],
      backingUpVaultIds: pipeline.backingUpVaultIds,
      exportingVaultIds: exportJobVaultId ? [exportJobVaultId] : [],
      creatingVaultIds: pipeline.creatingVaultIds,
      queuedVaultIds: pipeline.queuedVaultIds,
      queuedOpenVaultIds: pipeline.queuedOpenVaultIds,
      closeNowVaultIds,
      activeVaultId: pipeline.run?.vaultId,
      activeStartedAt: pipeline.run?.startedAt,
    }),
    [
      closeNowVaultIds,
      closingHold.holdIds,
      exportJobVaultId,
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
        setVaultRuntimeState(vaultId, { session: "open", autoClosed: false });
        return;
      }
      setVaultRuntimeState(vaultId, { session: null, autoClosed: false });
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
        autoClosed: false,
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
      purgeForVaultClose(vaultId);
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [lifecycleService, purgeForVaultClose],
  );

  const revealClosed = useCallback(
    (vaultId: string, autoClosed = false) => {
      closeStartedWhileOpenRef.current.delete(vaultId);
      setVaultRuntimeState(vaultId, { session: null, autoClosed });
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
      if (vaultOpenHeld(vaultId)) return false;
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;
      closingHold.cancel(vaultId);
      pipelineBackgroundRef.current = false;

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
          if (retain) {
            lifecycleService.setPasswordInSession(vaultId, retain);
          }
          notifyPipelineComplete(vaultId, "open");
        },
        onError: (errorI18nKey) => {
          if (errorI18nKey === "plain.open.cancelled") {
            lifecycleService.clearPasswordInSession(vaultId);
            unlockRetainPasswordsRef.current.delete(vaultId);
            if (lifecycleRequestRef.current?.vaultId === vaultId) setLifecycleRequest(null);
            return;
          }
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
      vaultOpenHeld,
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
    ) => {
      pipelineBackgroundRef.current = true;
      pipeline.start({
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

  // A manual lock asks before discarding drafts or interrupting an import.
  // Idle lock saves drafts, waits for an import, and never shows that dialog.
  const promptUnsavedBeforeClose = useCallback(
    (vaultId: string, unsavedResolved?: boolean): boolean => {
      const entry = getEntry(vaultId);
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
    [dispatchWorkspace, getEntry, maximize],
  );

  const forgetCloseNow = useCallback((vaultId: string): boolean => {
    const asked = closeNowAskedRef.current.delete(vaultId);
    if (asked) setCloseNowVaultIds((ids) => ids.filter((id) => id !== vaultId));
    return asked;
  }, []);

  const hurryRunningClose = useCallback(
    (vaultId: string) => {
      closeNowAskedRef.current.add(vaultId);
      setCloseNowVaultIds((ids) => (ids.includes(vaultId) ? ids : [...ids, vaultId]));
      void askCloseToHurry(
        () => lifecycleService.hurryClose(vaultId),
        () => closeNowAskedRef.current.has(vaultId) && pipeline.isVaultPipelineBusy(vaultId),
      );
    },
    [lifecycleService, pipeline],
  );

  type ClosePipelineOpts = {
    source?: "user" | "auto_close";
    /** Close-all shows one summary instead of a toast per queued vault. */
    quietQueue?: boolean;
    /** Save or discard already ran. Skip the unsaved prompt; an import still blocks. */
    unsavedResolved?: boolean;
    /** Close now: core skips the backup, the closing pass, and the overwrite. */
    now?: boolean;
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
        const entry = getEntry(vault.id);
        const blocking = closeIntentAfterUnsavedResolved(
          entry ? fileManagerDismissIntent(entry) : "dismiss",
          opts?.unsavedResolved === true,
        );
        if (blocking !== "dismiss") return false;
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
          // This job owns the flag. Idle close does not keep a sticky toast.
          pipelineBackgroundRef.current = false;
          const entry = getEntry(vaultId);
          const blocked = closeIntentAfterUnsavedResolved(
            entry ? fileManagerDismissIntent(entry) : "dismiss",
            opts?.unsavedResolved === true,
          );
          if (blocked !== "dismiss" && entry) {
            closeDeferredRef.current.add(vaultId);
            if (source === "auto_close") {
              if (blocked === "import_in_progress") scheduleIdleRetryRef.current();
              else reportIdleCloseFailureRef.current(vaultId);
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
          const outcome = await lifecycleService.runClosingPipeline(
            vaultId,
            onStep,
            opts?.now || closeNowAskedRef.current.has(vaultId)
              ? "now"
              : source === "auto_close"
                ? "auto"
                : "user",
          );
          plainCloseRef.current = outcome.plain;
          backupFailureRef.current = outcome.backupFailed
            ? (outcome.backupFailure ?? "other")
            : null;
        },
        onComplete: () => {
          const immediate = forgetCloseNow(vault.id) || opts?.now === true;
          if (closeDeferredRef.current.delete(vault.id)) {
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
          setTypedCredential((current) => (current?.vaultId === vault.id ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vault.id) setLifecycleRequest(null);
          releaseClosedSession(vault.id);
          const summary = plainCloseRef.current;
          plainCloseRef.current = null;
          const backupFailure = backupFailureRef.current;
          backupFailureRef.current = null;
          closingHold.settle(
            vault.id,
            () => {
              notifyPipelineComplete(vault.id, intent);
              if (summary && summary.kept > 0) {
                setVaultRuntimeState(vault.id, { session: "recovery", autoClosed: false });
              } else {
                revealClosed(vault.id, source === "auto_close");
              }
              if (backupFailure) {
                showToast(
                  t(backupCloseFailureToastKey(backupFailure), { name: vault.displayName }),
                  BACKUP_CLOSE_TOAST_MS,
                );
                return;
              }
              if (summary && summary.kept > 0) {
                showToast(
                  t("plain.close.kept", {
                    name: vault.displayName,
                    count: String(summary.kept),
                  }),
                  8000,
                );
                return;
              }
              if (summary?.backupPinned) showToast(t("plain.close.pinned"));
            },
            { immediate },
          );
        },
        onTimeout: () => {
          forgetCloseNow(vault.id);
        },
        onError: (errorI18nKey) => {
          forgetCloseNow(vault.id);
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
          if (source === "auto_close") reportIdleCloseFailureRef.current(vault.id);
        },
      });
      if (!started) return false;
      if (waiting && !opts?.quietQueue && source !== "auto_close") {
        showToast(t("toast.pipeline_queued", { name: vault.displayName }));
      }
      return true;
    },
    [
      clearCredentialVerify,
      closingHold,
      forgetCloseNow,
      handlePipelineError,
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
      getEntry,
      maximize,
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
      startClosePipeline(vault, "close");
    },
    [closingHold.holdIds, pipeline, showToast, startClosePipeline, t],
  );

  const closeVaultNow = useCallback(
    (vault: VaultListItem) => {
      const entry = getEntry(vault.id);
      if (entry && hasUnsavedWorkspaceChanges(entry.workspace)) {
        dispatchWorkspace(vault.id, { type: "discard_all_dirty" });
      }
      startClosePipeline(vault, "close", { now: true, unsavedResolved: true });
    },
    [dispatchWorkspace, getEntry, startClosePipeline],
  );

  const handleCloseNow = useCallback(
    (vault: VaultListItem) => {
      // Its close is running or waiting, so nothing is left unsaved to ask about.
      if (pipeline.isVaultPipelineBusy(vault.id)) {
        if (settings.ui.lifecycle_confirm_close_now) {
          setCloseNowPrompt({ vaultId: vault.id, unsaved: false });
        } else {
          hurryRunningClose(vault.id);
        }
        return;
      }
      // That close already ended; only its badge is still up.
      if (closingHold.holdIds.includes(vault.id)) return;
      const entry = getEntry(vault.id);
      const intent = entry ? fileManagerDismissIntent(entry) : "dismiss";
      if (intent === "import_in_progress") {
        showToast(t("toast.close_now_import_running"));
        return;
      }
      const unsaved = intent === "unsaved";
      if (closeNowNeedsConfirm(settings.ui.lifecycle_confirm_close_now, unsaved)) {
        setCloseNowPrompt({ vaultId: vault.id, unsaved });
        return;
      }
      closeVaultNow(vault);
    },
    [
      closeVaultNow,
      closingHold.holdIds,
      getEntry,
      hurryRunningClose,
      pipeline,
      settings.ui.lifecycle_confirm_close_now,
      showToast,
      t,
    ],
  );

  const confirmCloseNow = useCallback(
    (dontAskAgain: boolean) => {
      setCloseNowPrompt(null);
      const vault = vaultsRef.current.find(
        (item) =>
          item.id === closeNowPrompt?.vaultId && closeNowApplies(resolveVaultDisplayStatus(item)),
      );
      if (!vault) return;
      if (dontAskAgain) void patchSettings({ ui: { lifecycle_confirm_close_now: false } });
      if (pipeline.isVaultPipelineBusy(vault.id)) {
        hurryRunningClose(vault.id);
        return;
      }
      if (getEntry(vault.id)?.importInFlight) {
        showToast(t("toast.close_now_import_running"));
        return;
      }
      closeVaultNow(vault);
    },
    [
      closeNowPrompt?.vaultId,
      closeVaultNow,
      getEntry,
      hurryRunningClose,
      patchSettings,
      pipeline,
      showToast,
      t,
    ],
  );

  const closeAllOpenVaults = useCallback(
    (opts?: { unsavedResolved?: boolean }) => {
      const generation = ++closeAllGenRef.current;
      const open = vaultsRef.current.filter((vault) => resolveVaultDisplayStatus(vault) === "open");
      if (!opts?.unsavedResolved) {
        const unsaved = open.some((vault) => {
          const entry = getEntry(vault.id);
          return Boolean(entry && hasUnsavedWorkspaceChanges(entry.workspace));
        });
        if (unsaved) {
          for (const vault of open) {
            if (getEntry(vault.id)?.workspace.unsavedPrompt) {
              dispatchWorkspace(vault.id, { type: "set_unsaved_prompt", prompt: null });
            }
          }
          setCloseAllUnsavedOpen(true);
          return;
        }
      }
      const alreadyRunning = pipeline.isRunningNow();
      let started = 0;
      let queuedName = "";
      for (const vault of open) {
        if (generation !== closeAllGenRef.current) return;
        if (pipeline.isVaultPipelineBusy(vault.id)) continue;
        if (closingHold.holdIds.includes(vault.id)) continue;
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
      if (started > 1) {
        showToast(t("toast.close_all_queued", { count: String(started) }));
        return;
      }
      if (started === 1 && alreadyRunning) {
        showToast(t("toast.pipeline_queued", { name: queuedName }));
      }
    },
    [closingHold.holdIds, dispatchWorkspace, getEntry, pipeline, showToast, startClosePipeline, t],
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
      startClosePipeline(vault, "close", { unsavedResolved: true });
    },
    [closingHold.holdIds, pipeline, showToast, startClosePipeline, t],
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
      const entry = getEntry(vault.id);
      if (!entry || !hasUnsavedWorkspaceChanges(entry.workspace)) continue;
      dispatchWorkspace(vault.id, { type: "discard_all_dirty" });
    }
    setCloseAllUnsavedOpen(false);
    closeAllOpenVaults({ unsavedResolved: true });
  }, [closeAllOpenVaults, dispatchWorkspace, getEntry]);

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
            const entry = getEntry(vault.id);
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
  }, [closeAllOpenVaults, dispatchWorkspace, fs, getEntry, showToast, t]);

  const handleUnlockVault = useCallback(
    (vault: VaultListItem) => {
      // Mid-open or queued open: bring the password modal back with busy UI + retained password.
      if (isVaultOpenJobPending(vault.id, pipeline.run, pipeline.queued)) {
        markCredentialVerify(vault.id);
        setCredentialBusy(true);
        setCredentialErrorKey(null);
        setLifecycleRequest({ vaultId: vault.id });
        return;
      }
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      if (vaultOpenHeld(vault.id)) {
        showToast(t("error.vault_busy"));
        return;
      }
      if (settingsPersistVaultIdsRef?.current.has(vault.id)) return;
      if (resolveVaultDisplayStatus(vault) === "recovery") {
        if (storageModeIsPlaintext(vault.storageMode)) setRecoveryLeftover(undefined);
        setRecoveryVaultId(vault.id);
        return;
      }
      if (!storageModeIsPlaintext(vault.storageMode)) {
        setLifecycleRequest({ vaultId: vault.id });
        return;
      }
      void (async () => {
        try {
          await rpcVaultPlainDestination(vault.id);
          setLifecycleRequest({ vaultId: vault.id });
        } catch (error) {
          if (isRpcError(error) && error.code === WORKSPACE_ERROR_CODES.UNSET) {
            setPlaceWarningClass(null);
            setPlaceVaultId(vault.id);
            return;
          }
          showError(error, "error.unexpected");
        }
      })();
    },
    [
      markCredentialVerify,
      pipeline,
      setLifecycleRequest,
      setRecoveryVaultId,
      settingsPersistVaultIdsRef,
      showError,
      showToast,
      t,
      vaultOpenHeld,
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
          listStatus === "queued" ||
          listStatus === "exporting" ||
          listStatus === "backing_up" ||
          listStatus === "changing_password" ||
          listStatus === "changing_kdf"
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

  /** Write the export into the folder chosen in its window, named after the vault. */
  const handleConfirmExportVault = useCallback(
    (request: VaultExportRequest, destDir: string) => {
      if (!exportVault || exportJobVaultId) return;
      const vault = exportVault;
      const gen = ++exportBusyGenRef.current;
      const job = newJobId();
      exportJobRef.current = job;
      setExportPasswordError(null);
      setExportJob({ id: job, vaultId: vault.id, format: request.format, startedAt: Date.now() });
      void vaultService
        .exportToFolder(vault, request, destDir, job)
        .then((written) => {
          if (gen !== exportBusyGenRef.current) return;
          // A file already used the name: core saved this one with a number.
          const savedAs = vaultExportSavedAs(vault.displayName, request.format, written.path);
          showToast(
            savedAs
              ? t("vault.export.success_numbered", {
                  filename: vaultExportFilename(vault.displayName, request.format),
                  name: vault.displayName,
                  saved: savedAs,
                })
              : t("vault.export.success", { name: vault.displayName }),
          );
          setExportVaultId(null);
        })
        .catch((error) => {
          if (gen !== exportBusyGenRef.current) return;
          if (isJobCancelled(error)) {
            showToast(t("toast.vault_export_cancelled"));
            setExportVaultId(null);
            return;
          }
          if (isRpcTimeout(error)) {
            // The call gave up before the budget did; core still writes the file.
            void jobs.cancel(job, "timeout").catch(() => {
              /* The export result is ignored either way. */
            });
          }
          const key = desktopErrorI18nKey(error, "vault.export.failed");
          if (!errorOnPasswordField(key)) {
            showError(error, "vault.export.failed");
            return;
          }
          // The window marks its password field; a window already closed gets a toast.
          const message = t(key);
          if (exportWindowVaultIdRef.current === vault.id) {
            setExportPasswordError({ vaultId: vault.id, message });
          } else {
            showToast(message);
          }
        })
        .finally(() => {
          if (gen !== exportBusyGenRef.current) return;
          exportJobRef.current = null;
          setExportJob(null);
        });
    },
    [
      exportJobVaultId,
      exportVault,
      jobs,
      setExportJob,
      setExportPasswordError,
      setExportVaultId,
      showError,
      showToast,
      t,
      vaultService,
    ],
  );

  /** Ask the running export to stop. Core will clean up any partial file. */
  const handleStopExportVault = useCallback(() => {
    const job = exportJobRef.current;
    if (!job) return;
    setExportJob((current) => (current ? { ...current, stopping: true } : null));
    void jobs.cancel(job, "user").catch(() => {
      /* The export result still settles the job. */
    });
  }, [jobs, setExportJob]);

  const handleExportTimeout = useCallback(() => {
    exportBusyGenRef.current += 1;
    const job = exportJobRef.current;
    exportJobRef.current = null;
    if (job) {
      void jobs.cancel(job, "timeout").catch(() => {
        /* The export result is ignored either way. */
      });
    }
    setExportJob(null);
    showToast(t("error.operation_timed_out"));
  }, [jobs, setExportJob, showToast, t]);

  const showIdleNotice = useCallback(
    (message: string) => {
      idleNoticeAtRef.current = Date.now();
      showToast(message);
    },
    [showToast],
  );

  const lockVaultWhenIdle = useCallback(
    async (vaultId: string): Promise<IdleLockResult> => {
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault || !canRunIdleAutoClose(vault)) return "wait";
      if (pipeline.isVaultPipelineBusy(vault.id) || closingHold.holdIds.includes(vault.id)) {
        return "wait";
      }
      const entry = getEntry(vault.id);
      const intent = entry ? fileManagerDismissIntent(entry) : "dismiss";
      if (intent === "import_in_progress") {
        if (!importCloseNoticeRef.current.has(vault.id)) {
          importCloseNoticeRef.current.add(vault.id);
          showIdleNotice(t("toast.auto_close_after_import", { name: vault.displayName }));
        }
        return "wait";
      }
      importCloseNoticeRef.current.delete(vault.id);
      if (intent === "unsaved") {
        const saved = await saveDirtyVaultDrafts({
          readVaults: () => {
            const current = getEntry(vault.id);
            return current ? [{ vaultId: vault.id, workspace: current.workspace }] : [];
          },
          writeFile: async (id, path, content) => {
            await fs.setFileContent(id, path, content);
          },
          markSaved: (id, path, content) => {
            dispatchWorkspace(id, { type: "mark_saved", path, content });
          },
          isCancelled: () => false,
        });
        if (saved !== "saved") {
          showIdleNotice(t("modal.file_manager.toast.save_failed"));
          return "abort";
        }
      }
      const started = startClosePipeline(vault, "close", {
        source: "auto_close",
        unsavedResolved: true,
      });
      return started ? "started" : "wait";
    },
    [
      closingHold.holdIds,
      dispatchWorkspace,
      fs,
      getEntry,
      pipeline,
      showIdleNotice,
      startClosePipeline,
      t,
    ],
  );

  const warnBeforeIdleClose = useCallback(
    (warnings: readonly IdleAutoCloseWarning[]): boolean => {
      if (Date.now() - idleNoticeAtRef.current < TOAST_DEFAULT_MS) return false;
      const message = idleWarningText(
        warnings,
        (id) => vaultsRef.current.find((vault) => vault.id === id)?.displayName ?? id,
        (name, secondsLeft) => t("warning.auto_close_soon", { name, seconds: String(secondsLeft) }),
      );
      if (!message) return true;
      showIdleNotice(message);
      return true;
    },
    [showIdleNotice, t],
  );

  const idleAutoClose = useVaultAutoClose({
    vaults,
    keepOpenOnWake: settings.ui.lifecycle_keep_open_on_wake === true,
    onLock: lockVaultWhenIdle,
    onWarn: warnBeforeIdleClose,
  });
  reportIdleCloseFailureRef.current = idleAutoClose.reportIdleCloseFailure;
  scheduleIdleRetryRef.current = idleAutoClose.scheduleIdleRetry;

  const handleLifecycleConfirm = useCallback(
    (password: string) => {
      if (!lifecycleRequest || !lifecycleVault) return;
      const { vaultId } = lifecycleRequest;
      const closeModalOnSubmit = getSettingsSnapshot().ui.lifecycle_close_modal_on_submit === true;
      if (vaultOpenHeld(vaultId)) {
        showToast(t("error.vault_busy"));
        return;
      }
      if (pipeline.isVaultPipelineBusy(vaultId)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      lifecycleService.setPasswordInSession(vaultId, password);
      setTypedCredential({ vaultId, password });
      unlockRetainPasswordsRef.current.set(vaultId, password);
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
      startOpenPipeline,
      t,
      vaultOpenHeld,
    ],
  );

  const handleRecoveryAction = useCallback(
    (action: PlainRecoveryAction) => {
      if (!recoveryVaultId) return;
      const vaultId = recoveryVaultId;

      if (action.kind === "resume_store") {
        if (pipeline.isVaultPipelineBusy(vaultId)) {
          showToast(t("toast.pipeline_busy"));
          return;
        }
        setRecoveryVaultId(null);
        setCredentialErrorKey(null);
        setCredentialBusy(false);
        setLifecycleRequest({ vaultId });
        return;
      }

      setRecoverySubmitting(true);
      void (async () => {
        try {
          await rpcVaultPlainRemove(vaultId);
          purgeForVaultClose(vaultId);
          lifecycleService.clearPasswordInSession(vaultId);
          setVaultRuntimeState(vaultId, { session: null, autoClosed: false });
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
    ],
  );

  const openPasswordAfterPlace = useCallback(
    (vaultId: string) => {
      setPlaceVaultId(null);
      setPlaceWarningClass(null);
      setLifecycleRequest({ vaultId });
    },
    [setLifecycleRequest],
  );

  const applyPlace = useCallback(
    async (choice: "default" | "custom" | "vault_only", path: string) => {
      if (!placeVaultId) return;
      const vaultId = placeVaultId;
      setPlaceSubmitting(true);
      try {
        const system = currentWorkspaceSystem();
        await applyPlainPlaceChoice({
          choice,
          path,
          system,
          saveWorkspace: (entry) => patchSettings({ workspace: { [system]: entry } }),
          saveVaultFolder: async (folder) => {
            const settings = await rpcVaultConfigGet(vaultId);
            await rpcVaultConfigSave(
              vaultId,
              normalizeVaultSettingsConfig({
                ...settings,
                mount: {
                  ...settings.mount,
                  [system]: { ...settings.mount[system], place: "unset", path: folder },
                },
              }),
            );
          },
        });
        const dest = await rpcVaultPlainDestination(vaultId);
        if (plainFolderClassI18nKey(dest.class)) {
          setPlaceWarningClass(dest.class);
          return;
        }
        openPasswordAfterPlace(vaultId);
      } catch (error) {
        showError(error, "error.unexpected");
      } finally {
        setPlaceSubmitting(false);
      }
    },
    [openPasswordAfterPlace, patchSettings, placeVaultId, showError],
  );

  const handleVaultDelete = useCallback(
    (vaultId: string) => {
      closingHold.cancel(vaultId);
      purgeForVaultClose(vaultId);
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [closingHold, lifecycleService, purgeForVaultClose],
  );

  const settleHeld = useCallback(
    (apply: boolean) => {
      if (!heldPrompt) return;
      const vaultId = heldPrompt.vaultId;
      setHeldSubmitting(true);
      void rpcVaultPlainDeletions(vaultId, apply)
        .then(() => setHeldPrompt(null))
        .catch((error) => showError(error, "error.unexpected"))
        .finally(() => setHeldSubmitting(false));
    },
    [heldPrompt, showError],
  );

  const placeVault = vaults.find((vault) => vault.id === placeVaultId) ?? null;
  const closeNowVault =
    vaults.find(
      (vault) =>
        vault.id === closeNowPrompt?.vaultId && closeNowApplies(resolveVaultDisplayStatus(vault)),
    ) ?? null;
  // A vault that closed under the window must not bring it back on its next open.
  useEffect(() => {
    if (closeNowPrompt && !closeNowVault) setCloseNowPrompt(null);
  }, [closeNowPrompt, closeNowVault]);

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
    handleCloseNow,
    closeNowVault,
    closeNowUnsaved: closeNowPrompt?.unsaved === true,
    closeNowAsks: settings.ui.lifecycle_confirm_close_now,
    cancelCloseNow: () => setCloseNowPrompt(null),
    confirmCloseNow,
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
    handleStopExportVault,
    handleExportTimeout,
    handleLifecycleConfirm,
    handleRecoveryAction,
    handleVaultDelete,
    recoveryLeftover,
    placeOpen: placeVaultId !== null,
    placeVaultName: placeVault?.displayName ?? "",
    placeWorkspaceChoices: appConfigEditAllowed("workspace.path", vaults, pipelineListStatus),
    placeSubmitting,
    placeWarningClass,
    onPlaceClose: () => {
      if (placeSubmitting) return;
      setPlaceVaultId(null);
      setPlaceWarningClass(null);
    },
    onPlaceContinue: (choice: "default" | "custom" | "vault_only", path: string) => {
      void applyPlace(choice, path);
    },
    onPlaceAcceptWarning: () => {
      if (placeVaultId) openPasswordAfterPlace(placeVaultId);
    },
    heldOpen: heldPrompt !== null,
    heldCount: heldPrompt?.count ?? 0,
    heldPaths: heldPrompt?.paths ?? [],
    heldSubmitting,
    onHeldApply: () => settleHeld(true),
    onHeldRestore: () => settleHeld(false),
  };
}
