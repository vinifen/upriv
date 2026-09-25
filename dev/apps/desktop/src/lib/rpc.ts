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
  VaultBackupEntry,
  VaultExportRequest,
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
  bytesFromContentB64,
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
  vaultImportProbeTimeoutMs,
  parsePathWriteResult,
  type CloseVaultOutcome,
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

/** Graceful daemon shutdown (`close_all` into `store/`). */
export async function rpcAppShutdown(): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.APP_SHUTDOWN);
}

/** Request app exit — main warns if a vault is open, then awaits daemon teardown. */
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

export async function rpcPickFile(options?: {
  title?: string | null;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const raw = await desktopInvokeRaw(SHELL_COMMANDS.PICK_FILE, {
    title: options?.title?.trim() || null,
    filters: options?.filters ?? null,
  });
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "pick_file: expected string | null",
      raw,
    );
  }
  return raw;
}

export async function rpcPickSaveFile(options?: {
  title?: string | null;
  defaultPath?: string | null;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const raw = await desktopInvokeRaw(SHELL_COMMANDS.PICK_SAVE_FILE, {
    title: options?.title?.trim() || null,
    defaultPath: options?.defaultPath?.trim() || null,
    filters: options?.filters ?? null,
  });
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "pick_save_file: expected string | null",
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

export async function rpcVaultClose(id: string, password?: string): Promise<CloseVaultOutcome> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_CLOSE, {
    id,
    password: password && isLifecyclePasswordPresent(password) ? password : undefined,
  });
  return parseCloseVaultOutcome(raw);
}

function parseCloseVaultOutcome(raw: unknown): CloseVaultOutcome {
  if (typeof raw !== "object" || raw === null) {
    return { backupFailed: false };
  }
  return { backupFailed: (raw as { backupFailed?: unknown }).backupFailed === true };
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

function requireRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, `${label}: expected object`, raw);
  }
  return raw as Record<string, unknown>;
}

function requireRevision(raw: unknown, label: string): number {
  const record = requireRecord(raw, label);
  const revision = record.revision;
  if (typeof revision !== "number" || !Number.isFinite(revision)) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, `${label}: expected revision`, raw);
  }
  return revision;
}

function requirePathRevision(raw: unknown, label: string): { path: string; revision: number } {
  const record = requireRecord(raw, label);
  if (typeof record.path !== "string" || typeof record.revision !== "number") {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      `${label}: expected path+revision`,
      raw,
    );
  }
  return { path: record.path, revision: record.revision };
}

function parseVaultResult(raw: unknown, label: string): VaultListItem {
  const record = requireRecord(raw, label);
  return parseVaultListItemWire(record.vault);
}

export async function rpcVaultDelete(id: string): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_DELETE, { id });
}

export async function rpcVaultRecoverAck(id: string): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_RECOVER_ACK, { id });
}

export async function rpcVaultExportProbe(id: string, password: string): Promise<boolean> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_EXPORT_PROBE, { id, password });
  const record = requireRecord(raw, "vault_export_probe");
  return record.ok === true;
}

export async function rpcVaultExportCapabilities(): Promise<{ sevenZip: boolean }> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_EXPORT_CAPABILITIES, {});
  if (typeof raw !== "object" || raw === null) {
    return { sevenZip: false };
  }
  return { sevenZip: (raw as { sevenZip?: unknown }).sevenZip === true };
}

export async function rpcVaultExport(id: string, request: VaultExportRequest): Promise<Uint8Array> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_EXPORT, {
    id,
    format: request.format,
    password: request.password,
    sevenZip: request.sevenZip,
  });
  return bytesFromContentB64(raw);
}

export async function rpcVaultExportToPath(
  id: string,
  request: VaultExportRequest,
  destPath: string,
): Promise<{ path: string; size: number }> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_EXPORT, {
    id,
    format: request.format,
    password: request.password,
    sevenZip: request.sevenZip,
    destPath,
  });
  const written = parsePathWriteResult(raw);
  if (!written) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_export: expected path+size",
      raw,
    );
  }
  return written;
}

export async function rpcVaultImportZip(input: CreateVaultInput): Promise<VaultListItem> {
  const pkg = input.importPackage;
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_IMPORT_ZIP, {
    settings: input.settings,
    archivePath: pkg?.archivePath,
    contentB64: pkg?.contentB64,
  });
  return parseVaultResult(raw, "vault_import_zip");
}

export async function rpcVaultImport7z(input: CreateVaultInput): Promise<VaultListItem> {
  const pkg = input.importPackage;
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_IMPORT_7Z, {
    settings: input.settings,
    password: input.password,
    unlockPreset: input.unlockPreset,
    archivePath: pkg?.archivePath,
    contentB64: pkg?.contentB64,
    archivePassword: pkg?.archivePassword ?? input.password,
  });
  return parseVaultResult(raw, "vault_import_7z");
}

export async function rpcVaultImportProbe(params: {
  archivePath?: string;
  contentB64?: string;
  archivePassword?: string;
  kind?: string;
}): Promise<{ ok: boolean; kind: string }> {
  const raw = await desktopInvokeRaw(
    DAEMON_COMMANDS.VAULT_IMPORT_PROBE,
    params,
    vaultImportProbeTimeoutMs(params),
  );
  const record = requireRecord(raw, "vault_import_probe");
  return {
    ok: record.ok === true,
    kind: typeof record.kind === "string" ? record.kind : "store_zip",
  };
}

export async function rpcVaultFsList(id: string): Promise<{ tree: unknown; revision: number }> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_LIST, { id });
  const record = requireRecord(raw, "vault_fs_list");
  return { tree: record.tree, revision: requireRevision(raw, "vault_fs_list") };
}

