import { useCallback } from "react";
import type { KdfUnlockPreset, UnlockRamChangeResult } from "../domain";
import type { JobService, VaultSecurityService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** What an unlock-RAM change was started for. */
export interface UnlockRamChangeTarget {
  vaultId: string;
  /** The preset the change moves to. */
  nextPreset: KdfUnlockPreset;
}

/** The unlock-RAM change in flight. */
export type UnlockRamChangeJob = CoreJob<UnlockRamChangeTarget>;

/** How an unlock-RAM change ended, as the list hands it to the settings window. */
export interface UnlockRamChangeOutcome extends UnlockRamChangeTarget {
  /** Grows with each outcome, so the same result twice still applies. */
  seq: number;
  /** What the change did; `null` when it failed or was stopped. */
  result: UnlockRamChangeResult | null;
  /** `null` when it was made. */
  error: unknown;
  /** Stopped before the change was made: the unlock RAM is as it was. */
  stopped: boolean;
}

export interface UnlockRamChangeJobEvents {
  onChanged: (result: UnlockRamChangeResult, target: UnlockRamChangeTarget) => void;
  /** Includes a wrong password, which the settings window marks on its field. */
  onFailed: (error: unknown, target: UnlockRamChangeTarget) => void;
  /** Stopped before the new header was written: the vault is as it was. */
  onCancelled: (target: UnlockRamChangeTarget) => void;
  /** Core refused the stop: the new header is being written. */
  onStopRefused: (error: unknown, target: UnlockRamChangeTarget) => void;
}

/**
 * The unlock-RAM change of a closed vault: a new cost for the same password
 * and keys, then the pass over every file's key copy. Owned by the vault
 * list so it keeps running when the settings window closes. One at a time.
 */
export function useUnlockRamChangeJob(
  security: VaultSecurityService,
  jobs: JobService,
  events: UnlockRamChangeJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<UnlockRamChangeTarget, UnlockRamChangeResult>(jobs, {
    onDone: (result, target) => events.onChanged(result, target),
    onFailed: (error, target) => events.onFailed(error, target),
    onCancelled: (target) => events.onCancelled(target),
    onStopRefused: (error, target) => events.onStopRefused(error, target),
  });

  /** False while another change runs. */
  const changeKdf = useCallback(
    (vaultId: string, currentPassword: string, nextPreset: KdfUnlockPreset) =>
      startJob({ vaultId, nextPreset }, (id) =>
        security.changeKdfPreset(vaultId, { currentPassword, nextPreset, job: id }),
      ),
    [security, startJob],
  );

  return { job, changeKdf, stop };
}
