import { useCallback } from "react";
import type { VaultBackupEntry } from "../domain";
import type { BackupService, JobService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** One Back up now in flight. */
export type VaultBackupJob = CoreJob<{ vaultId: string }>;

export interface VaultBackupJobEvents {
  onSaved: (vaultId: string, entry: VaultBackupEntry) => void;
  onFailed: (vaultId: string, error: unknown) => void;
  /** The save was stopped and left no zip. */
  onCancelled: (vaultId: string) => void;
  /** Core refused the stop: the zip is being put in place. */
  onStopRefused: (vaultId: string, error: unknown) => void;
}

/**
 * Back up now, owned by the vault list so it keeps running when the Backups
 * window closes. One vault at a time, like export. While `job` is set the list
 * shows that vault as `backing_up` and refuses to open it.
 */
export function useVaultBackupJob(
  backupService: BackupService,
  jobs: JobService,
  events: VaultBackupJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<{ vaultId: string }, VaultBackupEntry>(jobs, {
    onDone: (entry, { vaultId }) => events.onSaved(vaultId, entry),
    onFailed: (error, { vaultId }) => events.onFailed(vaultId, error),
    onCancelled: ({ vaultId }) => events.onCancelled(vaultId),
    onStopRefused: (error, { vaultId }) => events.onStopRefused(vaultId, error),
  });

  /** Start a backup of `vaultId`. False while another backup is running. */
  const start = useCallback(
    (vaultId: string): boolean => startJob({ vaultId }, (id) => backupService.saveNow(vaultId, id)),
    [backupService, startJob],
  );

  return { job, start, stop };
}
