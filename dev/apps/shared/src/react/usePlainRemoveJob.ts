import { useCallback } from "react";
import type { PlainWipe } from "../domain";
import type { JobService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** One Remove the folder in flight. */
export type PlainRemoveJob = CoreJob<{ vaultId: string }>;

export interface PlainRemoveJobEvents {
  /** The wipe ended. `wipe.kept` files could not be wiped: the vault stays in recovery. */
  onRemoved: (vaultId: string, wipe: PlainWipe) => void;
  onFailed: (error: unknown) => void;
  /** The wipe was stopped: what it reached is gone, the rest stays, the vault stays in recovery. */
  onCancelled: (vaultId: string) => void;
  onStopRefused: (vaultId: string, error: unknown) => void;
}

/**
 * Recovery's Remove the folder, owned by the vault list so the recovery window
 * closes at once and the rest of the app stays usable. One at a time. While
 * `job` is set the list shows that vault as `recovering` and refuses to open
 * it.
 */
export function usePlainRemoveJob(
  remove: (vaultId: string, jobId: string) => Promise<PlainWipe>,
  jobs: JobService,
  events: PlainRemoveJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<{ vaultId: string }, PlainWipe>(jobs, {
    onDone: (wipe, { vaultId }) => events.onRemoved(vaultId, wipe),
    onFailed: (error) => events.onFailed(error),
    onCancelled: ({ vaultId }) => events.onCancelled(vaultId),
    onStopRefused: (error, { vaultId }) => events.onStopRefused(vaultId, error),
  });

  /** Wipe the leftover folder of `vaultId`. False while another wipe runs. */
  const start = useCallback(
    (vaultId: string): boolean => startJob({ vaultId }, (id) => remove(vaultId, id)),
    [remove, startJob],
  );

  return { job, start, stop };
}
