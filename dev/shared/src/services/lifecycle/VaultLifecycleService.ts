import type { VaultPipelineError, VaultPipelineErrorCode } from "../../domain/vault-lifecycle";

/** v1 product rule: global FIFO queue — one open/close/seal pipeline at a time (SDD §8.2.2). */
export type VaultPipelineKind = "open" | "close" | "seal";

/** Vault session password and open/close/seal pipelines (mock or Tauri → upriv-core). */
export interface VaultLifecycleService {
  hasPasswordInSession(vaultId: string): boolean;
  setPasswordInSession(vaultId: string, password: string): void;
  clearPasswordInSession(vaultId: string): void;

  /** One-time demo seed for mock rows that start open (does not overwrite unlock passwords). */
  seedInitialOpenVaultPasswords(openVaultIds: readonly string[]): void;

  /** Validate unlock/close password input until real crypto is wired. */
  validatePassword(password: string): boolean;

  readonly openingStepCount: number;
  readonly closingStepCount: number;

  runOpeningPipeline(vaultId: string, onStep: (stepIndex: number) => void): Promise<void>;
  runClosingPipeline(vaultId: string, onStep: (stepIndex: number) => void): Promise<void>;

  /** Virtual mount path shown until the platform opens the OS file manager. */
  resolveWorkspacePath(displayName: string): string;

  isPipelineError(error: unknown): error is VaultPipelineError;
  pipelineErrorCode(error: VaultPipelineError): VaultPipelineErrorCode;
}
