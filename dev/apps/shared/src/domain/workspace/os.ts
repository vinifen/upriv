/**
 * One workspace folder per system. `settings.toml` travels with the data folder,
 * so a Linux path and an Android `content://` address cannot share one string.
 * The app stores one `file_manager_folder`. A vault stores `app_file_manager_folder` and
 * `custom_file_manager_folder` once. Those flags are shared by every system.
 */

export const WORKSPACE_SYSTEMS = ["linux", "windows", "macos", "android", "ios"] as const;

export type WorkspaceSystem = (typeof WORKSPACE_SYSTEMS)[number];

/** Where this system's workspace folder is. `unset` is the start and creates nothing. */
export type WorkspacePlace = "unset" | "beside" | "custom";

/**
 * Choice used when this vault follows the app folder.
 * `inherit` follows the app file manager folder. `on` and `off` are this vault only.
 */
export type VaultShortcut = "inherit" | "on" | "off";

export interface WorkspaceOsEntry {
  /**
   * `unset` creates nothing. `beside` is workspace next to `.upriv`.
   * `custom` uses `path`. Vault rows leave this `unset` and use `path` only.
   */
  place: WorkspacePlace;
  path: string;
}

/**
 * Five folders plus the file manager folder flags shared by every system.
 * `file_manager_folder` is the app flag. `app_file_manager_folder` and `custom_file_manager_folder` belong to a vault.
 */
export interface WorkspaceTable {
  file_manager_folder: boolean;
  app_file_manager_folder: VaultShortcut;
  custom_file_manager_folder: boolean;
  linux: WorkspaceOsEntry;
  windows: WorkspaceOsEntry;
  macos: WorkspaceOsEntry;
  android: WorkspaceOsEntry;
  ios: WorkspaceOsEntry;
}

/** Desktop rows can turn on the encrypted file manager folder. */
export function workspaceSystemHasShortcut(system: WorkspaceSystem): boolean {
  return system === "linux" || system === "windows" || system === "macos";
}

/** Map `process.platform` or React Native `Platform.OS` onto a workspace row. */
export function workspaceSystemFromHost(host: string | null | undefined): WorkspaceSystem {
  switch (host) {
    case "win32":
    case "windows":
      return "windows";
    case "darwin":
    case "macos":
      return "macos";
    case "android":
      return "android";
    case "ios":
      return "ios";
    default:
      return "linux";
  }
}

export interface NavigatorHostSignals {
  userAgent?: string;
  platform?: string;
  userAgentDataPlatform?: string;
}

/**
 * Browser / Electron user-agent → `process.platform` shape.
 * Android is tested first because those user agents also contain "Linux".
 */
export function hostPlatformFromSignals(signals: NavigatorHostSignals): string | undefined {
  const blob = [signals.userAgentDataPlatform, signals.platform, signals.userAgent]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ");
  if (!blob) return undefined;
  if (/android/i.test(blob)) return "android";
  if (/\b(iphone|ipad|ipod)\b/i.test(blob)) return "ios";
  if (/win/i.test(blob)) return "win32";
  if (/mac/i.test(blob)) return "darwin";
  if (/linux|x11/i.test(blob)) return "linux";
  return undefined;
}

interface HostGlobals {
  process?: { platform?: string };
  navigator?: {
    userAgent?: string;
    platform?: string;
    userAgentData?: { platform?: string };
  };
}

/**
 * Host string for this process.
 * Read `globalThis` so the Electron renderer (no Node `process`) does not throw,
 * and so this package does not depend on Node or DOM type libs.
 */
export function detectHostPlatform(): string | undefined {
  const globals = globalThis as HostGlobals;
  const platform = globals.process?.platform;
  if (typeof platform === "string" && platform.length > 0) return platform;
  const nav = globals.navigator;
  if (!nav) return undefined;
  return hostPlatformFromSignals({
    userAgent: nav.userAgent,
    platform: nav.platform,
    userAgentDataPlatform: nav.userAgentData?.platform,
  });
}

/** Current workspace row. Pass React Native `Platform.OS` when calling from the phone. */
export function currentWorkspaceSystem(host?: string | null): WorkspaceSystem {
  if (typeof host === "string" && host.length > 0) return workspaceSystemFromHost(host);
  return workspaceSystemFromHost(detectHostPlatform());
}

/** Current system first, then the other rows in the usual order. */
export function workspaceSystemsCurrentFirst(host?: string | null): WorkspaceSystem[] {
  const current = currentWorkspaceSystem(host);
  return [current, ...WORKSPACE_SYSTEMS.filter((system) => system !== current)];
}

function emptyEntry(): WorkspaceOsEntry {
  return {
    place: "unset",
    path: "",
  };
}

function emptyTable(): WorkspaceTable {
  return {
    file_manager_folder: false,
    app_file_manager_folder: "inherit",
    custom_file_manager_folder: false,
    linux: emptyEntry(),
    windows: emptyEntry(),
    macos: emptyEntry(),
    android: emptyEntry(),
    ios: emptyEntry(),
  };
}

