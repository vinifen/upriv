import { useCallback } from "react";
import type { StorageChangeResult, VaultStorage } from "../domain";
import type { JobService, VaultSecurityService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** What a Storage change was started for. */
export interface StorageChangeTarget {
  vaultId: string;
  /** The value the change seals. */
  storage: VaultStorage;
}

/** The Storage change in flight. */
export type StorageChangeJob = CoreJob<StorageChangeTarget>;

/** How a Storage change ended, as the list hands it to the settings window. */
export interface StorageChangeOutcome extends StorageChangeTarget {
  /** Grows with each outcome, so the same result twice still applies. */
  seq: number;
  /** What the change stored; `null` when it failed or was stopped. */
  result: StorageChangeResult | null;
  /** `null` when it was made. */
  error: unknown;
  /** Stopped before the index was written: the vault is as it was. */
  stopped: boolean;
}

export interface StorageChangeJobEvents {
  onChanged: (result: StorageChangeResult, target: StorageChangeTarget) => void;
  /** Includes a wrong password, which the settings window marks on its field. */
  onFailed: (error: unknown, target: StorageChangeTarget) => void;
  /** Stopped before the index was written: the vault is as it was. */
  onCancelled: (target: StorageChangeTarget) => void;
  /** Core refused the stop: the index and the copy are being written. */
  onStopRefused: (error: unknown, target: StorageChangeTarget) => void;
}

/**
 * The Storage change of a closed vault: the password unlocks it, then its
 * storage value is sealed in the index and copied to `config.toml`. Owned by
 * the vault list so it keeps running when the settings window closes. One at
 * a time.
 */
export function useStorageChangeJob(
  security: VaultSecurityService,
  jobs: JobService,
  events: StorageChangeJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<StorageChangeTarget, StorageChangeResult>(jobs, {
    onDone: (result, target) => events.onChanged(result, target),
    onFailed: (error, target) => events.onFailed(error, target),
    onCancelled: (target) => events.onCancelled(target),
    onStopRefused: (error, target) => events.onStopRefused(error, target),
  });

  /** False while another change runs. */
  const changeStorage = useCallback(
    (vaultId: string, password: string, storage: VaultStorage) =>
      startJob({ vaultId, storage }, (id) =>
        security.changeStorage(vaultId, { password, storage, job: id }),
      ),
    [security, startJob],
  );

  return { job, changeStorage, stop };
}
