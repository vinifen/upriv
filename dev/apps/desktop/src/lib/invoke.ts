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

/** Per-method renderer timeout. `0` = no timeout (native dialogs must not be raced). */
const METHOD_TIMEOUT_MS: Partial<Record<string, number>> = {
  app_shutdown: 5_000,
  app_version: 10_000,
  app_exit: 15_000,
  app_settings_get: 15_000,
  app_settings_save: 30_000,
  pick_directory: 0,
  vault_root_resolve: 15_000,
  // Large `.upriv/` rename/delete on slow disks can take minutes; keep a high ceiling
  // and map timeouts to vault-root-specific i18n (see errorMessages / locales).
  vault_root_setup_default_root: 600_000,
  vault_root_setup_path: 600_000,
  vault_root_read_alias: 10_000,
  vault_root_default_root_status: 10_000,
  vault_root_inspect_path: 10_000,
};

function parseInvokeFailure(error: unknown): RpcError {
  if (isRpcError(error)) return error;

  if (error instanceof Error) {
    const match = DAEMON_ERROR_MESSAGE_RE.exec(error.message);
    if (match) {
      // Electron main used to emit `timeout:`; map to `rpc_timeout` for i18n.
      const code = match[1] === "timeout" ? BRIDGE_ERROR_CODES.RPC_TIMEOUT : match[1];
      return new RpcError(code, match[2]);
    }
    // Electron/preload/serialize — not the same as "daemon process down".
    return new RpcError(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED, error.message);
  }

  return new RpcError(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED, String(error));
}

/**
 * Low-level IPC invoke with timeout. Prefer typed helpers in `./rpc.ts`.
 * Unknown daemon methods are rejected by `upriv-daemon` (`rpc.rs`).
 * Pass `timeoutMs: 0` (or set the method map to `0`) to wait indefinitely.
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

  const invocation = api.invoke(method, params ?? {});
  if (timeoutMs <= 0) {
    try {
      return await invocation;
    } catch (error) {
      throw parseInvokeFailure(error);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
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
