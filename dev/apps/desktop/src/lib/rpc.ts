import { DAEMON_COMMANDS, SHELL_COMMANDS } from "./commands";
import { BRIDGE_ERROR_CODES, RpcError, isRpcError } from "./errors";
import { desktopInvokeRaw } from "./invoke";
import { parseAppVersionResult, type AppVersionResult } from "./types";

/** Fetch product version from upriv-daemon. */
export async function rpcAppVersion(): Promise<AppVersionResult> {
  try {
    const raw = await desktopInvokeRaw(DAEMON_COMMANDS.APP_VERSION);
    return parseAppVersionResult(raw);
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "app_version failed", error);
  }
}

/** Graceful daemon shutdown (Electron main also calls this on quit). */
export async function rpcAppShutdown(): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.APP_SHUTDOWN);
}

/** Request app exit — main awaits daemon teardown before quitting. */
export async function rpcAppExit(): Promise<void> {
  await desktopInvokeRaw(SHELL_COMMANDS.APP_EXIT);
}
