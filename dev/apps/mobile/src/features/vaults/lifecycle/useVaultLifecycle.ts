import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { AppState, Platform } from "react-native";
import {
  appConfigEditAllowed,
  applyPlainPlaceChoice,
  canRunIdleAutoClose,
  currentWorkspaceSystem,
  idleWarningText,
  type IdleAutoCloseWarning,
  type IdleLockResult,
  isRpcError,
  isVaultCredentialChallengeI18nKey,
  LOADING_BUDGET_MS,
  normalizeVaultSettingsConfig,
  plainFolderClassI18nKey,
  requiresCloseDialog,
  resolveVaultDisplayStatus,
  storageModeIsPlaintext,
  BACKUP_CLOSE_TOAST_MS,
  backupCloseFailureToastKey,
  type BackupFailureReason,
  touchVaultLastAccessed,
  isVaultOpenJobPending,
  type PlainCloseSummary,
  type PlainFolderClass,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultLifecycleIntent,
  type VaultLifecycleRequest,
  type VaultListItem,
  type VaultPipelineKind,
  type VaultSession,
  scheduleOpenFileManagerIfIdle,
  saveDirtyVaultDrafts,
  closeIntentAfterUnsavedResolved,
  fileManagerDismissIntent,
  hasUnsavedWorkspaceChanges,
  vaultCloseBlockingPrompt,
  WORKSPACE_ERROR_CODES,
} from "@upriv/shared";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useVaultFileSystemService, useVaultLifecycleService } from "@/platform/services";
import { TOAST_DEFAULT_MS, useClosingDisplayHold, useVaultPipelineRun } from "@upriv/shared/react";
import { useFileManager } from "@/features/vaults/file-manager";
import {
  rpcVaultConfigGet,
  rpcVaultConfigSave,
  rpcVaultPlainDeletions,
  rpcVaultPlainDestination,
  rpcVaultPlainHeld,
  rpcVaultPlainLeftover,
  rpcVaultPlainRemove,
  rpcVaultPlainSync,
} from "@/lib/rpc";
import { useVaultAutoClose } from "./useVaultAutoClose";

