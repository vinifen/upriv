import type { VaultPipelineError, VaultPipelineErrorCode } from "../../domain/vault-lifecycle";

/** v1 product rule: global FIFO queue — one open/close/seal pipeline at a time (SDD §8.2.2). */
export type VaultPipelineKind = "open" | "close" | "seal";

/** Vault session password and open/close/seal pipelines (mock or Tauri → upriv-core). */
export interface VaultLifecycleService {
  hasPasswordInSession(vaultId: string): boolean;
  getPasswordInSession(vaultId: string): string | null;
  setPasswordInSession(vaultId: string, password: string): void;
  clearPasswordInSession(vaultId: string): void;

  readonly openingStepCount: number;
  readonly closingStepCount: number;

  runOpeningPipeline(vaultId: string, onStep: (stepIndex: number) => void): Promise<void>;
  /**
   * Close and seal share the same pipeline steps; UI intent selects the outcome.
   * `seal` true wipes the encrypted_dir store cache (state `sealed`); false keeps it (`closed`).
   */
  runClosingPipeline(
    vaultId: string,
    onStep: (stepIndex: number) => void,
    seal?: boolean,
  ): Promise<void>;

  /** Virtual mount path shown until the platform opens the OS file manager. */
  resolveWorkspacePath(displayName: string): string;

  /** Whether `auth/.session.enc` exists for disk security modes. */
  hasDiskSession(vaultId: string): Promise<boolean>;

  isPipelineError(error: unknown): error is VaultPipelineError;
  pipelineErrorCode(error: VaultPipelineError): VaultPipelineErrorCode;
}
