/** i18n keys surfaced by lifecycle pipelines (desktop maps via `t()`). */
export type VaultPipelineErrorCode = "error.insufficient_ram" | "error.archive_test_failed";

export class VaultPipelineError extends Error {
  readonly code: VaultPipelineErrorCode;

  constructor(code: VaultPipelineErrorCode) {
    super(code);
    this.name = "VaultPipelineError";
    this.code = code;
  }
}

export function isVaultPipelineError(error: unknown): error is VaultPipelineError {
  return error instanceof VaultPipelineError;
}
