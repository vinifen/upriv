import { DAEMON_COMMANDS, SHELL_COMMANDS } from "./commands";
import { BRIDGE_ERROR_CODES, RpcError, isRpcError } from "./errors";
import { desktopInvokeRaw } from "./invoke";
import { parseAppVersionResult, type AppVersionResult } from "./types";
import type {
  AllowlistedUiLogEvent,
  AppSettingsConfig,
  AppLogFile,
  CreateVaultInput,
  DefaultRootStatusResult,
  VaultGroup,
  VaultGroupCreateInput,
  VaultGroupListResult,
  VaultGroupUpdateInput,
  VaultListItem,
  VaultRootAliasInfo,
  VaultRootBootstrapPrefs,
  VaultRootInspectResult,
  VaultRootMode,
  VaultRootResolveResult,
  VaultRenameResult,
  VaultSettingsConfig,
} from "@upriv/shared";
import {
  isLifecyclePasswordPresent,
  normalizeAppSettings,
  normalizeVaultSettingsConfig,
  parseAppLogFile,
  parseDefaultRootStatus,
  parseVaultGroupListResult,
  parseVaultGroupWire,
  parseVaultListItemWire,
  parseVaultListResult,
  parseVaultRenameResult,
  parseVaultRootInspect,
  parseVaultRootResolve,
} from "@upriv/shared";

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

/** Graceful daemon shutdown. Scaffolding for `close_on_app_exit` (UI not exposed yet). */
export async function rpcAppShutdown(): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.APP_SHUTDOWN);
}

/** Request app exit — main awaits daemon teardown. Scaffolding for `close_on_app_exit`. */
export async function rpcAppExit(): Promise<void> {
  await desktopInvokeRaw(SHELL_COMMANDS.APP_EXIT);
}

/** Native directory picker (Electron main). Optional `defaultPath` opens near that folder. */
export async function rpcPickDirectory(
  defaultPath?: string | null,
  title?: string | null,
): Promise<string | null> {
  const raw = await desktopInvokeRaw(SHELL_COMMANDS.PICK_DIRECTORY, {
    defaultPath: defaultPath?.trim() || null,
    title: title?.trim() || null,
  });
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "pick_directory: expected string | null",
      raw,
    );
  }
  return raw;
}

function parseAppSettingsConfig(raw: unknown): AppSettingsConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "app_settings: expected settings object",
      raw,
    );
  }
  return normalizeAppSettings(raw as AppSettingsConfig);
}

export async function rpcAppSettingsGet(): Promise<{
  settings: AppSettingsConfig;
  rootPath: string | null;
  onDisk: boolean;
}> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.APP_SETTINGS_GET);
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "app_settings_get: expected object",
      raw,
    );
  }
  const record = raw as Record<string, unknown>;
  return {
    settings: parseAppSettingsConfig(record.settings),
    rootPath: typeof record.rootPath === "string" ? record.rootPath : null,
    onDisk: record.onDisk === true,
  };
}

export async function rpcAppSettingsSave(
  settings: AppSettingsConfig,
  options?: { syncAlias?: boolean },
): Promise<{ wrote: boolean }> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.APP_SETTINGS_SAVE, {
    settings,
    // Default true — omit only when vault-root setup already synced the alias.
    syncAlias: options?.syncAlias ?? true,
  });
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { wrote?: unknown }).wrote !== "boolean"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "app_settings_save: expected { wrote }",
      raw,
    );
  }
  return { wrote: (raw as { wrote: boolean }).wrote };
}

export async function rpcVaultRootResolve(options?: {
  vaultRootMode?: VaultRootMode;
  explicitPath?: string | null;
  binaryDir?: string | null;
}): Promise<VaultRootResolveResult> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_RESOLVE, {
    vaultRootMode: options?.vaultRootMode ?? "default_root",
    explicitPath: options?.explicitPath ?? null,
    binaryDir: options?.binaryDir ?? null,
  });
  return parseVaultRootResolve(raw);
}

