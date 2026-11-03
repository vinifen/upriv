import { useCallback } from "react";
import type { KdfUnlockPreset, VaultRewrapKind } from "../domain";
import type { JobService, VaultSecurityService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/** What a password or unlock-RAM change was started for. */
export interface VaultRewrapTarget {
  vaultId: string;
  kind: VaultRewrapKind;
  /** The preset an unlock-RAM change moves to; `null` for a password change. */
  nextPreset: KdfUnlockPreset | null;
}

/** The password or unlock-RAM change in flight. */
export type VaultRewrapJob = CoreJob<VaultRewrapTarget>;

/** How a change ended, as the list hands it to the settings window. */
export interface VaultRewrapOutcome extends VaultRewrapTarget {
  /** Grows with each outcome, so the same result twice still applies. */
  seq: number;
  /** `null` when the change was made. */
  error: unknown;
}

export interface VaultRewrapJobEvents {
  onChanged: (target: VaultRewrapTarget) => void;
  /** Includes a wrong current password, which the settings window marks on its field. */
  onFailed: (error: unknown, target: VaultRewrapTarget) => void;
  /** Stopped before the new header was written: the vault and its password are as they were. */
  onCancelled: (target: VaultRewrapTarget) => void;
  /** Core refused the stop: the new header and index are being written. */
  onStopRefused: (error: unknown, target: VaultRewrapTarget) => void;
}

/**
 * Password and unlock-RAM change, owned by the vault list so they keep running
 * when the settings window closes. One at a time. The passwords travel in the
 * call only; nothing here keeps them.
 */
export function useVaultRewrapJob(
  security: VaultSecurityService,
  jobs: JobService,
  events: VaultRewrapJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<VaultRewrapTarget, void>(jobs, {
    onDone: (_result, target) => events.onChanged(target),
    onFailed: (error, target) => events.onFailed(error, target),
    onCancelled: (target) => events.onCancelled(target),
    onStopRefused: (error, target) => events.onStopRefused(error, target),
  });

  /** False while another change runs. */
  const changePassword = useCallback(
    (vaultId: string, currentPassword: string, newPassword: string): boolean =>
      startJob({ vaultId, kind: "password", nextPreset: null }, (id) =>
        security.changePassword(vaultId, { currentPassword, newPassword, job: id }),
      ),
    [security, startJob],
  );

  /** False while another change runs. */
  const changeKdf = useCallback(
    (vaultId: string, currentPassword: string, nextPreset: KdfUnlockPreset): boolean =>
      startJob({ vaultId, kind: "kdf", nextPreset }, (id) =>
        security.changeKdfPreset(vaultId, { currentPassword, nextPreset, job: id }),
      ),
    [security, startJob],
  );

  return { job, changePassword, changeKdf, stop };
}
