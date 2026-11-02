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
  /**
   * The budget or the call's own timeout ran out. Core is told to stop, what
   * it did not reach stays, and the vault stays in recovery.
   */
  onTimedOut: () => void;
}

/**
 * Recovery's Remove the folder, owned by the vault list so the recovery window
 * closes at once and the rest of the app stays usable. One at a time. While
 * `job` is set the list shows that vault as `recovering` and refuses to open
 * it. Its budget grows with the bytes of the folder
 * (`sizedBudgetMs("plainLeftoverRemove")`).
 */
export function usePlainRemoveJob(
  remove: (vaultId: string, jobId: string) => Promise<PlainWipe>,
  jobs: JobService,
  events: PlainRemoveJobEvents,
) {
  const { job, start: startJob } = useCoreJob<{ vaultId: string }, PlainWipe>(
    jobs,
    "plainLeftoverRemove",
    {
      onDone: (wipe, { vaultId }) => events.onRemoved(vaultId, wipe),
      onFailed: (error) => events.onFailed(error),
      // Nobody stops a wipe by hand: a stop comes from quitting, or from its
      // own timeout, which `onTimedOut` already reported.
      onCancelled: () => undefined,
      onTimedOut: () => events.onTimedOut(),
    },
  );

  /** Wipe the leftover folder of `vaultId`. False while another wipe runs. */
  const start = useCallback(
    (vaultId: string): boolean => startJob({ vaultId }, (id) => remove(vaultId, id)),
    [remove, startJob],
  );

  return { job, start };
}
