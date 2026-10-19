import { useCallback, useEffect, useRef, useState } from "react";
import { LOADING_BUDGET_MS, type VaultBackupEntry } from "../domain";
import type { BackupService } from "../services";
import { useLoadingBudget } from "./useLoadingBudget";

/** One Back up now in flight. */
export interface VaultBackupJob {
  vaultId: string;
  startedAt: number;
}

export interface VaultBackupJobEvents {
  onSaved: (vaultId: string, entry: VaultBackupEntry) => void;
  onFailed: (vaultId: string, error: unknown) => void;
  /** The budget ran out. A result that arrives later is ignored. */
  onTimedOut: (vaultId: string) => void;
}

/**
 * Back up now, owned by the vault list so it keeps running when the Backups
 * modal closes. One vault at a time, like export. While `job` is set the list
 * shows that vault as `backing_up` and refuses to open it.
 */
export function useVaultBackupJob(backupService: BackupService, events: VaultBackupJobEvents) {
  const [job, setJob] = useState<VaultBackupJob | null>(null);
  const jobRef = useRef(job);
  const genRef = useRef(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const budget = useLoadingBudget(job !== null, LOADING_BUDGET_MS.vaultBackupSave, {
    startedAt: job?.startedAt,
  });

  const finish = useCallback(() => {
    jobRef.current = null;
    setJob(null);
  }, []);

  /** Start a backup of `vaultId`. False while another backup is running. */
  const start = useCallback(
    (vaultId: string): boolean => {
      if (jobRef.current) return false;
      const gen = ++genRef.current;
      const next = { vaultId, startedAt: Date.now() };
      jobRef.current = next;
      setJob(next);
      void backupService
        .saveNow(vaultId)
        .then(
          (entry) => {
            if (gen === genRef.current) eventsRef.current.onSaved(vaultId, entry);
          },
          (error: unknown) => {
            if (gen === genRef.current) eventsRef.current.onFailed(vaultId, error);
          },
        )
        .finally(() => {
          if (gen === genRef.current) finish();
        });
      return true;
    },
    [backupService, finish],
  );

  useEffect(() => {
    if (!budget.timedOut || !job) return;
    genRef.current += 1;
    finish();
    eventsRef.current.onTimedOut(job.vaultId);
  }, [budget.timedOut, finish, job]);

  return { job, start };
}