export async function rpcVaultRootSetupDefaultRoot(options?: {
  replaceIncomplete?: boolean;
  replacePolicy?: "delete" | "rename";
  bootstrap?: VaultRootBootstrapPrefs | null;
}): Promise<{ rootPath: string }> {
  const replaceIncomplete = options?.replaceIncomplete ?? false;
  if (replaceIncomplete && options?.replacePolicy == null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "replacePolicy is required when replaceIncomplete is true",
    );
  }
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_SETUP_DEFAULT_ROOT, {
    replaceIncomplete,
    replacePolicy: options?.replacePolicy ?? null,
    bootstrap: options?.bootstrap ?? null,
  });
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { rootPath?: unknown }).rootPath !== "string"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_setup_default_root: expected { rootPath }",
      raw,
    );
  }
  return { rootPath: (raw as { rootPath: string }).rootPath };
}

export async function rpcVaultRootSetupPath(
  path: string,
  options?: {
    replaceIncomplete?: boolean;
    replacePolicy?: "delete" | "rename";
    bootstrap?: VaultRootBootstrapPrefs | null;
  },
): Promise<{ rootPath: string; aliasPath: string }> {
  const replaceIncomplete = options?.replaceIncomplete ?? false;
  if (replaceIncomplete && options?.replacePolicy == null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "replacePolicy is required when replaceIncomplete is true",
    );
  }
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_SETUP_PATH, {
    path,
    replaceIncomplete,
    replacePolicy: options?.replacePolicy ?? null,
    bootstrap: options?.bootstrap ?? null,
  });
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { rootPath?: unknown }).rootPath !== "string" ||
    typeof (raw as { aliasPath?: unknown }).aliasPath !== "string"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_setup_path: expected { rootPath, aliasPath }",
      raw,
    );
  }
  return {
    rootPath: (raw as { rootPath: string }).rootPath,
    aliasPath: (raw as { aliasPath: string }).aliasPath,
  };
}

export async function rpcVaultRootDeactivateAlias(): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_DEACTIVATE_ALIAS);
}

export async function rpcVaultRootReadAlias(): Promise<VaultRootAliasInfo | null> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_READ_ALIAS);
  if (raw === null || raw === undefined) return null;
  if (
    typeof raw !== "object" ||
    typeof (raw as { path?: unknown }).path !== "string" ||
    typeof (raw as { active?: unknown }).active !== "boolean"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_read_alias: expected { path, active } | null",
      raw,
    );
  }
  return {
    path: (raw as { path: string }).path,
    active: (raw as { active: boolean }).active,
  };
}

export async function rpcVaultRootSuggestedCustomPath(): Promise<string> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_SUGGESTED_CUSTOM_PATH);
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { path?: unknown }).path !== "string"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_suggested_custom_path: expected { path }",
      raw,
    );
  }
  return (raw as { path: string }).path;
}

export async function rpcVaultRootDefaultRootStatus(): Promise<DefaultRootStatusResult> {
  return parseDefaultRootStatus(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_DEFAULT_ROOT_STATUS),
  );
}

export async function rpcVaultRootInspectPath(path: string): Promise<VaultRootInspectResult> {
  return parseVaultRootInspect(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_INSPECT_PATH, { path }),
  );
}

function parseAppLogFileOrThrow(raw: unknown): AppLogFile {
  try {
    return parseAppLogFile(raw);
  } catch (error) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      error instanceof Error ? error.message : "log file: invalid shape",
      raw,
    );
  }
}

/** List `.upriv/logs/*.log` metadata (content empty until `log_get`). */
export async function rpcLogList(): Promise<AppLogFile[]> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.LOG_LIST);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as { files?: unknown }).files)
  ) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "log_list: expected { files }", raw);
  }
  return (raw as { files: unknown[] }).files.map(parseAppLogFileOrThrow);
}

/** Read one log file including content. */
export async function rpcLogGet(filename: string): Promise<AppLogFile | undefined> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.LOG_GET, { filename });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "log_get: expected object", raw);
  }
  const file = (raw as { file?: unknown }).file;
  if (file === null || file === undefined) return undefined;
  return parseAppLogFileOrThrow(file);
}