export type SetVaultRuntimeState = (
  vaultId: string,
  patch: {
    session: VaultSession | null;
    lastAccessedAt?: string;
    lastAccessedWhen?: string;
    autoClosed?: boolean;
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
  /** Export, password change, or unlock-RAM change — open must wait. */
  blockOpenVaultIdsRef?: MutableRefObject<Set<string>>;
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
  blockOpenVaultIdsRef,
}: UseVaultLifecycleOptions) {
  const { t } = useTranslation();
  const { settings, patchSettings, getSettingsSnapshot } = useAppSettingsContext();
  const lifecycleService = useVaultLifecycleService();
  const fs = useVaultFileSystemService();
  const { entries, maximize, dispatchWorkspace } = useFileManager();
  const pipeline = useVaultPipelineRun(mobileErrorI18nKey);
  const closingHold = useClosingDisplayHold();
  const pipelineBackgroundRef = useRef(false);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const reportIdleCloseFailureRef = useRef<(vaultId: string) => void>(() => {});
  const scheduleIdleRetryRef = useRef<() => void>(() => {});
  const importCloseNoticeRef = useRef(new Set<string>());
  const idleNoticeAtRef = useRef(0);
  for (const id of importCloseNoticeRef.current) {
    if (!entries[id]?.importInFlight) importCloseNoticeRef.current.delete(id);
  }
  /** Close accepted into the queue, then unsaved edits or an import appeared. */
  const closeDeferredRef = useRef(new Set<string>());
  const closeStartedWhileOpenRef = useRef(new Map<string, boolean>());
  const submittingRef = useRef(false);
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
  /** Unlock passwords to put back in session RAM after a successful open. */
  const unlockRetainPasswordsRef = useRef(new Map<string, string>());
  /** Drops a stale close-all loop when the user starts another. */
  const closeAllGenRef = useRef(0);
  const closeAllSaveGenRef = useRef(0);
  const closeAllSaveInFlightRef = useRef(false);
  const [closeAllUnsavedOpen, setCloseAllUnsavedOpen] = useState(false);
  const [closeAllUnsavedSaving, setCloseAllUnsavedSaving] = useState(false);
  const lifecycleRequestRef = useRef(lifecycleRequest);
  lifecycleRequestRef.current = lifecycleRequest;
  const [placeVaultId, setPlaceVaultId] = useState<string | null>(null);
  const [placeSubmitting, setPlaceSubmitting] = useState(false);
  const [placeWarningClass, setPlaceWarningClass] = useState<PlainFolderClass | null>(null);
  const [heldPrompt, setHeldPrompt] = useState<{ vaultId: string; count: number } | null>(null);
  const [heldSubmitting, setHeldSubmitting] = useState(false);
  const [recoveryLeftover, setRecoveryLeftover] = useState<PlainLeftover | null | undefined>(null);
  const plainCloseRef = useRef<Map<string, PlainCloseSummary | null>>(new Map());
  const backupFailureRef = useRef<Map<string, BackupFailureReason>>(new Map());

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      for (const vault of vaultsRef.current) {
        if (
          storageModeIsPlaintext(vault.storageMode) &&
          resolveVaultDisplayStatus(vault) === "open"
        ) {
          void rpcVaultPlainSync(vault.id).catch(() => undefined);
        }
      }
    });
    return () => sub.remove();
  }, []);

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
      .catch(() => {
        if (!cancelled) setRecoveryLeftover(null);
      });
    return () => {
      cancelled = true;
    };
  }, [recoveryVaultId]);

  useEffect(() => {
    const timer = setInterval(() => {
      for (const vault of vaultsRef.current) {
        if (
          !storageModeIsPlaintext(vault.storageMode) ||
          resolveVaultDisplayStatus(vault) !== "open"
        ) {
          continue;
        }
        void rpcVaultPlainHeld(vault.id)
          .then((status) => {
            if (status.heldCount > 0) {
              setHeldPrompt({ vaultId: vault.id, count: status.heldCount });
            }
          })
          .catch(() => undefined);
      }
    }, 20_000);
    return () => clearInterval(timer);
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
        setVaultRuntimeState(vaultId, { session: "open", autoClosed: false });
        return;
      }
      setVaultRuntimeState(vaultId, { session: null, autoClosed: false });
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
      lifecycleService.clearPasswordInSession(vaultId);
    },
    [lifecycleService],
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
      if (blockOpenVaultIdsRef?.current.has(vaultId)) return false;
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
              if (!vault || !onOpenFileManager) return;
              // Force open session — list state may still be mid-commit after finishOpenVault.
              onOpenFileManager({ ...vault, session: "open" });
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
      onOpenFileManager,
      pipeline,
      setLifecycleRequest,
      blockOpenVaultIdsRef,
      settingsPersistVaultIdsRef,
      showToast,
      t,
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

  const startClosePipeline = useCallback(
    (
      vaultId: string,
      opts?: { quietQueue?: boolean; unsavedResolved?: boolean; source?: "user" | "auto_close" },
    ): boolean => {
      if (pipeline.isVaultPipelineBusy(vaultId)) return false;
      if (closingHold.holdIds.includes(vaultId)) return false;
      const source = opts?.source ?? "user";
      const fmEntry = entriesRef.current[vaultId];
      const intent = fmEntry ? fileManagerDismissIntent(fmEntry) : "dismiss";
      if (source === "auto_close") {
        const blocking = closeIntentAfterUnsavedResolved(intent, opts?.unsavedResolved === true);
        if (blocking !== "dismiss") return false;
      } else {
        const prompt =
          fmEntry && !(opts?.unsavedResolved && intent === "unsaved")
            ? vaultCloseBlockingPrompt(intent)
            : null;
        if (fmEntry && prompt) {
          maximize(vaultId);
          if (fmEntry.workspace.unsavedPrompt?.type !== prompt.type) {
            dispatchWorkspace(vaultId, { type: "set_unsaved_prompt", prompt });
          }
          return false;
        }
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
          const blocked = closeIntentAfterUnsavedResolved(
            entry ? fileManagerDismissIntent(entry) : "dismiss",
            opts?.unsavedResolved === true,
          );
          if (blocked !== "dismiss" && entry) {
            closeDeferredRef.current.add(id);
            if (source === "auto_close") {
              if (blocked === "import_in_progress") scheduleIdleRetryRef.current();
              else reportIdleCloseFailureRef.current(id);
            } else {
              const prompt = vaultCloseBlockingPrompt(blocked);
              if (prompt) {
                maximize(id);
                if (entry.workspace.unsavedPrompt?.type !== prompt.type) {
                  dispatchWorkspace(id, { type: "set_unsaved_prompt", prompt });
                }
              }
            }
            return;
          }
          closingHold.begin(vaultId);
          setVaultRuntimeState(vaultId, { session: "closing" });
          await onFlushWorkspace?.(id);
          const outcome = await lifecycleService.runClosingPipeline(
            id,
            onStep,
            source === "auto_close" ? "auto" : "user",
          );
          plainCloseRef.current.set(id, outcome.plain);
          if (outcome.backupFailed) {
            backupFailureRef.current.set(id, outcome.backupFailure ?? "other");
          } else {
            backupFailureRef.current.delete(id);
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
          const summary = plainCloseRef.current.get(vaultId) ?? null;
          plainCloseRef.current.delete(vaultId);
          const backupFailure = backupFailureRef.current.get(vaultId) ?? null;
          backupFailureRef.current.delete(vaultId);
          const name = vault?.displayName ?? vaultId;
          closingHold.settle(vaultId, () => {
            notifyPipelineComplete(vaultId, "close");
            if (summary && summary.kept > 0) {
              setVaultRuntimeState(vaultId, { session: "recovery" });
            } else {
              revealClosed(vaultId, source === "auto_close");
            }
            if (backupFailure) {
              showToast(
                t(backupCloseFailureToastKey(backupFailure), { name }),
                BACKUP_CLOSE_TOAST_MS,
              );
              return;
            }
            if (summary && summary.kept > 0) {
              showToast(
                t("plain.close.kept", {
                  name,
                  count: String(summary.kept),
                }),
              );
              return;
            }
            if (summary?.backupPinned) showToast(t("plain.close.pinned"));
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
              setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
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
          if (source === "auto_close") reportIdleCloseFailureRef.current(vaultId);
        },
      });
      if (!started) return false;
      if (waiting && !opts?.quietQueue && source !== "auto_close") {
        const name = vaultsRef.current.find((item) => item.id === vaultId)?.displayName ?? vaultId;
        showToast(t("toast.pipeline_queued", { name }));
      }
      return true;
    },
    [
      clearCredentialVerify,
      closingHold,
      dispatchWorkspace,
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
      const entry = entriesRef.current[vault.id];
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
            const current = entriesRef.current[vault.id];
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
      const started = startClosePipeline(vault.id, {
        source: "auto_close",
        unsavedResolved: true,
      });
      return started ? "started" : "wait";
    },
    [closingHold.holdIds, dispatchWorkspace, fs, pipeline, showIdleNotice, startClosePipeline, t],
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
      if (intent === "unlock" && blockOpenVaultIdsRef?.current.has(vaultId)) {
        showToast(t("error.vault_busy"));
        return;
      }
      if (intent === "unlock" && settingsPersistVaultIdsRef?.current.has(vaultId)) return;
      if (intent === "close" && closingHold.holdIds.includes(vaultId)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      if (intent === "unlock") {
        const vault = vaultsRef.current.find((item) => item.id === vaultId);
        if (vault && resolveVaultDisplayStatus(vault) === "recovery") {
          if (storageModeIsPlaintext(vault.storageMode)) setRecoveryLeftover(undefined);
          setRecoveryVaultId(vaultId);
          return;
        }
        if (vault && storageModeIsPlaintext(vault.storageMode)) {
          void rpcVaultPlainDestination(vaultId)
            .then(() => {
              setLifecycleRequest({ vaultId, intent: "unlock" });
            })
            .catch((error) => {
              if (isRpcError(error) && error.code === WORKSPACE_ERROR_CODES.UNSET) {
                setPlaceVaultId(vaultId);
                return;
              }
              showToast(t("error.unexpected"));
            });
          return;
        }
      }
      if (intent === "close") {
        const vault = vaultsRef.current.find((item) => item.id === vaultId);
        if (!vault) return;
        if (requiresCloseDialog(vault)) {
          setLifecycleRequest({ vaultId, intent });
          return;
        }
        startClosePipeline(vaultId);
        return;
      }
      setLifecycleRequest({ vaultId, intent: "unlock" });
    },
    [
      blockOpenVaultIdsRef,
      closingHold.holdIds,
      markCredentialVerify,
      pipeline,
      setLifecycleRequest,
      settingsPersistVaultIdsRef,
      showToast,
      startClosePipeline,
      t,
    ],
  );

  const closeAllOpenVaults = useCallback(
    (opts?: { unsavedResolved?: boolean }) => {
      const generation = ++closeAllGenRef.current;
      const open = vaultsRef.current.filter((vault) => resolveVaultDisplayStatus(vault) === "open");
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
        if (requiresCloseDialog(vault)) {
          needsConfirm.push(vault);
          continue;
        }
        if (
          startClosePipeline(vault.id, {
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
    },
    [
      closingHold.holdIds,
      dispatchWorkspace,
      pipeline,
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
      if (requiresCloseDialog(vault)) {
        setLifecycleRequest({ vaultId: vault.id, intent: "close" });
        return;
      }
      startClosePipeline(vault.id, { unsavedResolved: true });
    },
    [closingHold.holdIds, pipeline, setLifecycleRequest, showToast, startClosePipeline, t],
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

  const confirmLifecycle = useCallback(
    (password: string | null) => {
      if (!lifecycleRequest || submittingRef.current) return;
      const { vaultId, intent } = lifecycleRequest;
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      const closeModalOnSubmit = getSettingsSnapshot().ui.lifecycle_close_modal_on_submit === true;
      submittingRef.current = true;
      if (intent === "unlock" || password) {
        if (intent === "unlock" && blockOpenVaultIdsRef?.current.has(vaultId)) {
          submittingRef.current = false;
          showToast(t("error.vault_busy"));
          return;
        }
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
      blockOpenVaultIdsRef,
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
    } else if (modalVaultId) {
      setTypedCredential((current) => (current?.vaultId === modalVaultId ? null : current));
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
        setLifecycleRequest({ vaultId, intent: "unlock" });
        return;
      }

      setRecoverySubmitting(true);
      void (async () => {
        try {
          await rpcVaultPlainRemove(vaultId);
          onDiscardWorkspace?.(vaultId);
          lifecycleService.clearPasswordInSession(vaultId);
          setVaultRuntimeState(vaultId, { session: null, autoClosed: false });
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
    ],
  );

  const openPasswordAfterPlace = useCallback(
    (vaultId: string) => {
      setPlaceVaultId(null);
      setPlaceWarningClass(null);
      setLifecycleRequest({ vaultId, intent: "unlock" });
    },
    [setLifecycleRequest],
  );

  const applyPlace = useCallback(
    async (choice: "default" | "custom" | "vault_only", path: string) => {
      if (!placeVaultId) return;
      const vaultId = placeVaultId;
      setPlaceSubmitting(true);
      try {
        const system = currentWorkspaceSystem(Platform.OS);
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
        showToast(t(mobileErrorI18nKey(error, "error.unexpected")));
      } finally {
        setPlaceSubmitting(false);
      }
    },
    [openPasswordAfterPlace, patchSettings, placeVaultId, showToast, t],
  );

  const settleHeld = useCallback(
    (apply: boolean) => {
      if (!heldPrompt) return;
      setHeldSubmitting(true);
      void rpcVaultPlainDeletions(heldPrompt.vaultId, apply)
        .then(() => setHeldPrompt(null))
        .catch(() => showToast(t("error.unexpected")))
        .finally(() => setHeldSubmitting(false));
    },
    [heldPrompt, showToast, t],
  );

  const placeVault = vaults.find((vault) => vault.id === placeVaultId) ?? null;

  return {
    lifecycleVault,
    lifecycleIntent: lifecycleRequest?.intent ?? null,
    confirmLifecycle,
    cancelLifecycle,
    cancelClosingHold: closingHold.cancel,
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
    closeAllOpenVaults,
    closeVaultAfterUnsaved,
    closeAllUnsavedOpen,
    closeAllUnsavedSaving,
    cancelCloseAllUnsaved,
    confirmCloseAllDiscard,
    confirmCloseAllSave,
    timeoutCloseAllSave,
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
    backingUpVaultIds: pipeline.backingUpVaultIds,
    creatingVaultIds: pipeline.creatingVaultIds,
    queuedVaultIds: pipeline.queuedVaultIds,
    queuedOpenVaultIds: pipeline.queuedOpenVaultIds,
    isVaultPipelineBusy: pipeline.isVaultPipelineBusy,
    startCreatePipeline,
    recoveryLeftover,
    placeOpen: placeVaultId !== null,
    placeVaultName: placeVault?.displayName ?? "",
    placeWorkspaceChoices: appConfigEditAllowed("workspace.path", vaults),
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
    heldSubmitting,
    onHeldApply: () => settleHeld(true),
    onHeldRestore: () => settleHeld(false),
  };
}
