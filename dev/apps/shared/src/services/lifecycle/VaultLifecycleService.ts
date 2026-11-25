import { parseSwitches, type AttachAnswer, type FolderSwitch } from "../../domain/folder-lists";
import type { JobProgress } from "../../domain/jobs";
import { parsePlainCloseSummary, type PlainCloseSummary } from "../../domain/vault-plain";
import type {
  VaultOpened,
  VaultPipelineError,
  VaultPipelineErrorCode,
  VaultPipelineKind,
} from "../../domain/vault-lifecycle";

export type { VaultPipelineKind };

/** `now` is Close now: no backup, no closing pass, and no overwrite of a plaintext folder. */
export type VaultCloseReason = "user" | "auto" | "now";

/** Outcome of `vault_close`. Close still succeeds if the optional close-backup copy fails. */
export type BackupFailureReason = "disk_full" | "permission" | "other";

/**
 * Why a close backed up files that did not change since this device's last
 * backup, or its first open of the vault: the store was rewritten (a password
 * change, an unlock-RAM change, a rebuild), the last zip is in another folder
 * than the one in use, it is no longer in its folder, or this device has
 * written none yet.
 */
export type CloseBackupReason = "rewritten" | "moved" | "missing" | "first";

export interface CloseVaultOutcome {
  backupFailed: boolean;
  /** Why the close backup was not written. Null when it succeeded or was skipped. */
  backupFailure: BackupFailureReason | null;
  /** The backup folder selections this close's backup switched because a folder failed. */
  backupSwitches: FolderSwitch[];
  /** Why unchanged files got a zip; null for changed files, or no zip. */
  backupReason: CloseBackupReason | null;
  /** The folder the close's zip went to; null when it wrote none. */
  backupFolder: string | null;
  plain: PlainCloseSummary | null;
}

export const BACKUP_CLOSE_TOAST_MS = 12000;

function parseBackupFailure(value: unknown): BackupFailureReason | null {
  if (value === "disk_full" || value === "permission" || value === "other") return value;
  return null;
}

function parseCloseBackupReason(value: unknown): CloseBackupReason | null {
  if (value === "rewritten" || value === "moved" || value === "missing" || value === "first") {
    return value;
  }
  return null;
}

/** `vault_close`'s answer. Anything unexpected reads as a close with nothing to report. */
export function parseCloseVaultOutcome(raw: unknown): CloseVaultOutcome {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as {
    backupFailed?: unknown;
    backupFailure?: unknown;
    backupSwitches?: unknown;
    backupReason?: unknown;
    backupFolder?: unknown;
    plain?: unknown;
  };
  const backupFailed = body.backupFailed === true;
  return {
    backupFailed,
    backupFailure: backupFailed ? (parseBackupFailure(body.backupFailure) ?? "other") : null,
    backupSwitches: parseSwitches(body.backupSwitches),
    backupReason: parseCloseBackupReason(body.backupReason),
    backupFolder: typeof body.backupFolder === "string" ? body.backupFolder : null,
    plain: parsePlainCloseSummary(body.plain),
  };
}

/** The toast that says why a close backed up files that did not change. */
export function closeBackupReasonToastKey(
  reason: CloseBackupReason,
):
  | "toast.backup_on_close.rewritten"
  | "toast.backup_on_close.moved"
  | "toast.backup_on_close.missing"
  | "toast.backup_on_close.first" {
  return `toast.backup_on_close.${reason}`;
}

export function backupCloseFailureToastKey(
  reason: BackupFailureReason | null,
):
  | "toast.backup_on_close_failed.disk_full"
  | "toast.backup_on_close_failed.permission"
  | "toast.backup_on_close_failed" {
  if (reason === "disk_full") return "toast.backup_on_close_failed.disk_full";
  if (reason === "permission") return "toast.backup_on_close_failed.permission";
  return "toast.backup_on_close_failed";
}

/** Vault session password and open/close pipelines (mock or desktop → upriv-core). */
export interface VaultLifecycleService {
  hasPasswordInSession(vaultId: string): boolean;
  setPasswordInSession(vaultId: string, password: string): void;
  clearPasswordInSession(vaultId: string): void;

  readonly openingStepCount: number;
  readonly closingStepCount: number;

  /**
   * Unlock as the job `job`. A stop rejects with `job_cancelled` and leaves the
   * vault closed (a plaintext folder already being filled is wiped). Resolves
   * with the unlocked folder selections a plain-text open switched, and
   * whether the open reset the vault's storage value.
   */
  runOpeningPipeline(
    vaultId: string,
    onStep: (stepIndex: number) => void,
    job: string,
  ): Promise<VaultOpened>;
  /**
   * A close has no time limit; Close now (`hurryClose`) is its stop. `onStep`
   * also carries how far its backup's zip got, at each read while it runs.
   */
  runClosingPipeline(
    vaultId: string,
    onStep: (stepIndex: number, progress?: JobProgress | null) => void,
    reason?: VaultCloseReason,
  ): Promise<CloseVaultOutcome>;
  /** Tell the close running for this vault to finish the Close now way. False when none runs. */
  hurryClose(vaultId: string): Promise<boolean>;

  /**
   * Mount an open encrypted vault's unlocked folder, as the job `job`, walking
   * its chain. Called after every encrypted open on desktop, outside the
   * open/close queue; core alone decides whether a folder is wanted. A close
   * stops it. Phones mount no unlocked folder and leave it out.
   */
  attachUnlockedFolder?(vaultId: string, job: string): Promise<AttachAnswer>;

  /** Forget a plain-text folder on record. Its files stay as they are. */
  forgetPlainRecord(vaultId: string, token: string): Promise<void>;

  /** Pre-flight password check before starting a lifecycle pipeline (mock or RPC-backed). */
  validateLifecyclePassword(password: string): boolean;

  isPipelineError(error: unknown): error is VaultPipelineError;
  pipelineErrorCode(error: VaultPipelineError): VaultPipelineErrorCode;
}
