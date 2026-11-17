import { useCallback } from "react";
import type { PasswordChangeFinishResult, PasswordChangeResult } from "../domain";
import type { JobService, VaultSecurityService } from "../services";
import { useCoreJob, type CoreJob } from "./useCoreJob";

/**
 * What a password change job was started for: the change itself, or Finish
 * of one a crash left unfinished.
 */
export interface PasswordChangeTarget {
  vaultId: string;
  kind: "change" | "finish";
}

/** The password change, or its Finish, in flight. */
export type PasswordChangeJob = CoreJob<PasswordChangeTarget>;

/** How a password change or Finish ended, as the list hands it to the settings window. */
export interface PasswordChangeOutcome extends PasswordChangeTarget {
  /** Grows with each outcome, so the same result twice still applies. */
  seq: number;
  /** What the change or Finish did; `null` when it failed or was stopped. */
  result: PasswordChangeResult | PasswordChangeFinishResult | null;
  /** `null` when it was made. */
  error: unknown;
  /** Stopped: the password stays the current one. */
  stopped: boolean;
}

export interface PasswordChangeJobEvents {
  onChanged: (result: PasswordChangeResult, target: PasswordChangeTarget) => void;
  onFinished: (result: PasswordChangeFinishResult, target: PasswordChangeTarget) => void;
  /** Includes a wrong current password, which the settings window marks on its field. */
  onFailed: (error: unknown, target: PasswordChangeTarget) => void;
  /** Stopped: the password stays the current one. */
  onCancelled: (target: PasswordChangeTarget) => void;
  /** Core refused the stop: the new header is being written. */
  onStopRefused: (error: unknown, target: PasswordChangeTarget) => void;
}

/**
 * The password change of a closed vault (a new key, every file rewritten),
 * and Finish of one a crash left unfinished. Owned by the vault list so it
 * keeps running when the settings window closes. One at a time. The
 * passwords travel in the call only; nothing here keeps them.
 */
export function usePasswordChangeJob(
  security: VaultSecurityService,
  jobs: JobService,
  events: PasswordChangeJobEvents,
) {
  const {
    job,
    start: startJob,
    stop,
  } = useCoreJob<PasswordChangeTarget, PasswordChangeResult | PasswordChangeFinishResult>(jobs, {
    onDone: (result, target) => {
      if (target.kind === "change") events.onChanged(result as PasswordChangeResult, target);
      else events.onFinished(result, target);
    },
    onFailed: (error, target) => events.onFailed(error, target),
    onCancelled: (target) => events.onCancelled(target),
    onStopRefused: (error, target) => events.onStopRefused(error, target),
  });

  /** False while another change runs. */
  const changePassword = useCallback(
    (vaultId: string, currentPassword: string, newPassword: string, backUpFirst: boolean) =>
      startJob({ vaultId, kind: "change" }, (id) =>
        security.changePassword(vaultId, { currentPassword, newPassword, backUpFirst, job: id }),
      ),
    [security, startJob],
  );

  /** False while another change runs. */
  const finish = useCallback(
    (vaultId: string, password: string) =>
      startJob({ vaultId, kind: "finish" }, (id) =>
        security.finishPasswordChange(vaultId, { password, job: id }),
      ),
    [security, startJob],
  );

  return { job, changePassword, finish, stop };
}
