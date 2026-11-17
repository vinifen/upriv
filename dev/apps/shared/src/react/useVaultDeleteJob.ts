import { useCallback } from "react";
import type { VaultDeleteOutcome } from "../domain";
import type { JobService, VaultService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** The vault a delete runs for. */
export interface VaultDeleteTarget {
  vaultId: string;
  /** Its name when the delete began, for the toast once the folder is gone. */
  displayName: string;
}

/** The delete in flight. */
export type VaultDeleteJob = CoreJob<VaultDeleteTarget>;

export interface VaultDeleteJobEvents {
  onDeleted: (outcome: VaultDeleteOutcome, target: VaultDeleteTarget) => void;
  onFailed: (error: unknown, target: VaultDeleteTarget) => void;
  /** A quit stopped it where it was: the row stays `deleting`, with Continue. */
  onCancelled: (target: VaultDeleteTarget) => void;
}

/**
 * The delete of a vault, owned by the vault list so it keeps running when
 * the window that started it closes. One at a time. It has no Stop: Delete
 * now ends it early, removing the files it has not reached with no
 * overwrite (`hurry`). A delete the app did not finish goes on through the
 * same call (Continue), or with `now` (Delete now).
 */
export function useVaultDeleteJob(
  vaultService: VaultService,
  jobs: JobService,
  events: VaultDeleteJobEvents,
) {
  const { job, start: startJob } = useCoreJob<VaultDeleteTarget, VaultDeleteOutcome>(jobs, {
    onDone: (outcome, target) => events.onDeleted(outcome, target),
    onFailed: (error, target) => events.onFailed(error, target),
    onCancelled: (target) => events.onCancelled(target),
    onStopRefused: () => {},
  });

  /** False while another delete runs. */
  const deleteVault = useCallback(
    (target: VaultDeleteTarget, outsideBackups: boolean, now: boolean) =>
      startJob(target, (id) =>
        vaultService.deleteVault(target.vaultId, { outsideBackups, now, job: id }),
      ),
    [startJob, vaultService],
  );

  /** Delete now for the delete running on `vaultId`. False when none runs. */
  const hurry = useCallback((vaultId: string) => vaultService.hurryDelete(vaultId), [vaultService]);

  return { job, deleteVault, hurry };
}
