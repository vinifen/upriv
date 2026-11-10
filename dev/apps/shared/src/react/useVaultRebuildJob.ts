import { useCallback, useRef } from "react";
import type { VaultRebuildResult } from "../domain";
import type { JobService, VaultSecurityService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** The vault a rebuild runs for. */
export interface VaultRebuildTarget {
  vaultId: string;
}

/** The rebuild of a lost index in flight. Its row shows `recovering`. */
export type VaultRebuildJob = CoreJob<VaultRebuildTarget>;

export interface VaultRebuildJobEvents {
  /**
   * The tree is sealed. `password` is the one the rebuild ran with, to open
   * the vault; null when this list did not start it.
   */
  onRebuilt: (
    result: VaultRebuildResult,
    target: VaultRebuildTarget,
    password: string | null,
  ) => void;
  onFailed: (error: unknown, target: VaultRebuildTarget) => void;
  /** Stopped before the new index was written: the vault is as it was. */
  onCancelled: (target: VaultRebuildTarget) => void;
  /** Core refused the stop: the new index is being written. */
  onStopRefused: (error: unknown, target: VaultRebuildTarget) => void;
}

/**
 * The rebuild of a closed vault whose index is lost, from what names its
 * blobs. The unlock window starts it with the password just typed; the vault
 * list owns it, so it keeps running once that window closes. One at a time.
 * The password stays in RAM only until the rebuild ends, so `onRebuilt` can
 * open the vault with it; nothing here writes it anywhere.
 */
export function useVaultRebuildJob(
  security: VaultSecurityService,
  jobs: JobService,
  events: VaultRebuildJobEvents,
) {
  const passwordRef = useRef<string | null>(null);
  const takePassword = () => {
    const password = passwordRef.current;
    passwordRef.current = null;
    return password;
  };
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<VaultRebuildTarget, VaultRebuildResult>(jobs, {
    onDone: (result, target) => events.onRebuilt(result, target, takePassword()),
    onFailed: (error, target) => {
      takePassword();
      events.onFailed(error, target);
    },
    onCancelled: (target) => {
      takePassword();
      events.onCancelled(target);
    },
    onStopRefused: (error, target) => events.onStopRefused(error, target),
  });

  /** False while another rebuild runs. */
  const rebuild = useCallback(
    (vaultId: string, password: string): boolean => {
      const started = startJob({ vaultId }, (id) =>
        security.rebuildIndex(vaultId, { password, job: id }),
      );
      if (started) passwordRef.current = password;
      return started;
    },
    [security, startJob],
  );

  return { job, rebuild, stop };
}
