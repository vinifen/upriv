import type { AttachAnswer, FolderSwitch } from "../../domain/folder-lists";
import type { PlainCloseSummary } from "../../domain/vault-plain";
import type {
  VaultPipelineError,
  VaultPipelineErrorCode,
  VaultPipelineKind,
} from "../../domain/vault-lifecycle";

export type { VaultPipelineKind };

/** `now` is Close now: no backup, no closing pass, and no overwrite of a plaintext folder. */
export type VaultCloseReason = "user" | "auto" | "now";

/** Outcome of `vault_close`. Close still succeeds if the optional close-backup copy fails. */
export type BackupFailureReason = "disk_full" | "permission" | "other";

export interface CloseVaultOutcome {
  backupFailed: boolean;
  /** Why the close backup was not written. Null when it succeeded or was skipped. */
  backupFailure: BackupFailureReason | null;
  /** The backup folder selections this close's backup switched because a folder failed. */
  backupSwitches: FolderSwitch[];
  plain: PlainCloseSummary | null;
}

export const BACKUP_CLOSE_TOAST_MS = 12000;

export function parseBackupFailure(value: unknown): BackupFailureReason | null {
  if (value === "disk_full" || value === "permission" || value === "other") return value;
  return null;
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
   * with the unlocked folder selections a plain-text open switched.
   */
  runOpeningPipeline(
    vaultId: string,
    onStep: (stepIndex: number) => void,
    job: string,
  ): Promise<FolderSwitch[]>;
  /** A close has no time limit; Close now (`hurryClose`) is its stop. */
  runClosingPipeline(
    vaultId: string,
    onStep: (stepIndex: number) => void,
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
