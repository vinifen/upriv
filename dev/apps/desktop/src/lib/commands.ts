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

export const DESKTOP_COMMANDS = {
  ...SHELL_COMMANDS,
  ...DAEMON_COMMANDS,
} as const;

export type { CoreRpcCommand, DesktopOnlyRpcCommand, ShellOnlyRpcCommand } from "@upriv/shared";
export type ShellCommand = (typeof SHELL_COMMANDS)[keyof typeof SHELL_COMMANDS];
export type DaemonCommand = (typeof DAEMON_COMMANDS)[keyof typeof DAEMON_COMMANDS];
export type DesktopCommand = ShellCommand | DaemonCommand;
