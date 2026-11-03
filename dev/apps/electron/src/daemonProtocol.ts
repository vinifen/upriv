/** Keep in sync with `@upriv/shared` `RpcErrorBody` (`core-rpc/errors.ts`). */
export type RpcErrorBody = { code: string; message: string; details?: unknown };

export const STARTUP_TIMEOUT_MS = 10_000;
/**
 * A call with no timeout of its own. Keep equal to `@upriv/shared`
 * `OPERATION_LIMIT_MS` (main is not bundled with the shared package).
 */
export const DEFAULT_RPC_TIMEOUT_MS = 600_000;
/**
 * The quit's Close now. A daemon still working when it runs out is stopped;
 * the next launch recovers its vaults. A normal quit has no limit: Close now
 * is its stop.
 */
export const SHUTDOWN_NOW_TIMEOUT_MS = 30_000;
export const SHUTDOWN_METHOD = "app_shutdown";
/** Soft cap on an incomplete NDJSON line (comfortably above `log_get` 2 MiB). */
export const MAX_STDOUT_BUFFER_CHARS = 8 * 1024 * 1024;

/** Keep in sync with `DAEMON_ERROR_MESSAGE_RE` in `apps/desktop/src/lib/invoke.ts`. */
export function formatRpcError(error: RpcErrorBody | undefined, fallback: string): string {
  if (!error) return fallback;
  return `${error.code}: ${error.message}`;
}

/** `timeoutMs <= 0` = no deadline: a job, a normal quit, or a native dialog. */
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

/**
 * What `upriv-invoke` answers: the value, or the failure as its `code: message`
 * text. The preload throws that text as an `Error`, which the renderer parses.
 */
export type InvokeReply = { ok: true; value: unknown } | { ok: false; error: string };

/** Run one invoke and settle it into a reply, so a failure never leaves the handler as a throw. */
export async function settleInvoke(run: () => Promise<unknown>): Promise<InvokeReply> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
