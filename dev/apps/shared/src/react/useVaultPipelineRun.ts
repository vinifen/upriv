import { useCallback, useMemo, useRef, useState } from "react";
import { CLOSING_BACKUP_STEP, isJobCancelled, newJobId, type VaultPipelineKind } from "../domain";
import type { I18nKey } from "../i18n/catalog";
import type { JobService } from "../services";
import { useJobProgress } from "./useJobProgress";

export interface VaultPipelineRunState {
  vaultId: string;
  kind: VaultPipelineKind;
  activeStep: number;
  stepCount: number;
  foreground: boolean;
  /**
   * The core job id the run sends. An open or a create can be stopped through
   * it; a close cannot: Close now is its stop.
   */
  job: string;
  /** When the request went out. A close counts from here. */
  sentAt: number;
  /** When Stop was asked for; `null` until then. */
  stoppingSince: number | null;
  errorKey?: I18nKey;
}

/** The clock and the Stop of the run in flight, for its row and its window. */
export interface VaultPipelineRunWork {
  vaultId: string;
  /** When core started it; `null` while a job still waits for its lane. */
  startedAt: number | null;
  /** False once the job reached the step it cannot stop; always false for a close. */
  stoppable: boolean;
  stoppingSince: number | null;
}

export type VaultPipelinePresentation = "foreground" | "background";

export interface QueuedPipelineJob {
  vaultId: string;
  kind: VaultPipelineKind;
}

export type VaultPipelineFailureMode = "hold" | "advance";

interface StartPipelineOptions {
  vaultId: string;
  kind: VaultPipelineKind;
  stepCount: number;
  /** Default `"foreground"`: the window or row owns the busy UI. `"background"` = row only. */
  presentation?: VaultPipelinePresentation;
  /**
   * `hold` (default): keep the failed run until `dismissFailure`; the window
   * or row shows the failure.
   * `advance`: a toast or the row owns the failure and the next queued run starts.
   */
  failureMode?: VaultPipelineFailureMode;
  /** `job` is the core job id this run sends; a close has no use for it. */
  runPipeline: (vaultId: string, onStep: (stepIndex: number) => void, job: string) => Promise<void>;
  onComplete: () => void;
  onError: (errorKey: I18nKey) => void;
  /** Stopped before core started it, or core stopped it and left nothing behind. */
  onStopped?: () => void;
}

interface PipelineRunEvents {
  errorToI18nKey: (error: unknown) => I18nKey;
  jobs: JobService;
  /** Core refused the stop (`job_not_stoppable`): the run goes on. */
  onStopRefused: (error: unknown) => void;
}

function listStatusKind(kind: VaultPipelineKind): "opening" | "closing" | "creating" {
  if (kind === "open") return "opening";
  if (kind === "create") return "creating";
  return "closing";
}

export type VaultPipelineListKind = "opening" | "closing" | "creating" | "queued";

/**
 * Global FIFO open/close/create runner (one pipeline at a time). Nothing in it
 * has a time limit: an open or a create ends when the person stops it
 * (`stop`), and a close when Close now hurries it.
 * `errorToI18nKey` is platform-owned (desktop bridge codes vs mobile SAF).
 */
