import { useCallback, useMemo, useRef, useState } from "react";
import type { VaultPipelineKind } from "@upriv/shared";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import type { I18nKey } from "@/i18n";

export interface VaultPipelineRunState {
  vaultId: string;
  kind: VaultPipelineKind;
  activeStep: number;
  stepCount: number;
  foreground: boolean;
  errorKey?: I18nKey;
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

export function useVaultPipelineRun() {
  const [run, setRun] = useState<VaultPipelineRunState | null>(null);
  const runRef = useRef<VaultPipelineRunState | null>(null);
  const queueRef = useRef<PendingPipelineJob[]>([]);
  const generationRef = useRef(0);
  const nextJobIdRef = useRef(1);

  const syncRun = useCallback((next: VaultPipelineRunState | null) => {
    runRef.current = next;
    setRun(next);
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
          const errorKey = mobileErrorI18nKey(error);
          syncRun({ ...current, foreground: true, errorKey });
          onError(errorKey);
          return;
        }

        if (queueRef.current.length > 0) {
          const next = queueRef.current.shift()!;
          executeJob(next);
        }
      })();
    },
    [syncRun],
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
      return true;
    },
    [executeJob],
  );

  const sendToBackground = useCallback(() => {
    const current = runRef.current;
    if (!current || current.errorKey) return;
    syncRun({ ...current, foreground: false });
  }, [syncRun]);

  const dismissFailure = useCallback(() => {
    syncRun(null);
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      executeJob(next);
    }
  }, [executeJob, syncRun]);

  const openingVaultIds = useMemo(() => {
    const ids = new Set<string>();
    if (run?.kind === "open") ids.add(run.vaultId);
    for (const job of queueRef.current) {
      if (job.kind === "open") ids.add(job.vaultId);
    }
    return ids;
  }, [run]);

  const closingVaultIds = useMemo(() => {
    const ids = new Set<string>();
    if (run && run.kind !== "open") ids.add(run.vaultId);
    for (const job of queueRef.current) {
      if (job.kind !== "open") ids.add(job.vaultId);
    }
    return ids;
  }, [run]);

  return {
    run,
    start,
    sendToBackground,
    dismissFailure,
    openingVaultIds,
    closingVaultIds,
  };
}
