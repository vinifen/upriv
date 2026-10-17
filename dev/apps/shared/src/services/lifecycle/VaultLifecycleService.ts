import type { PlainCloseSummary } from "../../domain/vault-plain";
import type {
  VaultPipelineError,
  VaultPipelineErrorCode,
  VaultPipelineKind,
} from "../../domain/vault-lifecycle";

export type { VaultPipelineKind };

/** Outcome of `vault_close`. Close still succeeds if the optional close-backup copy fails. */
export type BackupFailureReason = "disk_full" | "permission" | "other";

export interface CloseVaultOutcome {
  backupFailed: boolean;
  /** Why the close backup was not written. Null when it succeeded or was skipped. */
  backupFailure: BackupFailureReason | null;
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

  runOpeningPipeline(vaultId: string, onStep: (stepIndex: number) => void): Promise<void>;
  runClosingPipeline(
    vaultId: string,
    onStep: (stepIndex: number) => void,
    reason?: "user" | "auto",
  ): Promise<CloseVaultOutcome>;

  /** Virtual mount path shown until the platform opens the OS file manager. */
  resolveWorkspacePath(displayName: string, parentPath?: string | null): string;

  /** Pre-flight password check before starting a lifecycle pipeline (mock or RPC-backed). */
  validateLifecyclePassword(password: string): boolean;

  isPipelineError(error: unknown): error is VaultPipelineError;
  pipelineErrorCode(error: VaultPipelineError): VaultPipelineErrorCode;
}
