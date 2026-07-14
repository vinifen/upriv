import { BRIDGE_ERROR_CODES, RpcError, isRpcError } from "./errors";

/** Matches `formatRpcError` in `apps/electron/src/daemon.ts` (`code: message`).
 * Electron wraps IPC failures as `Error invoking remote method '…': Error: code: message`.
 * Message may be multiline (e.g. TOML parse errors) — use `[\s\S]` not `.`. */
const DAEMON_ERROR_MESSAGE_RE = /\b([a-z][a-z0-9_]*): ([\s\S]+)$/;

/** True when the renderer has a working Electron preload bridge (`window.upriv.invoke`). */
export function isElectronRenderer(): boolean {
  if (typeof window === "undefined") return false;
  const api = window.upriv;
  if (!api || typeof api.invoke !== "function") return false;

  const { protocol, hostname, port } = window.location;
  if (protocol === "file:") return true;
  if (protocol === "http:" && hostname === "localhost" && port === "1420") return true;
  return false;
}

/** @alias isElectronRenderer */
export function isDesktop(): boolean {
  return isElectronRenderer();
}

const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;

const METHOD_TIMEOUT_MS: Partial<Record<string, number>> = {
  app_shutdown: 5_000,
  app_version: 10_000,
  app_exit: 15_000,
  app_settings_get: 15_000,
  app_settings_save: 30_000,
  pick_directory: 120_000,
  vault_root_resolve: 15_000,
  vault_root_setup_nearby: 30_000,
  vault_root_setup_path: 30_000,
  vault_root_read_alias: 10_000,
  vault_root_rewrite_alias: 10_000,
  vault_root_deactivate_alias: 10_000,
  vault_root_nearby_status: 10_000,
  vault_root_inspect_path: 10_000,
};

function parseInvokeFailure(error: unknown): RpcError {
  if (isRpcError(error)) return error;

  if (error instanceof Error) {
    const match = DAEMON_ERROR_MESSAGE_RE.exec(error.message);
    if (match) {
      return new RpcError(match[1], match[2]);
    }
    // Electron/preload/serialize — not the same as "daemon process down".
    return new RpcError(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED, error.message);
  }

  return new RpcError(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED, String(error));
}

/**
 * Low-level IPC invoke with timeout. Prefer typed helpers in `./rpc.ts`.
 * Unknown daemon methods are rejected by `upriv-daemon` (`rpc.rs`).
 * @throws {RpcError}
 */
export async function desktopInvokeRaw(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = METHOD_TIMEOUT_MS[method] ?? DEFAULT_INVOKE_TIMEOUT_MS,
): Promise<unknown> {
  if (!isDesktop()) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.SHELL_UNAVAILABLE,
      "desktopInvoke called outside Electron shell",
    );
  }

  const api = window.upriv;
  if (!api) {
    throw new RpcError(BRIDGE_ERROR_CODES.SHELL_UNAVAILABLE, "window.upriv is unavailable");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const invocation = api.invoke(method, params ?? {});
  // On timeout we reject below; make sure a late daemon resolution/rejection is
  // dropped quietly instead of surfacing as an unhandled promise rejection.
  invocation.catch(() => undefined);
  try {
    return await Promise.race([
      invocation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new RpcError(
              BRIDGE_ERROR_CODES.RPC_TIMEOUT,
              `invoke timeout after ${timeoutMs}ms: ${method}`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    throw parseInvokeFailure(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
