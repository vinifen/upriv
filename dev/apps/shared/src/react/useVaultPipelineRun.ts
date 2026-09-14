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
  /** When this job actually started — shared by modal + row budget hints. */
  startedAt: number;
  errorKey?: I18nKey;
}

export type VaultPipelinePresentation = "foreground" | "background";

export interface QueuedPipelineJob {
  vaultId: string;
  kind: VaultPipelineKind;
}

export type VaultPipelineFailureMode = "overlay" | "advance";

interface StartPipelineOptions {
  vaultId: string;
  kind: VaultPipelineKind;
  stepCount: number;
  /** Default `"foreground"` — modal/row owns the busy UI. `"background"` = job only (no modal budget). */
  presentation?: VaultPipelinePresentation;
  /** Default `vaultPipeline`. Create uses `vaultCreate`. */
  budgetMs?: number;
  /**
   * `overlay` (default): keep the failed run until `dismissFailure` (legacy name;
   * there is no full-screen pipeline overlay — modal/row/toast own the copy).
   * `advance`: toast/row owns the failure and the next queued job starts.
   */
  failureMode?: VaultPipelineFailureMode;
  runPipeline: (vaultId: string, onStep: (stepIndex: number) => void) => Promise<void>;
  onComplete: () => void;
  onError: (errorKey: I18nKey) => void;
  /** Budget elapsed; the job may still finish. Open handlers clear renderer password here. */
  onTimeout?: () => void;
}

function listStatusKind(kind: VaultPipelineKind): "opening" | "closing" | "creating" {
  if (kind === "open") return "opening";
  if (kind === "create") return "creating";
  return "closing";
}

export type VaultPipelineListKind = "opening" | "closing" | "creating" | "queued";

/**
 * Global FIFO open/close/create runner (one pipeline at a time).
 * `errorToI18nKey` is platform-owned (desktop bridge codes vs mobile SAF).
 */
export function useVaultPipelineRun(errorToI18nKey: (error: unknown) => I18nKey) {
  const [run, setRun] = useState<VaultPipelineRunState | null>(null);
  const [queued, setQueued] = useState<QueuedPipelineJob[]>([]);
  const runRef = useRef<VaultPipelineRunState | null>(null);
  const queueRef = useRef<StartPipelineOptions[]>([]);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);

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
      const { vaultId, kind, stepCount, runPipeline, onComplete, onError, onTimeout } = job;
      const foreground = job.presentation !== "background";
      const failureMode = job.failureMode ?? "overlay";
      const generation = ++generationRef.current;
      inFlightRef.current = true;

      syncRun({ vaultId, kind, activeStep: 0, stepCount, foreground, startedAt: Date.now() });

      void (async () => {
        const cancelBudget = scheduleTimeout(() => {
          if (generationRef.current !== generation) return;
          const current = runRef.current;
          if (!current || current.vaultId !== vaultId || current.errorKey) return;
          if (failureMode === "advance") {
            onTimeout?.();
            return;
          }
          syncRun({ ...current, foreground: true, errorKey: "loading.timed_out" });
          onTimeout?.();
        }, job.budgetMs ?? LOADING_BUDGET_MS.vaultPipeline);

        try {
          await runPipeline(vaultId, (stepIndex) => {
            if (generationRef.current !== generation) return;
            const current = runRef.current;
            if (current?.vaultId !== vaultId) return;
            syncRun({ ...current, activeStep: stepIndex });
          });

          if (generationRef.current !== generation) return;

          // Patch session (open / closed) before dropping pipeline IDs so the
          // row never flashes Closed while the vault is already open in core.
          onComplete();
          syncRun(null);
        } catch (error) {
          if (generationRef.current !== generation) return;

          const current = runRef.current;
          if (current?.vaultId !== vaultId) return;

          const errorKey = errorToI18nKey(error);
          if (failureMode === "advance") {
            syncRun(null);
            onError(errorKey);
          } else {
            syncRun({ ...current, foreground: true, errorKey });
            onError(errorKey);
            return;
          }
        } finally {
          cancelBudget();
          if (generationRef.current === generation) {
            inFlightRef.current = false;
          }
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

  const openingVaultIds = useMemo(() => {
    if (run?.kind === "open") return [run.vaultId];
    return [];
  }, [run]);

  const closingVaultIds = useMemo(() => {
    const ids: string[] = [];
    if (run?.kind === "close") ids.push(run.vaultId);
    for (const job of queued) {
      if (job.kind === "close") ids.push(job.vaultId);
    }
    return ids;
  }, [run, queued]);

  const creatingVaultIds = useMemo(() => {
    const ids: string[] = [];
    if (run?.kind === "create") ids.push(run.vaultId);
    for (const job of queued) {
      if (job.kind === "create") ids.push(job.vaultId);
    }
    return ids;
  }, [run, queued]);

  /** Waiting **open** jobs only — close/create waits keep `closing` / `creating` labels. */
  const queuedVaultIds = useMemo(
    () => queued.filter((job) => job.kind === "open").map((job) => job.vaultId),
    [queued],
  );

  const getVaultPipelineListStatus = useCallback(
    (vaultId: string): VaultPipelineListKind | null => {
      if (run?.vaultId === vaultId) return listStatusKind(run.kind);
      const queuedJob = queued.find((job) => job.vaultId === vaultId);
      if (!queuedJob) return null;
      if (queuedJob.kind === "open") return "queued";
      return listStatusKind(queuedJob.kind);
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
      creatingVaultIds,
      queuedVaultIds,
      isRunning,
      isRunningNow,
    }),
    [
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
      queuedVaultIds,
      run,
      start,
    ],
  );
}
