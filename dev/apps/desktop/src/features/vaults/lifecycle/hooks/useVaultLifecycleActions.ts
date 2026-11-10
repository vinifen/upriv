import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  appConfigEditAllowed,
  applyPlainPlaceChoice,
  canRunIdleAutoClose,
  currentWorkspaceSystem,
  errorOnPasswordField,
  idleWarningText,
  type AutoCloseWhenBusy,
  type IdleAutoCloseWarning,
  type IdleLockResult,
  isRpcError,
  isVaultCredentialChallengeI18nKey,
  isVaultPipelineDisplayBusy,
  offersVaultRebuild,
  vaultExportToast,
  vaultRowJobWork,
  type VaultRowWork,
  normalizeVaultSettingsConfig,
  plainFolderClassI18nKey,
  storageModeIsPlaintext,
  BACKUP_CLOSE_TOAST_MS,
  backupCloseFailureToastKey,
  backupFellBackToastKey,
  closeAllFellBackToast,
  type BackupFailureReason,
  type BackupFellBack,
  type BackupFolderStatus,
  type PlainCloseSummary,
  type PlainFolderClass,
  type PlainLeftover,
  type PlainRecoveryAction,
  type VaultExportRequest,
  type VaultLifecycleIntent,
  type VaultClosePrompt,
  type VaultRuntimePatch,
  vaultCloseBlocker,
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
import {
  TOAST_DEFAULT_MS,
  useClosingDisplayHold,
  usePlainRemoveJob,
  useVaultExportJob,
  useVaultPipelineRun,
} from "@upriv/shared/react";
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
  fileManagerDismissIntent,
  hasUnsavedWorkspaceChanges,
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
  setVaultRuntimeState: (vaultId: string, patch: VaultRuntimePatch) => void;
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
    dismiss: dismissFileManager,
    cancelImports: cancelFileManagerImports,
    dispatchWorkspace,
    openFromVault,
  } = useFileManager();
  const pipeline = useVaultPipelineRun({
    errorToI18nKey: desktopErrorI18nKey,
    jobs,
    onStopRefused: (error) => showError(error, "error.job_not_stoppable"),
  });
  const closingHold = useClosingDisplayHold();
  const pipelineBackgroundRef = useRef(false);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const reportIdleCloseFailureRef = useRef<(vaultId: string) => void>(() => {});
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
  /** A Close all reports its backups that fell back in one toast. */
  const closeAllBackupsRef = useRef<{ waiting: Set<string>; fellBack: BackupFellBack[] } | null>(
    null,
  );
  const backupFallbackRef = useRef<BackupFolderStatus | null>(null);
  const [closePrompt, setClosePrompt] = useState<VaultClosePrompt | null>(null);
  const closePromptRef = useRef(closePrompt);
  closePromptRef.current = closePrompt;
  const closePromptSaveGenRef = useRef(0);
  const closePromptSaveInFlightRef = useRef(false);
  const [closePromptSaving, setClosePromptSaving] = useState(false);
  /** Closes that wait for their import to land, after Close and cancel. */
  const closeAfterImportRef = useRef(new Set<string>());
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
    exportVaultId,
    setExportVaultId,
    exportVault,
    setExportPasswordError,
  } = modals;
  /** The vault the Export window shows now, read when an export settles. */
  const exportWindowVaultIdRef = useRef(exportVaultId);
  exportWindowVaultIdRef.current = exportVaultId;
  const vaultExport = useVaultExportJob(vaultService, jobs, {
    onExported: (written, target) => {
      const toast = vaultExportToast(target, written, t);
      showToast(toast.message, toast.durationMs ?? undefined);
      setExportVaultId(null);
    },
    onFailed: (error, target) => {
      const key = desktopErrorI18nKey(error, "vault.export.failed");
      if (!errorOnPasswordField(key)) {
        showError(error, "vault.export.failed");
        return;
      }
      // The window marks its password field; a window already closed gets a toast.
      const message = t(key);
      if (exportWindowVaultIdRef.current === target.vaultId) {
        setExportPasswordError({ vaultId: target.vaultId, message });
      } else {
        showToast(message);
      }
    },
    onCancelled: () => {
      showToast(t("toast.vault_export_cancelled"));
      setExportVaultId(null);
    },
    onStopRefused: (error) => showError(error, "error.job_not_stoppable"),
  });
  const exportJobVaultId = vaultExport.job?.vaultId ?? null;
  const plainRemove = usePlainRemoveJob(rpcVaultPlainRemove, jobs, {
    onRemoved: (vaultId, wipe) => {
      if (wipe.kept > 0) {
        showToast(t("toast.recovery_incomplete"));
        return;
      }
      purgeForVaultClose(vaultId);
      lifecycleService.clearPasswordInSession(vaultId);
      setVaultRuntimeState(vaultId, { session: null, autoClosed: false, plainLeftover: false });
      showToast(t("toast.recovery_discarded"));
    },
    onFailed: (error) => showError(error, "error.unexpected"),
    onCancelled: () => showToast(t("toast.recovery_stopped")),
    onStopRefused: (_vaultId, error) => showError(error, "error.job_not_stoppable"),
  });
  const { start: startPlainRemove } = plainRemove;
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

  const plainRemoveJob = plainRemove.job;
  const rowWork = useMemo(() => {
    const work: Record<string, VaultRowWork> = {};
    // Waiting here, not sent yet: Stop drops it from the queue. A close has no Stop.
    for (const waiting of pipeline.queued) {
      if (waiting.kind === "close") continue;
      work[waiting.vaultId] = { startedAt: null, timed: false, stop: "ready", stoppingSince: null };
    }
    const run = pipeline.runWork;
    const runKind = pipeline.run?.kind;
    if (run && runKind === "close") {
      work[run.vaultId] = {
        startedAt: run.startedAt,
        timed: true,
        stop: null,
        stoppingSince: null,
      };
    } else if (run) {
      // An encrypted unlock is short by nature; filling a plain-text folder is not.
      const mode = vaults.find((vault) => vault.id === run.vaultId)?.storageMode;
      const timed = runKind !== "open" || (mode !== undefined && storageModeIsPlaintext(mode));
      work[run.vaultId] = vaultRowJobWork({ ...run, timed });
    }
    const exportJob = vaultExport.job;
    if (exportJob) {
      work[exportJob.vaultId] = vaultRowJobWork({
        startedAt: exportJob.startedAt,
        stoppable: exportJob.progress?.stoppable ?? true,
        stoppingSince: exportJob.stoppingSince,
      });
    }
    if (plainRemoveJob) {
      work[plainRemoveJob.vaultId] = vaultRowJobWork({
        startedAt: plainRemoveJob.startedAt,
        stoppable: plainRemoveJob.progress?.stoppable ?? true,
        stoppingSince: plainRemoveJob.stoppingSince,
      });
    }
    return work;
  }, [
    pipeline.queued,
    pipeline.run?.kind,
    pipeline.runWork,
    plainRemoveJob,
    vaultExport.job,
    vaults,
  ]);

  const pipelineListStatus = useMemo(
    () => ({
      openingVaultIds: pipeline.openingVaultIds,
      closingVaultIds: [...new Set([...pipeline.closingVaultIds, ...closingHold.holdIds])],
      backingUpVaultIds: pipeline.backingUpVaultIds,
      exportingVaultIds: exportJobVaultId ? [exportJobVaultId] : [],
      creatingVaultIds: pipeline.creatingVaultIds,
      queuedVaultIds: pipeline.queuedVaultIds,
      queuedOpenVaultIds: pipeline.queuedOpenVaultIds,
      recoveringVaultIds: plainRemoveJob ? [plainRemoveJob.vaultId] : undefined,
      closeNowVaultIds,
      rowWork,
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
      plainRemoveJob,
      rowWork,
    ],
  );

  /**
   * Stop the work a row shows: an open or a create (waiting or running), a
   * vault export, or the removal of a leftover folder. Core has the last word:
   * a stop it refuses comes back as a toast.
   */
  const stopVaultWork = useCallback(
    (vaultId: string) => {
      if (pipeline.isVaultPipelineBusy(vaultId)) {
        pipeline.stop(vaultId);
        return;
      }
      if (vaultExport.job?.vaultId === vaultId) {
        vaultExport.stop();
        return;
      }
      if (plainRemove.job?.vaultId === vaultId) plainRemove.stop();
    },
    [pipeline, plainRemove, vaultExport],
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
        runPipeline: (id, onStep, job) => lifecycleService.runOpeningPipeline(id, onStep, job),
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
          // A lost index keeps the row in recovery until a rebuild.
          if (offersVaultRebuild(errorI18nKey)) {
            setVaultRuntimeState(vaultId, { session: "recovery" });
          }
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
        onStopped: () => {
          // The vault stays closed; the typed password goes with the attempt.
          clearCredentialVerify(vaultId);
          unlockRetainPasswordsRef.current.delete(vaultId);
          lifecycleService.clearPasswordInSession(vaultId);
          setTypedCredential((current) => (current?.vaultId === vaultId ? null : current));
          if (lifecycleRequestRef.current?.vaultId === vaultId) {
            setCredentialBusy(false);
            setCredentialErrorKey(null);
            setLifecycleRequest(null);
          }
          pipelineBackgroundRef.current = false;
          showToast(t("error.job_cancelled"));
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
      setVaultRuntimeState,
      settingsPersistVaultIdsRef,
      showToast,
      t,
      vaultOpenHeld,
    ],
  );

  /**
   * Open `vaultId` with `password` with no unlock window, as the rebuild of
   * its lost index does once it ends. False when the open cannot start: the
   * vault is busy, or held by other work.
   */
  const openWithPassword = useCallback(
    (vaultId: string, password: string): boolean => {
      lifecycleService.setPasswordInSession(vaultId, password);
      if (startOpenPipeline(vaultId)) return true;
      lifecycleService.clearPasswordInSession(vaultId);
      return false;
    },
    [lifecycleService, startOpenPipeline],
  );

  /**
   * Create or import a vault as a core job. `onRemoved` runs when the vault
   * was not made: it failed, or the person stopped it and core removed it.
   */
  const startCreatePipeline = useCallback(
    (
      vaultId: string,
      runCreate: (job: string) => Promise<void>,
      hooks: {
        onComplete: () => void;
        onRemoved: () => void;
      },
    ) => {
      pipelineBackgroundRef.current = true;
      pipeline.start({
        vaultId,
        kind: "create",
        stepCount: 1,
        presentation: "background",
        failureMode: "advance",
        runPipeline: (_id, _onStep, job) => runCreate(job),
        onComplete: () => {
          hooks.onComplete();
          notifyPipelineComplete(vaultId, "create");
        },
        onError: (errorI18nKey) => {
          hooks.onRemoved();
          dismissToast();
          showToast(t(errorI18nKey), 8000);
          pipelineBackgroundRef.current = false;
        },
        onStopped: () => {
          hooks.onRemoved();
          dismissToast();
          showToast(t("error.job_cancelled"));
          pipelineBackgroundRef.current = false;
        },
      });
    },
    [dismissToast, notifyPipelineComplete, pipeline, showToast, t],
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
    /** Save or discard already ran: the drafts may still read as unsaved. An import still blocks. */
    unsavedResolved?: boolean;
    /** Close now: core skips the backup, the closing pass, and the overwrite. */
    now?: boolean;
  };

  /**
   * A close in a Close all ended. True when it belongs to that batch, whose
   * backups that fell back are reported once, by the last close to end.
   */
  const settleCloseAllBackup = useCallback(
    (vaultId: string, name: string, fallback: BackupFolderStatus | null): boolean => {
      const batch = closeAllBackupsRef.current;
      if (!batch?.waiting.has(vaultId)) return false;
      batch.waiting.delete(vaultId);
      if (fallback) batch.fellBack.push({ name, status: fallback });
      if (batch.waiting.size > 0) return true;
      closeAllBackupsRef.current = null;
      const toast = closeAllFellBackToast(batch.fellBack);
      if (toast) showToast(t(toast.key, toast.params), BACKUP_CLOSE_TOAST_MS);
      return true;
    },
    [showToast, t],
  );

  const startClosePipeline = useCallback(
    (
      vault: VaultListItem,
      intent: Extract<VaultLifecycleIntent, "close">,
      opts?: ClosePipelineOpts,
    ): boolean => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return false;
      if (closingHold.holdIds.includes(vault.id)) return false;
      // Callers ask first (`closeOrAsk`); idle close saves and waits on its own.
      if (vaultCloseBlocker(getEntry(vault.id), opts?.unsavedResolved === true)) return false;

      const source = opts?.source ?? "user";
      // The file manager goes with the close; the close waits for the layout it writes.
      if (getEntry(vault.id)) dismissFileManager(vault.id);

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
          backupFallbackRef.current = outcome.backupFallback;
        },
        onComplete: () => {
          const immediate = forgetCloseNow(vault.id) || opts?.now === true;
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
          const backupFallback = backupFallbackRef.current;
          backupFallbackRef.current = null;
          const reportedWithCloseAll = settleCloseAllBackup(
            vault.id,
            vault.displayName,
            backupFallback,
          );
          closingHold.settle(
            vault.id,
            () => {
              notifyPipelineComplete(vault.id, intent);
              if (summary && summary.kept > 0) {
                setVaultRuntimeState(vault.id, {
                  session: "recovery",
                  autoClosed: false,
                  plainLeftover: summary.leftover,
                });
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
              if (backupFallback && !reportedWithCloseAll) {
                showToast(
                  t(backupFellBackToastKey(backupFallback), { name: vault.displayName }),
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
        onError: (errorI18nKey) => {
          forgetCloseNow(vault.id);
          settleCloseAllBackup(vault.id, vault.displayName, null);
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
      releaseClosedSession,
      revealClosed,
      revertCloseFailure,
      lifecycleService,
      dismissFileManager,
      flushWorkspaceSnapshot,
      getEntry,
      setLifecycleRequest,
      setVaultRuntimeState,
      settleCloseAllBackup,
      showToast,
      t,
    ],
  );

  /**
   * Close by hand: unsaved drafts or a running import ask from the list first,
   * and the file manager stays where it is until the close starts.
   */
  const closeOrAsk = useCallback(
    (vault: VaultListItem, unsavedResolved = false) => {
      const blocker = vaultCloseBlocker(getEntry(vault.id), unsavedResolved);
      if (blocker) {
        setClosePrompt({ blocker, vaultIds: [vault.id], all: false });
        return;
      }
      startClosePipeline(vault, "close", { unsavedResolved });
    },
    [getEntry, startClosePipeline],
  );

  /** After Close and cancel, each vault closes once the file being written lands. */
  const closeAfterImportEnds = useCallback(() => {
    for (const id of closeAfterImportRef.current) {
      if (getEntry(id)?.importInFlight) continue;
      closeAfterImportRef.current.delete(id);
      const vault = vaultsRef.current.find((item) => item.id === id);
      if (vault && resolveVaultDisplayStatus(vault) === "open") closeOrAsk(vault);
    }
  }, [closeOrAsk, getEntry]);

  useEffect(
    () =>
      subscribeFileManager(() => {
        closeAfterImportEnds();
        // The import the prompt asked about ended: nothing is left to answer.
        const prompt = closePromptRef.current;
        if (
          prompt?.blocker === "import" &&
          !prompt.vaultIds.some((id) => getEntry(id)?.importInFlight)
        ) {
          setClosePrompt(null);
        }
      }),
    [closeAfterImportEnds, getEntry, subscribeFileManager],
  );

  const handleLockVault = useCallback(
    (vault: VaultListItem) => {
      if (pipeline.isVaultPipelineBusy(vault.id)) return;
      if (closingHold.holdIds.includes(vault.id)) {
        showToast(t("toast.pipeline_busy"));
        return;
      }
      closeOrAsk(vault);
    },
    [closeOrAsk, closingHold.holdIds, pipeline, showToast, t],
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
      const unsavedResolved = opts?.unsavedResolved === true;
      const open = vaultsRef.current.filter((vault) => resolveVaultDisplayStatus(vault) === "open");
      if (!unsavedResolved) {
        const unsaved = open
          .filter((vault) => vaultCloseBlocker(getEntry(vault.id), false) === "unsaved")
          .map((vault) => vault.id);
        if (unsaved.length > 0) {
          setClosePrompt({ blocker: "unsaved", vaultIds: unsaved, all: true });
          return;
        }
      }
      const alreadyRunning = pipeline.isRunningNow();
      const importing: string[] = [];
      const startedIds = new Set<string>();
      let started = 0;
      let queuedName = "";
      for (const vault of open) {
        if (generation !== closeAllGenRef.current) return;
        if (pipeline.isVaultPipelineBusy(vault.id)) continue;
        if (closingHold.holdIds.includes(vault.id)) continue;
        if (vaultCloseBlocker(getEntry(vault.id), unsavedResolved) === "import") {
          importing.push(vault.id);
          continue;
        }
        if (startClosePipeline(vault, "close", { quietQueue: true, unsavedResolved })) {
          started += 1;
          startedIds.add(vault.id);
          queuedName = vault.displayName;
        }
      }
      if (generation !== closeAllGenRef.current) return;
      if (started > 1) closeAllBackupsRef.current = { waiting: startedIds, fellBack: [] };
      if (importing.length > 0) {
        setClosePrompt({ blocker: "import", vaultIds: importing, all: importing.length > 1 });
      }
      if (started > 1) {
        showToast(t("toast.close_all_queued", { count: String(started) }));
        return;
      }
      if (started === 1 && alreadyRunning) {
        showToast(t("toast.pipeline_queued", { name: queuedName }));
      }
    },
    [closingHold.holdIds, getEntry, pipeline, showToast, startClosePipeline, t],
  );

  /** The prompt was answered: close what it was for, without asking about drafts again. */
  const continueAfterClosePrompt = useCallback(
    (prompt: VaultClosePrompt) => {
      setClosePrompt(null);
      if (prompt.all) {
        closeAllOpenVaults({ unsavedResolved: true });
        return;
      }
      for (const id of prompt.vaultIds) {
        const vault = vaultsRef.current.find((item) => item.id === id);
        if (vault && !pipeline.isVaultPipelineBusy(id)) closeOrAsk(vault, true);
      }
    },
    [closeAllOpenVaults, closeOrAsk, pipeline],
  );

  const cancelClosePrompt = useCallback(() => {
    closePromptSaveGenRef.current += 1;
    closePromptSaveInFlightRef.current = false;
    setClosePromptSaving(false);
    setClosePrompt(null);
  }, []);

  const timeoutClosePromptSave = useCallback(() => {
    if (!closePromptSaveInFlightRef.current) return;
    closePromptSaveGenRef.current += 1;
    closePromptSaveInFlightRef.current = false;
    setClosePromptSaving(false);
    showToast(t("error.operation_timed_out"));
  }, [showToast, t]);

  const confirmClosePromptDiscard = useCallback(() => {
    const prompt = closePromptRef.current;
    if (!prompt || closePromptSaveInFlightRef.current) return;
    for (const id of prompt.vaultIds) {
      const entry = getEntry(id);
      if (entry && hasUnsavedWorkspaceChanges(entry.workspace)) {
        dispatchWorkspace(id, { type: "discard_all_dirty" });
      }
    }
    continueAfterClosePrompt(prompt);
  }, [continueAfterClosePrompt, dispatchWorkspace, getEntry]);

  const confirmClosePromptSave = useCallback(() => {
    const prompt = closePromptRef.current;
    if (!prompt || closePromptSaveInFlightRef.current) return;
    closePromptSaveInFlightRef.current = true;
    const generation = ++closePromptSaveGenRef.current;
    setClosePromptSaving(true);
    void (async () => {
      const result = await saveDirtyVaultDrafts({
        readVaults: () =>
          prompt.vaultIds.flatMap((vaultId) => {
            const entry = getEntry(vaultId);
            return entry ? [{ vaultId, workspace: entry.workspace }] : [];
          }),
        writeFile: async (vaultId, path, content) => {
          await fs.setFileContent(vaultId, path, content);
        },
        markSaved: (vaultId, path, content) => {
          dispatchWorkspace(vaultId, { type: "mark_saved", path, content });
        },
        isCancelled: () => generation !== closePromptSaveGenRef.current,
      });
      if (generation !== closePromptSaveGenRef.current) return;
      if (result === "missing_draft") {
        showToast(t("modal.file_manager.toast.read_failed"));
        return;
      }
      if (result === "failed") {
        showToast(t("modal.file_manager.toast.save_failed"));
        return;
      }
      if (result !== "saved") return;
      continueAfterClosePrompt(prompt);
    })().finally(() => {
      if (generation !== closePromptSaveGenRef.current) return;
      closePromptSaveInFlightRef.current = false;
      setClosePromptSaving(false);
    });
  }, [continueAfterClosePrompt, dispatchWorkspace, fs, getEntry, showToast, t]);

  /** Stop storing the waiting files; each vault closes once the file being written lands. */
  const confirmClosePromptCancelImport = useCallback(() => {
    const prompt = closePromptRef.current;
    if (!prompt) return;
    setClosePrompt(null);
    for (const id of prompt.vaultIds) {
      closeAfterImportRef.current.add(id);
      cancelFileManagerImports(id);
    }
    closeAfterImportEnds();
  }, [cancelFileManagerImports, closeAfterImportEnds]);

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
        if (isVaultPipelineDisplayBusy(resolveVaultListStatus(vault, pipelineListStatus))) {
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
  const { start: startVaultExport } = vaultExport;
  const handleConfirmExportVault = useCallback(
    (request: VaultExportRequest, destDir: string) => {
      if (!exportVault) return;
      if (startVaultExport(exportVault, request, destDir)) setExportPasswordError(null);
    },
    [exportVault, setExportPasswordError, startVaultExport],
  );

  const showIdleNotice = useCallback(
    (message: string) => {
      idleNoticeAtRef.current = Date.now();
      showToast(message);
    },
    [showToast],
  );

  const lockVaultWhenIdle = useCallback(
    async (vaultId: string, whenBusy: AutoCloseWhenBusy): Promise<IdleLockResult> => {
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault || !canRunIdleAutoClose(vault)) return "wait";
      if (pipeline.isVaultPipelineBusy(vault.id) || closingHold.holdIds.includes(vault.id)) {
        return "wait";
      }
      const entry = getEntry(vault.id);
      const intent = entry ? fileManagerDismissIntent(entry) : "dismiss";
      if (intent === "import_in_progress") {
        // `close`: the import stops, and the next pass closes once it has ended.
        if (whenBusy === "close") {
          cancelFileManagerImports(vault.id, "auto_close");
          return "wait";
        }
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
      cancelFileManagerImports,
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

      // The wipe runs on the row; the window has nothing left to wait for.
      if (startPlainRemove(vaultId)) setRecoveryVaultId(null);
      else showToast(t("toast.pipeline_busy"));
    },
    [
      pipeline,
      recoveryVaultId,
      setLifecycleRequest,
      setRecoveryVaultId,
      showToast,
      startPlainRemove,
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
    closePrompt,
    closePromptVaultName:
      closePrompt && !closePrompt.all
        ? vaults.find((vault) => vault.id === closePrompt.vaultIds[0])?.displayName
        : undefined,
    closePromptSaving,
    cancelClosePrompt,
    confirmClosePromptDiscard,
    confirmClosePromptSave,
    confirmClosePromptCancelImport,
    timeoutClosePromptSave,
    handleUnlockVault,
    openWithPassword,
    handleExportVault,
    handleConfirmExportVault,
    /** The vault export in flight; it keeps running whether its window is open or not. */
    exportJob: vaultExport.job,
    handleStopExportVault: vaultExport.stop,
    /** The wipe of a leftover folder in flight; its row shows `recovering`. */
    plainRemoveJob: plainRemove.job,
    stopVaultWork,
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
