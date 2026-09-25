/** Keep in sync with `@upriv/shared` `RpcErrorBody` (`core-rpc/errors.ts`). */
export type RpcErrorBody = { code: string; message: string; details?: unknown };

export const STARTUP_TIMEOUT_MS = 10_000;
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;
/** Keep in sync with `@upriv/shared` `LOADING_BUDGET_MS.vaultPipeline` (`close_all` on quit). */
export const SHUTDOWN_TIMEOUT_MS = 600_000;
export const SHUTDOWN_METHOD = "app_shutdown";
/** Soft cap on an incomplete NDJSON line (comfortably above `log_get` 2 MiB). */
export const MAX_STDOUT_BUFFER_CHARS = 8 * 1024 * 1024;

/** Keep in sync with `DAEMON_ERROR_MESSAGE_RE` in `apps/desktop/src/lib/invoke.ts`. */
export function formatRpcError(error: RpcErrorBody | undefined, fallback: string): string {
  if (!error) return fallback;
  return `${error.code}: ${error.message}`;
}

/** `timeoutMs <= 0` = no deadline (native dialogs). Vault-root busy ops must stay > 0. */
export function shouldArmRpcTimeout(timeoutMs: number): boolean {
  return timeoutMs > 0;
}

export function rpcTimeoutErrorMessage(method: string): string {
  return `rpc_timeout: daemon RPC timeout: ${method}`;
}

export function stdoutBufferExceeded(length: number, max = MAX_STDOUT_BUFFER_CHARS): boolean {
  return length > max;
}

export function parseDaemonStdoutLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}
