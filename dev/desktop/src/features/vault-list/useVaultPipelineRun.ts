import { useCallback, useRef, useState } from "react";
import type { I18nKey } from "@/i18n/types";
import { isMockPipelineError } from "./mockVaultPipelineErrors";

/** v1 product rule: global FIFO queue — one open/close/seal pipeline at a time (SDD §8.2.2). */
export type VaultPipelineKind = "open" | "close" | "seal";

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

export function useVaultPipelineRun() {
  const [run, setRun] = useState<VaultPipelineRunState | null>(null);
  const runRef = useRef<VaultPipelineRunState | null>(null);
  const generationRef = useRef(0);

  const syncRun = useCallback((next: VaultPipelineRunState | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const start = useCallback(
    ({
      vaultId,
      kind,
      stepCount,
      runPipeline,
      onComplete,
      onError,
    }: StartPipelineOptions): boolean => {
      if (runRef.current !== null) return false;

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

          const errorKey = isMockPipelineError(error) ? error.i18nKey : "error.archive_test_failed";

          syncRun({ ...current, foreground: true, errorKey });
          onError(errorKey);
        }
      })();

      return true;
    },
    [syncRun],
  );

  const dismissFailure = useCallback(() => {
    syncRun(null);
  }, [syncRun]);

  const moveToBackground = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    syncRun({ ...current, foreground: false });
  }, [syncRun]);

  const isVaultPipelineBusy = useCallback(
    (vaultId: string) => runRef.current?.vaultId === vaultId,
    [],
  );

  const isRunning = run !== null;

  return {
    run,
    start,
    moveToBackground,
    dismissFailure,
    isVaultPipelineBusy,
    isRunning,
  };
}
