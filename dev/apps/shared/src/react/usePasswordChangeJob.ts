import { useCallback, useEffect, useMemo, useState } from "react";
import type { JobProgress, PasswordChangeFinishResult, PasswordChangeResult } from "../domain";
import type { ChangeVaultPasswordInput, JobService, VaultSecurityService } from "../services";
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

/**
 * The zip Back up first writes before the change, as the row and the Backups
 * window show it.
 */
export interface PasswordChangeBackupStep {
  vaultId: string;
  /** When the change was first seen writing it. */
  startedAt: number;
  progress: JobProgress;
  /**
   * When a stop was asked: the Backups window's, which ends only the backup,
   * or the whole change's. `null` until then.
   */
  stoppingSince: number | null;
}

/** When `at` happened in the job `id`. */
interface JobMoment {
  id: string;
  at: number;
}

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
 * passwords travel in the call only; nothing here keeps them. `stop` ends
 * the change; `skipBackup` ends only its Back up first zip, and the change
 * goes on without it.
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
    (vaultId: string, input: Omit<ChangeVaultPasswordInput, "job">) =>
      startJob({ vaultId, kind: "change" }, (id) =>
        security.changePassword(vaultId, { ...input, job: id }),
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

  const backingUp =
    job !== null && job.kind === "change" && job.progress?.step === "backing_up" ? job : null;
  const [backupSince, setBackupSince] = useState<JobMoment | null>(null);
  const [skipAsked, setSkipAsked] = useState<JobMoment | null>(null);
  const backingUpId = backingUp?.id ?? null;
  useEffect(() => {
    if (backingUpId === null) return;
    setBackupSince((seen) =>
      seen?.id === backingUpId ? seen : { id: backingUpId, at: Date.now() },
    );
  }, [backingUpId]);

  const backupStep = useMemo<PasswordChangeBackupStep | null>(() => {
    if (!backingUp?.progress || backupSince?.id !== backingUp.id) return null;
    const skipping = skipAsked?.id === backingUp.id ? skipAsked.at : null;
    return {
      vaultId: backingUp.vaultId,
      startedAt: backupSince.at,
      progress: backingUp.progress,
      stoppingSince: skipping ?? backingUp.stoppingSince,
    };
  }, [backingUp, backupSince, skipAsked]);

  /** Stop the backup the change writes now; the change goes on without it. */
  const skipBackup = useCallback(() => {
    if (!backingUp || backingUp.stoppingSince !== null || skipAsked?.id === backingUp.id) return;
    const id = backingUp.id;
    setSkipAsked({ id, at: Date.now() });
    const keepGoing = () => setSkipAsked((asked) => (asked?.id === id ? null : asked));
    void jobs.skipBackup(id).then((stopping) => {
      if (!stopping) keepGoing();
    }, keepGoing);
  }, [backingUp, jobs, skipAsked]);

  return { job, changePassword, finish, stop, backupStep, skipBackup };
}