export async function rpcVaultFsRevision(id: string): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_REVISION, { id }),
    "vault_fs_revision",
  );
}

export async function rpcVaultFsRead(id: string, path: string): Promise<{ contentB64: string }> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_READ, { id, path });
  const record = requireRecord(raw, "vault_fs_read");
  if (typeof record.contentB64 !== "string") {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_fs_read: expected contentB64",
      raw,
    );
  }
  return { contentB64: record.contentB64 };
}

export async function rpcVaultFsWrite(
  id: string,
  path: string,
  contentB64: string,
): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_WRITE, { id, path, contentB64 }),
    "vault_fs_write",
  );
}

export async function rpcVaultFsReadRange(
  id: string,
  path: string,
  offset: number,
  len: number,
): Promise<{ contentB64: string }> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_READ_RANGE, {
    id,
    path,
    offset,
    len,
  });
  const record = requireRecord(raw, "vault_fs_read_range");
  if (typeof record.contentB64 !== "string") {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_fs_read_range: expected contentB64",
      raw,
    );
  }
  return { contentB64: record.contentB64 };
}

export async function rpcVaultFsWriteRange(
  id: string,
  path: string,
  offset: number,
  contentB64: string,
): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_WRITE_RANGE, {
      id,
      path,
      offset,
      contentB64,
    }),
    "vault_fs_write_range",
  );
}

export async function rpcVaultFsImportOsFile(
  id: string,
  parentPath: string,
  name: string,
  osPath: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_IMPORT_OS_FILE, {
      id,
      parentPath,
      name,
      osPath,
    }),
    "vault_fs_import_os_file",
  );
}

export async function rpcVaultFsTruncate(id: string, path: string, size: number): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_TRUNCATE, { id, path, size }),
    "vault_fs_truncate",
  );
}

export async function rpcVaultFsCreateFile(
  id: string,
  parentPath: string,
  name: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_CREATE_FILE, { id, parentPath, name }),
    "vault_fs_create_file",
  );
}

export async function rpcVaultFsCreateFolder(
  id: string,
  parentPath: string,
  name: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_CREATE_FOLDER, { id, parentPath, name }),
    "vault_fs_create_folder",
  );
}

export async function rpcVaultFsEnsureFolder(
  id: string,
  parentPath: string,
  name: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_ENSURE_FOLDER, { id, parentPath, name }),
    "vault_fs_ensure_folder",
  );
}

export async function rpcVaultFsDelete(id: string, path: string): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_DELETE, { id, path }),
    "vault_fs_delete",
  );
}

export async function rpcVaultFsRename(
  id: string,
  path: string,
  newName: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_RENAME, { id, path, newName }),
    "vault_fs_rename",
  );
}

export async function rpcVaultFsMove(
  id: string,
  fromPath: string,
  toFolderPath: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_MOVE, { id, fromPath, toFolderPath }),
    "vault_fs_move",
  );
}

export async function rpcVaultFsOsPath(id: string, path: string): Promise<{ osPath: string }> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_FS_OS_PATH, { id, path });
  const record = requireRecord(raw, "vault_fs_os_path");
  if (typeof record.osPath !== "string" || !record.osPath.trim()) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_fs_os_path: expected osPath",
      raw,
    );
  }
  return { osPath: record.osPath };
}

/** Open the vault mount (Finder / Explorer / desktop file manager) at `path`. */
export async function rpcRevealInFileManager(vaultId: string, path: string): Promise<void> {
  await desktopInvokeRaw(SHELL_COMMANDS.REVEAL_IN_FILE_MANAGER, { vaultId, path });
}

/** Open a system terminal at the vault mount path (cwd = folder, or parent of a file). */
export async function rpcOpenInTerminal(vaultId: string, path: string): Promise<void> {
  await desktopInvokeRaw(SHELL_COMMANDS.OPEN_IN_TERMINAL, { vaultId, path });
}

function parseBackupEntry(raw: unknown): VaultBackupEntry {
  const record = requireRecord(raw, "backup");
  return {
    stamp: typeof record.stamp === "string" ? record.stamp : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : undefined,
    saved: record.saved === true,
  };
}

export async function rpcBackupList(id: string): Promise<VaultBackupEntry[]> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.BACKUP_LIST, { id });
  const record = requireRecord(raw, "backup_list");
  const backups = record.backups;
  if (!Array.isArray(backups)) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "backup_list: expected backups", raw);
  }
  return backups.map(parseBackupEntry);
}

export async function rpcBackupDelete(id: string, stamps: readonly string[]): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.BACKUP_DELETE, { id, stamps: [...stamps] });
}

export async function rpcBackupPromote(id: string, stamp: string): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.BACKUP_PROMOTE, { id, stamp });
}

export async function rpcBackupGet(id: string, stamp: string): Promise<Uint8Array> {
  return bytesFromContentB64(await desktopInvokeRaw(DAEMON_COMMANDS.BACKUP_GET, { id, stamp }));
}

export async function rpcBackupExportToPath(
  id: string,
  stamp: string,
  destPath: string,
): Promise<{ path: string; size: number }> {
  return rpcBackupExportStampsToPath(id, [stamp], destPath);
}

export async function rpcBackupExportStampsToPath(
  id: string,
  stamps: readonly string[],
  destPath: string,
): Promise<{ path: string; size: number }> {
  const raw = await desktopInvokeRaw(
    DAEMON_COMMANDS.BACKUP_GET,
    stamps.length === 1
      ? { id, stamp: stamps[0], destPath }
      : { id, stamps: [...stamps], destPath },
  );
  const written = parsePathWriteResult(raw);
  if (!written) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "backup_get: expected path+size", raw);
  }
  return written;
}