export function useVaultPipelineRun({ errorToI18nKey, jobs, onStopRefused }: PipelineRunEvents) {
  const [run, setRun] = useState<VaultPipelineRunState | null>(null);
  const [queued, setQueued] = useState<QueuedPipelineJob[]>([]);
  const runRef = useRef<VaultPipelineRunState | null>(null);
  const queueRef = useRef<StartPipelineOptions[]>([]);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const onStopRefusedRef = useRef(onStopRefused);
  onStopRefusedRef.current = onStopRefused;
  const track = useJobProgress(jobs, run && run.kind !== "close" ? run.job : null);

  const syncRun = useCallback((next: VaultPipelineRunState | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const syncQueued = useCallback(() => {
    setQueued(
      queueRef.current.map((job) => ({
        vaultId: job.vaultId,
        kind: job.kind,
      })),
    );
  }, []);

  const executeJob = useCallback(
    (options: StartPipelineOptions) => {
      const { vaultId, kind, stepCount, runPipeline, onComplete, onError, onStopped } = options;
      const foreground = options.presentation !== "background";
      const failureMode = options.failureMode ?? "hold";
      const generation = ++generationRef.current;
      const job = newJobId();
      inFlightRef.current = true;

      syncRun({
        vaultId,
        kind,
        activeStep: 0,
        stepCount,
        foreground,
        job,
        sentAt: Date.now(),
        stoppingSince: null,
      });

      const pumpQueue = () => {
        if (queueRef.current.length === 0) return;
        const next = queueRef.current.shift()!;
        syncQueued();
        executeJob(next);
      };

      void (async () => {
        try {
          await runPipeline(
            vaultId,
            (stepIndex) => {
              if (generationRef.current !== generation) return;
              const current = runRef.current;
              if (current?.vaultId !== vaultId) return;
              syncRun({ ...current, activeStep: stepIndex });
            },
            job,
          );
          if (generationRef.current !== generation) return;

          // Patch session (open / closed) before dropping pipeline IDs so the
          // row never flashes Closed while the vault is already open in core.
          onComplete();
          syncRun(null);
        } catch (error) {
          if (generationRef.current !== generation) return;
          const current = runRef.current;
          if (current?.vaultId !== vaultId) return;

          if (isJobCancelled(error)) {
            syncRun(null);
            onStopped?.();
          } else {
            const errorKey = errorToI18nKey(error);
            if (failureMode === "advance") {
              syncRun(null);
              onError(errorKey);
            } else {
              syncRun({ ...current, foreground: true, stoppingSince: null, errorKey });
              onError(errorKey);
              return;
            }
          }
        } finally {
          if (generationRef.current === generation) {
            inFlightRef.current = false;
          }
        }

        if (generationRef.current !== generation) return;
        pumpQueue();
      })();
    },
    [errorToI18nKey, syncQueued, syncRun],
  );

  const start = useCallback(
    (options: StartPipelineOptions): boolean => {
      const alreadyTracked =
        runRef.current?.vaultId === options.vaultId ||
        queueRef.current.some((job) => job.vaultId === options.vaultId);
      if (alreadyTracked) return false;

      const job: StartPipelineOptions = { ...options };

      if (runRef.current === null && !inFlightRef.current) {
        executeJob(job);
        return true;
      }

      queueRef.current.push(job);
      syncQueued();
      return true;
    },
    [executeJob, syncQueued],
  );

  /**
   * Stop the open or create of `vaultId`. One still waiting in this queue is
   * dropped at once. One in core is asked to stop, and its own request ends it
   * (`onStopped`). A close is not stopped here: Close now hurries it.
   */
  const stop = useCallback(
    (vaultId: string) => {
      const waiting = queueRef.current.findIndex(
        (job) => job.vaultId === vaultId && job.kind !== "close",
      );
      if (waiting >= 0) {
        const [dropped] = queueRef.current.splice(waiting, 1);
        syncQueued();
        dropped.onStopped?.();
        return;
      }
      const current = runRef.current;
      if (!current || current.vaultId !== vaultId || current.kind === "close") return;
      if (current.errorKey || current.stoppingSince !== null) return;
      const job = current.job;
      syncRun({ ...current, stoppingSince: Date.now() });
      void jobs.cancel(job, "user").catch((error: unknown) => {
        const now = runRef.current;
        if (now?.job !== job) return;
        syncRun({ ...now, stoppingSince: null });
        onStopRefusedRef.current(error);
      });
    },
    [jobs, syncQueued, syncRun],
  );

  const dismissFailure = useCallback(() => {
    if (inFlightRef.current) {
      const current = runRef.current;
      if (current) syncRun({ ...current, foreground: false });
      return;
    }
    syncRun(null);
    if (queueRef.current.length === 0) return;
    const next = queueRef.current.shift()!;
    syncQueued();
    executeJob(next);
  }, [executeJob, syncQueued, syncRun]);

  const moveToBackground = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    syncRun({ ...current, foreground: false });
  }, [syncRun]);

  const isVaultPipelineBusy = useCallback((vaultId: string) => {
    return (
      runRef.current?.vaultId === vaultId || queueRef.current.some((job) => job.vaultId === vaultId)
    );
  }, []);

  const runWork = useMemo<VaultPipelineRunWork | null>(() => {
    if (!run || run.errorKey) return null;
    if (run.kind === "close") {
      return { vaultId: run.vaultId, startedAt: run.sentAt, stoppable: false, stoppingSince: null };
    }
    return {
      vaultId: run.vaultId,
      startedAt: track.startedAt,
      stoppable: track.progress?.stoppable ?? true,
      stoppingSince: run.stoppingSince,
    };
  }, [run, track]);

  const openingVaultIds = useMemo(() => {
    if (run?.kind === "open") return [run.vaultId];
    return [];
  }, [run]);

  const closingVaultIds = useMemo(() => {
    if (run?.kind === "close") return [run.vaultId];
    return [];
  }, [run]);

  /** Active close that reached the core backup phase. */
  const backingUpVaultIds = useMemo(() => {
    if (run?.kind === "close" && run.activeStep === CLOSING_BACKUP_STEP) return [run.vaultId];
    return [];
  }, [run]);

  const creatingVaultIds = useMemo(() => {
    const ids: string[] = [];
    if (run?.kind === "create") ids.push(run.vaultId);
    for (const job of queued) {
      if (job.kind === "create") ids.push(job.vaultId);
    }
    return ids;
  }, [run, queued]);

  /** Waiting open and close jobs. Create waits keep the creating label. */
  const queuedVaultIds = useMemo(
    () =>
      queued.filter((job) => job.kind === "open" || job.kind === "close").map((job) => job.vaultId),
    [queued],
  );

  /** Waiting opens only — a queued close is not an unlock to resume. */
  const queuedOpenVaultIds = useMemo(
    () => queued.filter((job) => job.kind === "open").map((job) => job.vaultId),
    [queued],
  );

  const getVaultPipelineListStatus = useCallback(
    (vaultId: string): VaultPipelineListKind | null => {
      if (run?.vaultId === vaultId) return listStatusKind(run.kind);
      const queuedJob = queued.find((job) => job.vaultId === vaultId);
      if (!queuedJob) return null;
      if (queuedJob.kind === "open" || queuedJob.kind === "close") return "queued";
      return listStatusKind(queuedJob.kind);
    },
    [queued, run],
  );

  const isRunning = run !== null || queued.length > 0;

  const isRunningNow = useCallback(() => {
    return runRef.current !== null || queueRef.current.length > 0 || inFlightRef.current;
  }, []);

  return useMemo(
    () => ({
      run,
      runWork,
      queued,
      start,
      stop,
      moveToBackground,
      dismissFailure,
      isVaultPipelineBusy,
      getVaultPipelineListStatus,
      openingVaultIds,
      closingVaultIds,
      backingUpVaultIds,
      creatingVaultIds,
      queuedVaultIds,
      queuedOpenVaultIds,
      isRunning,
      isRunningNow,
    }),
    [
      backingUpVaultIds,
      closingVaultIds,
      creatingVaultIds,
      dismissFailure,
      getVaultPipelineListStatus,
      isRunning,
      isRunningNow,
      isVaultPipelineBusy,
      moveToBackground,
      openingVaultIds,
      queued,
      queuedOpenVaultIds,
      queuedVaultIds,
      run,
      runWork,
      start,
      stop,
    ],
  );
}
