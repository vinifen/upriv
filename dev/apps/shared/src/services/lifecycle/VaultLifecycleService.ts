import type {
  VaultPipelineError,
  VaultPipelineErrorCode,
  VaultPipelineKind,
} from "../../domain/vault-lifecycle";

export type { VaultPipelineKind };

/** Outcome of `vault_close`. Close still succeeds if the optional close-backup copy fails. */
export interface CloseVaultOutcome {
  backupFailed: boolean;
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
  ): Promise<CloseVaultOutcome>;

  /** Virtual mount path shown until the platform opens the OS file manager. */
  resolveWorkspacePath(
    displayName: string,
    options?: {
      globalWorkspacePath?: string | null;
      mountWorkspacePath?: string | null;
    },
  ): string;

  /** Pre-flight password check before starting a lifecycle pipeline (mock or RPC-backed). */
  validateLifecyclePassword(password: string): boolean;

  isPipelineError(error: unknown): error is VaultPipelineError;
  pipelineErrorCode(error: VaultPipelineError): VaultPipelineErrorCode;
}
