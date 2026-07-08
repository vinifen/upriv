import { useCallback, useMemo, useRef, useState } from "react";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import type { VaultPipelineKind } from "@upriv/shared";
import type { I18nKey } from "@/i18n/types";

export type { VaultPipelineKind };

export interface VaultPipelineRunState {
  vaultId: string;
  kind: VaultPipelineKind;
  activeStep: number;
  stepCount: number;
  foreground: boolean;
  errorKey?: I18nKey;
}

export interface QueuedPipelineJob {
  vaultId: string;
  kind: VaultPipelineKind;
}

interface StartPipelineOptions {
  vaultId: string;
  kind: VaultPipelineKind;
  stepCount: number;
  runPipeline: (vaultId: string, onStep: (stepIndex: number) => void) => Promise<void>;
  onComplete: () => void;
  onError: (errorKey: I18nKey) => void;
}

interface PendingPipelineJob extends StartPipelineOptions {
  id: number;
}

function listStatusKind(kind: VaultPipelineKind): "opening" | "closing" {
  return kind === "open" ? "opening" : "closing";
}

export function useVaultPipelineRun() {
  const [run, setRun] = useState<VaultPipelineRunState | null>(null);
  const [queued, setQueued] = useState<QueuedPipelineJob[]>([]);
  const runRef = useRef<VaultPipelineRunState | null>(null);
  const queueRef = useRef<PendingPipelineJob[]>([]);
  const generationRef = useRef(0);
  const nextJobIdRef = useRef(1);

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
    (job: PendingPipelineJob) => {
      const { vaultId, kind, stepCount, runPipeline, onComplete, onError } = job;
      const generation = ++generationRef.current;

      syncRun({ vaultId, kind, activeStep: 0, stepCount, foreground: true });

      void (async () => {
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

          const errorKey = desktopErrorI18nKey(error);
          syncRun({ ...current, foreground: true, errorKey });
          onError(errorKey);
          return;
        }

        if (queueRef.current.length > 0) {
          const next = queueRef.current.shift()!;
          syncQueued();
          executeJob(next);
        }
      })();
    },
    [syncQueued, syncRun],
  );

  const start = useCallback(
    (options: StartPipelineOptions): boolean => {
      const alreadyTracked =
        runRef.current?.vaultId === options.vaultId ||
        queueRef.current.some((job) => job.vaultId === options.vaultId);
      if (alreadyTracked) return false;

      const job: PendingPipelineJob = {
        ...options,
        id: nextJobIdRef.current++,
      };

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
    if (!current) return;
    syncRun({ ...current, foreground: false });
  }, [syncRun]);

  const isVaultPipelineBusy = useCallback((vaultId: string) => {
    return (
      runRef.current?.vaultId === vaultId ||
      queueRef.current.some((job) => job.vaultId === vaultId)
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

  return {
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
  };
}
