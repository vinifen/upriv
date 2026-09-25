import {
  CORE_RPC_TIMEOUT_MS,
  DESKTOP_ONLY_RPC_COMMANDS,
  LOADING_BUDGET_MS,
  SHELL_ONLY_RPC_COMMANDS,
} from "@upriv/shared";
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

/**
 * Per-method renderer + Electron main timeout. `0` = no timeout (native dialogs).
 * CORE values come from `@upriv/shared` `CORE_RPC_TIMEOUT_MS`.
 * Passed through preload so main `daemonRpc` does not clamp to 30s.
 */
export const METHOD_TIMEOUT_MS: Partial<Record<string, number>> = {
  ...CORE_RPC_TIMEOUT_MS,
  [DESKTOP_ONLY_RPC_COMMANDS.APP_SHUTDOWN]: LOADING_BUDGET_MS.vaultPipeline,
  [SHELL_ONLY_RPC_COMMANDS.APP_EXIT]: LOADING_BUDGET_MS.vaultPipeline,
  [SHELL_ONLY_RPC_COMMANDS.PICK_DIRECTORY]: 0,
  [SHELL_ONLY_RPC_COMMANDS.PICK_FILE]: 0,
  [SHELL_ONLY_RPC_COMMANDS.PICK_SAVE_FILE]: 0,
  [SHELL_ONLY_RPC_COMMANDS.REVEAL_IN_FILE_MANAGER]: 10_000,
  [SHELL_ONLY_RPC_COMMANDS.OPEN_IN_TERMINAL]: 10_000,
};

/** Normalize Electron/preload invoke failures into `RpcError` (wire `code: message`). */
export function parseInvokeFailure(error: unknown): RpcError {
  if (isRpcError(error)) return error;

  if (error instanceof Error) {
    const match = DAEMON_ERROR_MESSAGE_RE.exec(error.message);
    if (match) {
      // Electron main used to emit `timeout:`; map to `rpc_timeout` for i18n.
      const code = match[1] === "timeout" ? BRIDGE_ERROR_CODES.RPC_TIMEOUT : match[1];
      return new RpcError(code, match[2]);
    }
    // Daemon-down messages are not `code: message` wire format — map them
    // to `daemon_unavailable`. Other preload/serialize failures stay as
    // `bridge_invoke_failed`.
    const text = error.message;
    if (
      /upriv-daemon (exited|is not running)/i.test(text) ||
      /upriv-daemon startup timeout/i.test(text)
    ) {
      return new RpcError(BRIDGE_ERROR_CODES.DAEMON_UNAVAILABLE, text);
    }
    return new RpcError(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED, text);
  }

  return new RpcError(BRIDGE_ERROR_CODES.BRIDGE_INVOKE_FAILED, String(error));
}

/**
 * Low-level IPC invoke with timeout. Prefer typed helpers in `./rpc.ts`.
 * Unknown daemon methods are rejected by `upriv-rpc` (via `upriv-daemon`).
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

  // Pass timeout to Electron main so `daemonRpc` matches the renderer budget.
  const invocation = api.invoke(method, params ?? {}, timeoutMs);
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