/**
 * App row after read. `beside` and `unset` are kept. A path with no `place`
 * is `custom`. An empty path is `unset`, not the folder beside `.upriv`.
 */
export function appWorkspacePlace(entry: WorkspaceOsEntry): WorkspacePlace {
  if (entry.place === "beside") return "beside";
  if (entry.place === "unset") return "unset";
  return entry.path.trim() ? "custom" : "unset";
}

/** App default: no paths, file manager folder off. */
export function appWorkspace(): WorkspaceTable {
  return emptyTable();
}

/** Vault default: empty path follows the app folder. `app_file_manager_folder` starts `inherit`. */
export function vaultWorkspace(): WorkspaceTable {
  return appWorkspace();
}

export function workspaceTablesEqual(a: WorkspaceTable, b: WorkspaceTable): boolean {
  return (
    a.file_manager_folder === b.file_manager_folder &&
    a.app_file_manager_folder === b.app_file_manager_folder &&
    a.custom_file_manager_folder === b.custom_file_manager_folder &&
    WORKSPACE_SYSTEMS.every(
      (system) =>
        appWorkspacePlace(a[system]) === appWorkspacePlace(b[system]) &&
        a[system].path.trim() === b[system].path.trim(),
    )
  );
}

function vaultShortcutToken(value: unknown): VaultShortcut | null {
  return value === "inherit" || value === "on" || value === "off" ? value : null;
}

function readRow(raw: unknown): { place: string; path: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { place?: unknown; path?: unknown };
  const place = typeof row.place === "string" ? row.place.trim() : "";
  const path = typeof row.path === "string" ? row.path.trim() : "";
  return { place, path };
}

function appPlaceFromRaw(place: string, path: string): WorkspacePlace {
  if (place === "beside") return "beside";
  if (place === "unset" || !path) return "unset";
  return "custom";
}

/** Read the five per-system rows. Shortcuts are one value for every system. */
export function normalizeWorkspaceTable(raw: unknown, kind: "app" | "vault"): WorkspaceTable {
  const table = kind === "vault" ? vaultWorkspace() : appWorkspace();
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (kind === "vault") {
    table.app_file_manager_folder = vaultShortcutToken(record.app_file_manager_folder) ?? "inherit";
    table.custom_file_manager_folder = record.custom_file_manager_folder === true;
  } else {
    table.file_manager_folder = record.file_manager_folder === true;
  }
  for (const system of WORKSPACE_SYSTEMS) {
    const row = readRow(record[system]);
    if (!row) continue;
    if (kind === "vault") {
      table[system].path = row.path;
      table[system].place = "unset";
      continue;
    }
    const place = appPlaceFromRaw(row.place, row.path);
    table[system].place = place;
    table[system].path = place === "custom" ? row.path : "";
  }
  return table;
}

/**
 * Parent directory. A vault path wins and the file manager folder sits at its root.
 * Otherwise `beside` is the data folder and `custom` is the app path, and the
 * file manager folder sits in `workspace` there. `unset` is empty.
 */
export function resolvedWorkspaceParent(
  app: WorkspaceTable,
  vault: WorkspaceTable,
  system: WorkspaceSystem,
  vaultRoot: string | null | undefined,
): string {
  const vaultPath = vault[system].path.trim().replace(/[/\\]+$/, "");
  if (vaultPath) return vaultPath;
  const place = appWorkspacePlace(app[system]);
  if (place === "beside") return (vaultRoot ?? "").trim().replace(/[/\\]+$/, "");
  if (place === "custom") return app[system].path.trim().replace(/[/\\]+$/, "");
  return "";
}

/**
 * Encrypted file manager folder for this system.
 * The app flag and the two vault flags are shared. This system's place and
 * path decide whether they apply. An empty vault path follows the app file manager folder
 * unless this vault set `on` or `off`. `on` still needs a chosen app place.
 * A vault path of its own uses `custom_file_manager_folder` alone. Unset creates nothing.
 */
export function encryptedShortcutActive(
  app: WorkspaceTable,
  vault: WorkspaceTable,
  system: WorkspaceSystem,
): boolean {
  if (!workspaceSystemHasShortcut(system)) return false;
  if (vault[system].path.trim() !== "") return vault.custom_file_manager_folder;
  if (appWorkspacePlace(app[system]) === "unset") return false;
  if (vault.app_file_manager_folder === "off") return false;
  if (vault.app_file_manager_folder === "on") return true;
  return app.file_manager_folder;
}

/** Mount table sent to the daemon. Both file manager folder fields are stored once. */
export function vaultMountForDaemon(table: WorkspaceTable): {
  app_file_manager_folder: VaultShortcut;
  custom_file_manager_folder: boolean;
} & Record<WorkspaceSystem, { path: string }> {
  const mount = {
    app_file_manager_folder: table.app_file_manager_folder,
    custom_file_manager_folder: table.custom_file_manager_folder,
  } as {
    app_file_manager_folder: VaultShortcut;
    custom_file_manager_folder: boolean;
  } & Record<WorkspaceSystem, { path: string }>;
  for (const system of WORKSPACE_SYSTEMS) {
    mount[system] = { path: table[system].path };
  }
  return mount;
}
