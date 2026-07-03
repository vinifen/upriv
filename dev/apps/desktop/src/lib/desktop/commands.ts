/** Desktop RPC method names — extend alongside `crates/upriv-daemon/src/rpc.rs`. */
export const DESKTOP_COMMANDS = {
  APP_VERSION: "app_version",
  APP_EXIT: "app_exit",
} as const;

export type DesktopCommand = (typeof DESKTOP_COMMANDS)[keyof typeof DESKTOP_COMMANDS];

/** @deprecated Use DESKTOP_EVENTS when event bridge is wired */
export const DESKTOP_EVENTS = {} as const;