/** Delete log files by basename (active `current-*` allowed). */
export async function rpcLogDelete(filenames: readonly string[]): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.LOG_DELETE, { filenames: [...filenames] });
}

/** Append allowlisted session log event (no id, name, or path fields). */
export async function rpcLogEvent(event: AllowlistedUiLogEvent): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.LOG_EVENT, { event });
}

export async function rpcVaultGroupList(): Promise<VaultGroupListResult> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_LIST);
  return parseVaultGroupListResult(raw);
}

export async function rpcVaultGroupCreate(input: VaultGroupCreateInput): Promise<VaultGroup> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_CREATE, {
    id: input.id,
    displayName: input.displayName,
    groupedVaults: input.groupedVaults ?? [],
    groupedVaultSort: input.groupedVaultSort,
    groupedVaultSortDirection: input.groupedVaultSortDirection,
    hidden: input.hidden,
  });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_group_create: expected object",
      raw,
    );
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupUpdate(input: VaultGroupUpdateInput): Promise<VaultGroup> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_UPDATE, {
    id: input.id,
    displayName: input.displayName,
    collapsed: input.collapsed,
    order: input.order,
    groupedVaults: input.groupedVaults,
    groupedVaultSort: input.groupedVaultSort,
    groupedVaultSortDirection: input.groupedVaultSortDirection,
    hidden: input.hidden,
  });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_group_update: expected object",
      raw,
    );
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupDelete(id: string): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_DELETE, { id });
}

export async function rpcVaultGroupSetCollapsed(
  id: string,
  collapsed: boolean,
): Promise<VaultGroup> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_SET_COLLAPSED, { id, collapsed });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_group_set_collapsed: expected object",
      raw,
    );
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupReorderGroupedVaults(
  id: string,
  groupedVaults: string[],
): Promise<VaultGroup> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_REORDER_GROUPED_VAULTS, {
    id,
    groupedVaults,
  });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_group_reorder_grouped_vaults: expected object",
      raw,
    );
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupReorder(
  orders: { id: string; order: number }[],
): Promise<VaultGroup[]> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_REORDER, { orders });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_group_reorder: expected object",
      raw,
    );
  }
  const groups = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_group_reorder: expected groups array",
      raw,
    );
  }
  return groups.map(parseVaultGroupWire);
}

export async function rpcVaultGroupRepair(): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_GROUP_REPAIR);
}

export async function rpcVaultList(): Promise<VaultListItem[]> {
  return parseVaultListResult(await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_LIST));
}

export async function rpcVaultCreate(input: CreateVaultInput): Promise<VaultListItem> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_CREATE, {
    password: input.password,
    unlockPreset: input.unlockPreset,
    settings: input.settings,
  });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "vault_create: expected object", raw);
  }
  return parseVaultListItemWire((raw as { vault?: unknown }).vault);
}

export async function rpcVaultOpen(id: string, password: string): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_OPEN, { id, password });
}

export async function rpcVaultClose(id: string, password?: string): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_CLOSE, {
    id,
    password: password && isLifecyclePasswordPresent(password) ? password : undefined,
  });
}

export async function rpcVaultConfigGet(id: string): Promise<VaultSettingsConfig> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_CONFIG_GET, { id });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_config_get: expected object",
      raw,
    );
  }
  const settings = (raw as { settings?: unknown }).settings;
  if (typeof settings !== "object" || settings === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_config_get: expected settings",
      raw,
    );
  }
  return normalizeVaultSettingsConfig(settings as VaultSettingsConfig);
}

export async function rpcVaultConfigSave(id: string, settings: VaultSettingsConfig): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_CONFIG_SAVE, { id, settings });
}

export async function rpcVaultRename(id: string, displayName: string): Promise<VaultRenameResult> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_RENAME, { id, displayName });
  return parseVaultRenameResult(raw);
}
