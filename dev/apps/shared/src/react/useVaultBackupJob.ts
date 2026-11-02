import { useCallback } from "react";
import type { VaultBackupEntry } from "../domain";
import type { BackupService, JobService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** One Back up now in flight. */
export type VaultBackupJob = CoreJob<{ vaultId: string }>;

export interface VaultBackupJobEvents {
  onSaved: (vaultId: string, entry: VaultBackupEntry) => void;
  onFailed: (vaultId: string, error: unknown) => void;
  /**
   * The budget or the call's own timeout ran out. Core is told to stop, and a
   * later result is ignored.
   */
  onTimedOut: (vaultId: string) => void;
}

/**
 * Back up now, owned by the vault list so it keeps running when the Backups
 * modal closes. One vault at a time, like export. While `job` is set the list
 * shows that vault as `backing_up` and refuses to open it. Its budget grows
 * with the size of `store/` (`sizedBudgetMs("vaultBackupSave")`).
 */
export function useVaultBackupJob(
  backupService: BackupService,
  jobs: JobService,
  events: VaultBackupJobEvents,
) {
  const { job, start: startJob } = useCoreJob<{ vaultId: string }, VaultBackupEntry>(
    jobs,
    "vaultBackupSave",
    {
      onDone: (entry, { vaultId }) => events.onSaved(vaultId, entry),
      onFailed: (error, { vaultId }) => events.onFailed(vaultId, error),
      // Nobody stops a save by hand: a stop comes from quitting, or from its
      // own timeout, which `onTimedOut` already reported.
      onCancelled: () => undefined,
      onTimedOut: ({ vaultId }) => events.onTimedOut(vaultId),
    },
  );

  /** Start a backup of `vaultId`. False while another backup is running. */
  const start = useCallback(
    (vaultId: string): boolean => startJob({ vaultId }, (id) => backupService.saveNow(vaultId, id)),
    [backupService, startJob],
  );

  return { job, start };
}
