import {
  CORE_RPC_COMMANDS,
  DESKTOP_ONLY_RPC_COMMANDS,
  SHELL_ONLY_RPC_COMMANDS,
} from "@upriv/shared";

/** Electron shell — never sent to upriv-daemon. */
export const SHELL_COMMANDS = SHELL_ONLY_RPC_COMMANDS;

/** Desktop daemon RPC — shared core ops + desktop-only lifecycle. */
export const DAEMON_COMMANDS = {
  ...CORE_RPC_COMMANDS,
  ...DESKTOP_ONLY_RPC_COMMANDS,
} as const;

export type { CoreRpcCommand, DesktopOnlyRpcCommand, ShellOnlyRpcCommand } from "@upriv/shared";
