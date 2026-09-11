import { useCallback, useMemo, useRef, useState } from "react";
import { LOADING_BUDGET_MS, type VaultPipelineKind } from "../domain";
import type { I18nKey } from "../i18n/catalog";
import { scheduleTimeout } from "./schedule";

export interface VaultPipelineRunState {
  vaultId: string;
  kind: VaultPipelineKind;
  activeStep: number;
  stepCount: number;
  foreground: boolean;
  errorKey?: I18nKey;
}

export type VaultPipelinePresentation = "foreground" | "background";

export interface QueuedPipelineJob {
  vaultId: string;
  kind: VaultPipelineKind;
}

interface StartPipelineOptions {
  vaultId: string;
  kind: VaultPipelineKind;
  stepCount: number;
  /** Default `"foreground"` — overlay. `"background"` skips the blocking overlay. */
  presentation?: VaultPipelinePresentation;
  runPipeline: (vaultId: string, onStep: (stepIndex: number) => void) => Promise<void>;
  onComplete: () => void;
  onError: (errorKey: I18nKey) => void;
}

function listStatusKind(kind: VaultPipelineKind): "opening" | "closing" {
  return kind === "open" ? "opening" : "closing";
}

/**
 * Global FIFO open/close runner (one pipeline at a time).
 * `errorToI18nKey` is platform-owned (desktop bridge codes vs mobile SAF).
 */
export function useVaultPipelineRun(errorToI18nKey: (error: unknown) => I18nKey) {
  const [run, setRun] = useState<VaultPipelineRunState | null>(null);
  const [queued, setQueued] = useState<QueuedPipelineJob[]>([]);
  const runRef = useRef<VaultPipelineRunState | null>(null);
  const queueRef = useRef<StartPipelineOptions[]>([]);
  const generationRef = useRef(0);

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
    (job: StartPipelineOptions) => {
      const { vaultId, kind, stepCount, runPipeline, onComplete, onError } = job;
      const foreground = job.presentation !== "background";
      const generation = ++generationRef.current;

      syncRun({ vaultId, kind, activeStep: 0, stepCount, foreground });

      void (async () => {
        const cancelBudget = scheduleTimeout(() => {
          if (generationRef.current !== generation) return;
          generationRef.current += 1;
          const current = runRef.current;
          if (!current || current.vaultId !== vaultId || current.errorKey) return;
          const errorKey: I18nKey = "loading.timed_out";
          syncRun({ ...current, foreground: true, errorKey });
          onError(errorKey);
        }, LOADING_BUDGET_MS.vaultPipeline);

        try {
          await runPipeline(vaultId, (stepIndex) => {
            if (generationRef.current !== generation) return;
            const current = runRef.current;
            if (current?.vaultId !== vaultId) return;
            syncRun({ ...current, activeStep: stepIndex });
          });

          if (generationRef.current !== generation) return;

          syncRun(null);
          onComplete();
        } catch (error) {
          if (generationRef.current !== generation) return;

          const current = runRef.current;
          if (current?.vaultId !== vaultId) return;

          const errorKey = errorToI18nKey(error);
          syncRun({ ...current, foreground: true, errorKey });
          onError(errorKey);
          return;
        } finally {
          cancelBudget();
        }

        if (generationRef.current !== generation) return;

        if (queueRef.current.length > 0) {
          const next = queueRef.current.shift()!;
          syncQueued();
          executeJob(next);
        }
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

      if (runRef.current === null) {
        executeJob(job);
        return true;
      }

      queueRef.current.push(job);
      syncQueued();
      return true;
    },
    [executeJob, syncQueued],
  );

  const dismissFailure = useCallback(() => {
    syncRun(null);
    if (queueRef.current.length === 0) return;
    const next = queueRef.current.shift()!;
    syncQueued();
    executeJob(next);
  }, [executeJob, syncQueued, syncRun]);

  const moveToBackground = useCallback(() => {
    const current = runRef.current;
    if (!current || current.errorKey) return;
    syncRun({ ...current, foreground: false });
  }, [syncRun]);

  const isVaultPipelineBusy = useCallback((vaultId: string) => {
    return (
      runRef.current?.vaultId === vaultId || queueRef.current.some((job) => job.vaultId === vaultId)
    );
  }, []);

  const openingVaultIds = useMemo(() => {
    const ids: string[] = [];
    if (run?.kind === "open") ids.push(run.vaultId);
    for (const job of queued) {
      if (job.kind === "open") ids.push(job.vaultId);
    }
    return ids;
  }, [run, queued]);

  const closingVaultIds = useMemo(() => {
    const ids: string[] = [];
    if (run && run.kind !== "open") ids.push(run.vaultId);
    for (const job of queued) {
      if (job.kind !== "open") ids.push(job.vaultId);
    }
    return ids;
  }, [run, queued]);

  const getVaultPipelineListStatus = useCallback(
    (vaultId: string): "opening" | "closing" | null => {
      if (run?.vaultId === vaultId) return listStatusKind(run.kind);
      const queuedJob = queued.find((job) => job.vaultId === vaultId);
      return queuedJob ? listStatusKind(queuedJob.kind) : null;
    },
    [queued, run],
  );

  const isRunning = run !== null || queued.length > 0;

  const isRunningNow = useCallback(() => {
    return runRef.current !== null || queueRef.current.length > 0;
  }, []);

  return useMemo(
    () => ({
      run,
      queued,
      start,
      moveToBackground,
      dismissFailure,
      isVaultPipelineBusy,
      getVaultPipelineListStatus,
      openingVaultIds,
      closingVaultIds,
      isRunning,
      isRunningNow,
    }),
    [
      closingVaultIds,
      dismissFailure,
      getVaultPipelineListStatus,
      isRunning,
      isRunningNow,
      isVaultPipelineBusy,
      moveToBackground,
      openingVaultIds,
      queued,
      run,
      start,
    ],
  );
}
