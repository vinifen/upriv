/**
 * Client-only lifecycle pipeline errors (orchestration in the UI layer).
 * For Rust/daemon errors use `vault/errors/`.
 */
export const VAULT_PIPELINE_ERROR_CODES = {
  INSUFFICIENT_RAM: "insufficient_ram",
  ARCHIVE_TEST_FAILED: "archive_test_failed",
} as const;

export type VaultPipelineErrorCode =
  (typeof VAULT_PIPELINE_ERROR_CODES)[keyof typeof VAULT_PIPELINE_ERROR_CODES];

export class VaultPipelineError extends Error {
  readonly code: VaultPipelineErrorCode;

  constructor(code: VaultPipelineErrorCode) {
    super(`Vault pipeline: ${code}`);
    this.name = "VaultPipelineError";
    this.code = code;
  }
}

export function isVaultPipelineError(error: unknown): error is VaultPipelineError {
  return error instanceof VaultPipelineError;
}
