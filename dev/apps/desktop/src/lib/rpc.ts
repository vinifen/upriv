import { BRIDGE_ERROR_CODES, RpcError, isRpcError } from "./errors";
import { desktopInvokeRaw } from "./invoke";
import { parseAppVersionResult, type AppVersionResult } from "./types";
import type {
  AllowlistedUiLogEvent,
  AppSettingsConfig,
  AppLogFile,
  AppListChanges,
  AttachAnswer,
  CreateVaultInput,
  DataFolderApplied,
  DataFolderListView,
  DataFolderSearchResult,
  DataFolderStatus,
  DeviceInfo,
  FolderStatus,
  ListsSaved,
  OsFolderAnswer,
  UnlockedFolderInfo,
  VaultBackupEntry,
  VaultListChanges,
  FolderRemoval,
  VaultCloseReason,
  VaultDiskUsage,
  VaultExportRequest,
  VaultExportResult,
  VaultGroup,
  VaultGroupCreateInput,
  VaultGroupListResult,
  VaultGroupUpdateInput,
  VaultListItem,
  VaultRebuildResult,
  VaultRootResolveResult,
  VaultRenameResult,
  VaultSettingsConfig,
  VaultBackupListing,
  VaultBackupSaved,
  VaultDeleteOutcome,
} from "@upriv/shared";
import {
  CORE_RPC_COMMANDS,
  SHELL_ONLY_RPC_COMMANDS,
  parseAttachAnswer,
  parseBackupEntry,
  parseBackupListing,
  parseDataFolderApplied,
  parseDataFolderList,
  parseDataFolderSearch,
  parseDataFolderStatus,
  parseFolderStatus,
  parseListsSaved,
  NO_APP_LIST_CHANGES,
  NO_VAULT_LIST_CHANGES,
  parseOsFolderAnswer,
  parseSwitches,
  parseUnlockedFolderInfo,
  parseBackupSaved,
  parseVaultDeleteOutcome,
  normalizeAppSettings,
  normalizeVaultSettingsConfig,
  parseAppLogFile,
  parseDeviceInfo,
  parseEmbeddedVaultSettings,
  parseVaultGroupListResult,
  parsePlainWipe,
  parseVaultGroupWire,
  parseVaultListItemWire,
  parseVaultCloseHurry,
  parseVaultCloseState,
  parseVaultListResult,
  parseVaultRebuildResult,
  parseVaultRenameResult,
  parseVaultRootResolve,
  vaultImportProbeTimeoutMs,
  parsePathWriteResult,
  parseVaultExportResult,
  parsePlainCloseSummary,
  parsePlainDestination,
  parsePlainHeldStatus,
  parsePlainLeftover,
  parseBackupFailure,
  parseJobStatus,
  parseVaultDiskUsage,
  type CloseVaultOutcome,
  type DataFolderApplyRequest,
  type FolderStatusList,
  type FolderSwitch,
  type JobProgress,
  type JobStopBy,
  type PlainDestination,
  type PlainHeldStatus,
  type PlainLeftover,
  type PlainWipe,
  type VaultCloseState,
} from "@upriv/shared";

/** Fetch product version from upriv-daemon. */
export async function rpcAppVersion(): Promise<AppVersionResult> {
  try {
    const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.APP_VERSION);
    return parseAppVersionResult(raw);
  } catch (error) {
    if (isRpcError(error)) throw error;
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "app_version failed", error);
  }
}

/** This device as core knows it: whether it has an ID, its host name, its system. */
export async function rpcDeviceInfo(): Promise<DeviceInfo> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.DEVICE_INFO);
  const device = parseDeviceInfo(raw);
  if (!device) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "device_info: invalid result");
  }
  return device;
}

/** Native directory picker (Electron main). Optional `defaultPath` opens near that folder. */
export async function rpcPickDirectory(
  defaultPath?: string | null,
  title?: string | null,
): Promise<string | null> {
  const raw = await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.PICK_DIRECTORY, {
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

export async function rpcWinFspStatus(): Promise<{ applicable: boolean; installed: boolean }> {
  const raw = await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.WINFSP_STATUS, {});
  if (!raw || typeof raw !== "object") {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "winfsp_status: expected an object",
      raw,
    );
  }
  const row = raw as { applicable?: unknown; installed?: unknown };
  return { applicable: row.applicable === true, installed: row.installed === true };
}

export async function rpcWinFspInstall(): Promise<boolean> {
  const raw = await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.WINFSP_INSTALL, {});
  if (!raw || typeof raw !== "object") return false;
  return (raw as { ok?: unknown }).ok === true;
}

export async function rpcFuseStatus(): Promise<{ applicable: boolean; installed: boolean }> {
  const raw = await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.FUSE_STATUS, {});
  if (!raw || typeof raw !== "object") {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "fuse_status: expected an object", raw);
  }
  const row = raw as { applicable?: unknown; installed?: unknown };
  return { applicable: row.applicable === true, installed: row.installed === true };
}

export async function rpcFuseInstall(): Promise<boolean> {
  const raw = await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.FUSE_INSTALL, {});
  if (!raw || typeof raw !== "object") return false;
  return (raw as { ok?: unknown }).ok === true;
}

export async function rpcPickFile(options?: {
  title?: string | null;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  const raw = await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.PICK_FILE, {
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
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.APP_SETTINGS_GET);
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

/** Save the app settings; `lists` carries what changed in the app's folder lists. */
export async function rpcAppSettingsSave(
  settings: AppSettingsConfig,
  lists: AppListChanges = NO_APP_LIST_CHANGES,
): Promise<ListsSaved & { wrote: boolean }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.APP_SETTINGS_SAVE, { settings, lists });
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
  return { wrote: (raw as { wrote: boolean }).wrote, ...parseListsSaved(raw) };
}

export async function rpcVaultRootResolve(options?: {
  explicitPath?: string | null;
  binaryDir?: string | null;
}): Promise<VaultRootResolveResult> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_RESOLVE, {
    explicitPath: options?.explicitPath ?? null,
    binaryDir: options?.binaryDir ?? null,
  });
  return parseVaultRootResolve(raw);
}

export async function rpcDataFolderList(newList: boolean): Promise<DataFolderListView> {
  return parseDataFolderList(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.DATA_FOLDER_LIST, { newList }),
  );
}

export async function rpcDataFolderApply(
  request: DataFolderApplyRequest,
): Promise<DataFolderApplied> {
  const params = {
    changes: request.changes,
    newList: request.newList ?? false,
    replaceIncomplete: request.replacePolicy != null,
    replacePolicy: request.replacePolicy ?? null,
    bootstrap: request.bootstrap,
  };
  return parseDataFolderApplied(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.DATA_FOLDER_APPLY, params),
  );
}

export async function rpcDataFolderSearch(job: string): Promise<DataFolderSearchResult> {
  return parseDataFolderSearch(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.DATA_FOLDER_SEARCH, { job }),
  );
}

/** A folder of the data folder list: `null` is Default. */
export async function rpcDataFolderStatus(path: string | null): Promise<DataFolderStatus> {
  return parseDataFolderStatus(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.FOLDER_STATUS, {
      list: "data_folder",
      ...(path === null ? {} : { path }),
    }),
  );
}

export async function rpcFolderStatus(
  list: FolderStatusList,
  path: string,
  vaultId: string | null,
): Promise<FolderStatus> {
  return parseFolderStatus(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.FOLDER_STATUS, {
      list,
      path,
      ...(vaultId ? { vault: vaultId } : {}),
    }),
  );
}

export async function rpcVaultUnlockedFolderAttach(id: string, job: string): Promise<AttachAnswer> {
  return parseAttachAnswer(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_UNLOCKED_FOLDER_ATTACH, { id, job }),
  );
}

export async function rpcVaultUnlockedFolderInfo(id: string): Promise<UnlockedFolderInfo> {
  return parseUnlockedFolderInfo(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_UNLOCKED_FOLDER_INFO, { id }),
  );
}

export async function rpcPlainRecordForget(id: string, token: string): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.PLAIN_RECORD_FORGET, { id, token });
}

export async function rpcVaultRootSuggestedCustomPath(): Promise<string> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_SUGGESTED_CUSTOM_PATH);
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
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.LOG_LIST);
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
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.LOG_GET, { filename });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "log_get: expected object", raw);
  }
  const file = (raw as { file?: unknown }).file;
  if (file === null || file === undefined) return undefined;
  return parseAppLogFileOrThrow(file);
}

/** Delete log files by basename (active `current-*` allowed). */
export async function rpcLogDelete(filenames: readonly string[]): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.LOG_DELETE, { filenames: [...filenames] });
}

/** Append allowlisted session log event (no id, name, or path fields). */
export async function rpcLogEvent(event: AllowlistedUiLogEvent): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.LOG_EVENT, { event });
}

export async function rpcVaultGroupList(): Promise<VaultGroupListResult> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_LIST);
  return parseVaultGroupListResult(raw);
}

export async function rpcVaultGroupCreate(input: VaultGroupCreateInput): Promise<VaultGroup> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_CREATE, {
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
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_UPDATE, {
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
  await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_DELETE, { id });
}

export async function rpcVaultGroupSetCollapsed(
  id: string,
  collapsed: boolean,
): Promise<VaultGroup> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_SET_COLLAPSED, {
    id,
    collapsed,
  });
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
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_REORDER_GROUPED_VAULTS, {
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
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_REORDER, { orders });
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
  await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_REPAIR);
}

export async function rpcVaultList(): Promise<VaultListItem[]> {
  return parseVaultListResult(await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_LIST));
}

/** Create the vault as the job `job`; a stop removes it. */
export async function rpcVaultCreate(input: CreateVaultInput, job: string): Promise<VaultListItem> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CREATE, {
    password: input.password,
    unlockPreset: input.unlockPreset,
    settings: input.settings,
    welcome: input.welcome,
    job,
  });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, "vault_create: expected object", raw);
  }
  return parseVaultListItemWire((raw as { vault?: unknown }).vault);
}

/**
 * Unlock as the job `job`; a stop leaves the vault closed. Resolves with the
 * unlocked folder switches a plain-text open made.
 */
export async function rpcVaultOpen(
  id: string,
  password: string,
  job: string,
): Promise<FolderSwitch[]> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_OPEN, { id, password, job });
  return parseSwitches((raw as { switches?: unknown } | null)?.switches);
}

export async function rpcVaultPlainDestination(id: string): Promise<PlainDestination> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_DESTINATION, { id });
  const dest = parsePlainDestination(raw);
  if (!dest) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_plain_destination: expected path",
      raw,
    );
  }
  return dest;
}

export async function rpcVaultPlainLeftover(id: string): Promise<PlainLeftover | null> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_LEFTOVER, { id });
  if (raw === null) return null;
  const leftover = parsePlainLeftover(raw);
  if (!leftover) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_plain_leftover: expected object",
      raw,
    );
  }
  return leftover;
}

export async function rpcVaultPlainRemove(id: string, job: string): Promise<PlainWipe> {
  return parsePlainWipe(await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_REMOVE, { id, job }));
}

export async function rpcVaultPlainSync(id: string): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_SYNC, { id });
}

export async function rpcVaultPlainHeld(id: string): Promise<PlainHeldStatus> {
  return parsePlainHeldStatus(await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_STATUS, { id }));
}

export async function rpcVaultPlainDeletions(id: string, apply: boolean): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_DELETIONS, { id, apply });
}

export async function rpcVaultClose(
  id: string,
  reason: VaultCloseReason = "user",
): Promise<CloseVaultOutcome> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CLOSE, { id, reason });
  return parseCloseVaultOutcome(raw);
}

/** Change the password as the job `job`. */
export async function rpcVaultChangePassword(
  id: string,
  currentPassword: string,
  newPassword: string,
  job: string,
): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CHANGE_PASSWORD, {
    id,
    currentPassword,
    newPassword,
    job,
  });
}

/** Change the unlock RAM as the job `job`. */
export async function rpcVaultChangeKdf(
  id: string,
  currentPassword: string,
  unlockPreset: string,
  job: string,
): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CHANGE_KDF, {
    id,
    currentPassword,
    unlockPreset,
    job,
  });
}

/** Rebuild the lost index of a closed vault as the job `job`. */
export async function rpcVaultRebuild(
  id: string,
  password: string,
  job: string,
): Promise<VaultRebuildResult> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_REBUILD, { id, password, job });
  return parseVaultRebuildResult(raw);
}

function parseCloseVaultOutcome(raw: unknown): CloseVaultOutcome {
  if (typeof raw !== "object" || raw === null) {
    return { backupFailed: false, backupFailure: null, backupSwitches: [], plain: null };
  }
  const body = raw as {
    backupFailed?: unknown;
    backupFailure?: unknown;
    backupSwitches?: unknown;
    plain?: unknown;
  };
  const backupFailed = body.backupFailed === true;
  return {
    backupFailed,
    backupFailure: backupFailed ? (parseBackupFailure(body.backupFailure) ?? "other") : null,
    backupSwitches: parseSwitches(body.backupSwitches),
    plain: parsePlainCloseSummary(body.plain),
  };
}

/** Tell the close running for this vault to finish the Close now way. False when none runs. */
export async function rpcVaultCloseHurry(id: string): Promise<boolean> {
  return parseVaultCloseHurry(await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CLOSE_HURRY, { id }));
}

export async function rpcVaultClosePhase(id: string): Promise<VaultCloseState | null> {
  return parseVaultCloseState(await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CLOSE_PHASE, { id }));
}

export async function rpcVaultDiskUsage(id: string): Promise<VaultDiskUsage> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_DISK_USAGE, { id });
  const usage = parseVaultDiskUsage(raw);
  if (!usage) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_disk_usage: expected storeBytes and heldBytes",
      raw,
    );
  }
  return usage;
}

export async function rpcVaultConfigGet(id: string): Promise<VaultSettingsConfig> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CONFIG_GET, { id });
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

/** Save a vault's settings; `lists` carries what changed in its folder lists. */
export async function rpcVaultConfigSave(
  id: string,
  settings: VaultSettingsConfig,
  lists: VaultListChanges = NO_VAULT_LIST_CHANGES,
): Promise<ListsSaved> {
  return parseListsSaved(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_CONFIG_SAVE, { id, settings, lists }),
  );
}

export async function rpcVaultRename(id: string, displayName: string): Promise<VaultRenameResult> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_RENAME, { id, displayName });
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

function requireCount(raw: unknown, field: string, label: string): number {
  const count = requireRecord(raw, label)[field];
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new RpcError(BRIDGE_ERROR_CODES.INVALID_RESPONSE, `${label}: expected ${field}`, raw);
  }
  return count;
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

export async function rpcVaultDelete(
  id: string,
  outsideBackups: boolean,
): Promise<VaultDeleteOutcome> {
  return parseVaultDeleteOutcome(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_DELETE, { id, outsideBackups }),
  );
}

export async function rpcVaultExportCapabilities(): Promise<{ sevenZip: boolean }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_EXPORT_CAPABILITIES, {});
  if (typeof raw !== "object" || raw === null) {
    return { sevenZip: false };
  }
  return { sevenZip: (raw as { sevenZip?: unknown }).sevenZip === true };
}

/** Write the export named after the vault into the folder `destDir`, as the job `job`. */
export async function rpcVaultExportToFolder(
  id: string,
  request: VaultExportRequest,
  destDir: string,
  job: string,
): Promise<VaultExportResult> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_EXPORT, {
    id,
    format: request.format,
    password: request.password,
    sevenZip: request.sevenZip,
    includeWorkspace: request.include?.workspace,
    includeSettings: request.include?.settings,
    destDir,
    job,
  });
  const written = parseVaultExportResult(raw);
  if (!written) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_export: expected path+size",
      raw,
    );
  }
  return written;
}

/**
 * Clear what a crash left from a job: the vaults an import never finished and
 * the unfinished export files. `folders` are the picked folders that hold one
 * and are not mounted now.
 */
export async function rpcVaultUnfinishedSweep(): Promise<{ folders: string[] }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_UNFINISHED_SWEEP, {});
  const record = requireRecord(raw, "vault_unfinished_sweep");
  const folders = Array.isArray(record.folders) ? record.folders : [];
  return { folders: folders.filter((folder) => typeof folder === "string") };
}

/** Each import runs as the job `job`; a stop removes the vault it was making. */
export async function rpcVaultImportZip(
  input: CreateVaultInput,
  job: string,
): Promise<VaultListItem> {
  const pkg = input.importPackage;
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_IMPORT_ZIP, {
    settings: input.settings,
    archivePath: pkg?.archivePath,
    contentB64: pkg?.contentB64,
    job,
  });
  return parseVaultResult(raw, "vault_import_zip");
}

export async function rpcVaultImport7z(
  input: CreateVaultInput,
  job: string,
): Promise<VaultListItem> {
  const pkg = input.importPackage;
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_IMPORT_7Z, {
    settings: input.settings,
    password: input.password,
    unlockPreset: input.unlockPreset,
    archivePath: pkg?.archivePath,
    contentB64: pkg?.contentB64,
    archivePassword: pkg?.archivePassword ?? input.password,
    keepWorkspace: pkg?.keepWorkspace,
    welcome: input.welcome,
    job,
  });
  return parseVaultResult(raw, "vault_import_7z");
}

export async function rpcVaultImportFilesZip(
  input: CreateVaultInput,
  job: string,
): Promise<VaultListItem> {
  const pkg = input.importPackage;
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_IMPORT_FILES_ZIP, {
    settings: input.settings,
    password: input.password,
    unlockPreset: input.unlockPreset,
    archivePath: pkg?.archivePath,
    contentB64: pkg?.contentB64,
    keepWorkspace: pkg?.keepWorkspace,
    welcome: input.welcome,
    job,
  });
  return parseVaultResult(raw, "vault_import_files_zip");
}

export async function rpcVaultImportOsPath(
  input: CreateVaultInput,
  job: string,
): Promise<VaultListItem> {
  const pkg = input.importPackage;
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_IMPORT_OS_PATH, {
    settings: input.settings,
    password: input.password,
    unlockPreset: input.unlockPreset,
    archivePath: pkg?.archivePath,
    welcome: input.welcome,
    job,
  });
  return parseVaultResult(raw, "vault_import_os_path");
}

/** A `.7z` password test runs as the job `job`; a zip is read at once and takes none. */
export async function rpcVaultImportProbe(params: {
  archivePath?: string;
  contentB64?: string;
  archivePassword?: string;
  kind?: string;
  job?: string;
}): Promise<{
  ok: boolean;
  kind: string;
  embedded: ReturnType<typeof parseEmbeddedVaultSettings>;
  carriesWorkspace: boolean;
  vaultName: string | null;
}> {
  const raw = await desktopInvokeRaw(
    CORE_RPC_COMMANDS.VAULT_IMPORT_PROBE,
    params,
    vaultImportProbeTimeoutMs(params),
  );
  const record = requireRecord(raw, "vault_import_probe");
  return {
    ok: record.ok === true,
    kind: typeof record.kind === "string" ? record.kind : "store_zip",
    embedded: parseEmbeddedVaultSettings(record),
    carriesWorkspace: record.carriesWorkspace === true,
    vaultName: typeof record.vaultName === "string" ? record.vaultName : null,
  };
}

export async function rpcVaultFsList(id: string): Promise<{ tree: unknown; revision: number }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_LIST, { id });
  const record = requireRecord(raw, "vault_fs_list");
  return { tree: record.tree, revision: requireRevision(raw, "vault_fs_list") };
}

export async function rpcVaultFsRevision(id: string): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_REVISION, { id }),
    "vault_fs_revision",
  );
}

/** Raw `vault_fs_held` answer; `parseHeldItems` reads it. */
export async function rpcVaultFsHeld(id: string): Promise<unknown> {
  return requireRecord(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_HELD, { id }),
    "vault_fs_held",
  );
}

export async function rpcVaultFsHeldRestore(
  id: string,
  names: string[],
): Promise<{ paths: string[]; revision: number }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_HELD_RESTORE, { id, names });
  const paths = requireRecord(raw, "vault_fs_held_restore").paths;
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_fs_held_restore: expected paths",
      raw,
    );
  }
  return { paths, revision: requireRevision(raw, "vault_fs_held_restore") };
}

export async function rpcVaultFsHeldDelete(id: string, names: string[]): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_HELD_DELETE, { id, names }),
    "vault_fs_held_delete",
  );
}

export async function rpcVaultFsRead(id: string, path: string): Promise<{ contentB64: string }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_READ, { id, path });
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
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_WRITE, { id, path, contentB64 }),
    "vault_fs_write",
  );
}

export async function rpcVaultFsReadRange(
  id: string,
  path: string,
  offset: number,
  len: number,
): Promise<{ contentB64: string }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_READ_RANGE, {
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
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_WRITE_RANGE, {
      id,
      path,
      offset,
      contentB64,
    }),
    "vault_fs_write_range",
  );
}

/** Copy one file into the vault as the job `job`; a stop leaves nothing of it. */
export async function rpcVaultFsImportOsFile(
  id: string,
  parentPath: string,
  name: string,
  osPath: string,
  job: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_IMPORT_OS_FILE, {
      id,
      parentPath,
      name,
      osPath,
      job,
    }),
    "vault_fs_import_os_file",
  );
}

export async function rpcVaultFsTruncate(id: string, path: string, size: number): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_TRUNCATE, { id, path, size }),
    "vault_fs_truncate",
  );
}

export async function rpcVaultFsCreateFile(
  id: string,
  parentPath: string,
  name: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_CREATE_FILE, { id, parentPath, name }),
    "vault_fs_create_file",
  );
}

export async function rpcVaultFsCreateFolder(
  id: string,
  parentPath: string,
  name: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_CREATE_FOLDER, { id, parentPath, name }),
    "vault_fs_create_folder",
  );
}

export async function rpcVaultFsEnsureFolder(
  id: string,
  parentPath: string,
  name: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_ENSURE_FOLDER, { id, parentPath, name }),
    "vault_fs_ensure_folder",
  );
}

export async function rpcVaultFsDelete(id: string, path: string): Promise<number> {
  return requireRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_DELETE, { id, path }),
    "vault_fs_delete",
  );
}

export async function rpcVaultFsRename(
  id: string,
  path: string,
  newName: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_RENAME, { id, path, newName }),
    "vault_fs_rename",
  );
}

export async function rpcVaultFsMove(
  id: string,
  fromPath: string,
  toFolderPath: string,
): Promise<{ path: string; revision: number }> {
  return requirePathRevision(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_MOVE, { id, fromPath, toFolderPath }),
    "vault_fs_move",
  );
}

export async function rpcVaultFsOsPath(id: string, path: string): Promise<OsFolderAnswer> {
  return parseOsFolderAnswer(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_OS_PATH, { id, path }),
  );
}

export async function rpcVaultFsPreviewFits(id: string, path: string): Promise<{ fits: boolean }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_FS_PREVIEW_FITS, { id, path });
  return { fits: requireRecord(raw, "vault_fs_preview_fits").fits === true };
}

export async function rpcVaultPlainSend(id: string, paths: string[]): Promise<{ files: number }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_SEND, { id, paths });
  return { files: requireCount(raw, "files", "vault_plain_send") };
}

export async function rpcVaultPlainUnsend(id: string, paths: string[]): Promise<FolderRemoval> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.VAULT_PLAIN_UNSEND, { id, paths });
  return {
    removed: requireCount(raw, "removed", "vault_plain_unsend"),
    kept: requireCount(raw, "kept", "vault_plain_unsend"),
  };
}

/** Open the vault mount (Finder / Explorer / desktop file manager) at `path`. */
export async function rpcRevealInFileManager(vaultId: string, path: string): Promise<void> {
  await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.REVEAL_IN_FILE_MANAGER, { vaultId, path });
}

/** Open an absolute OS path in Finder / Explorer / the desktop file manager. */
export async function rpcRevealOsPath(path: string): Promise<void> {
  await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.REVEAL_OS_PATH, { path });
}

/** Open a system terminal at the vault mount path (cwd = folder, or parent of a file). */
export async function rpcOpenInTerminal(vaultId: string, path: string): Promise<void> {
  await desktopInvokeRaw(SHELL_ONLY_RPC_COMMANDS.OPEN_IN_TERMINAL, { vaultId, path });
}

export async function rpcBackupList(id: string): Promise<VaultBackupListing> {
  return parseBackupListing(await desktopInvokeRaw(CORE_RPC_COMMANDS.BACKUP_LIST, { id }));
}

export async function rpcBackupDelete(id: string, keys: readonly string[]): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.BACKUP_DELETE, { id, keys: [...keys] });
}

export async function rpcBackupPromote(id: string, key: string): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.BACKUP_PROMOTE, { id, key });
}

export async function rpcBackupRename(
  id: string,
  key: string,
  name: string,
): Promise<VaultBackupEntry> {
  return parseBackupEntry(
    await desktopInvokeRaw(CORE_RPC_COMMANDS.BACKUP_RENAME, { id, key, name }),
  );
}

export async function rpcBackupFolderForget(id: string, folder: string): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.BACKUP_FOLDER_FORGET, { id, folder });
}

export async function rpcBackupSave(id: string, job: string): Promise<VaultBackupSaved> {
  return parseBackupSaved(await desktopInvokeRaw(CORE_RPC_COMMANDS.BACKUP_SAVE, { id, job }));
}

/** Zip the whole `.upriv` into `<name>.zip` inside `destDir`, as the job `job`. */
export async function rpcDataFolderExport(
  destDir: string,
  name: string,
  includeBackups: boolean,
  job: string,
): Promise<{ path: string; size: number }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.DATA_FOLDER_EXPORT, {
    destDir,
    name,
    includeBackups,
    job,
  });
  const written = parsePathWriteResult(raw);
  if (!written) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "data_folder_export: expected path+size",
      raw,
    );
  }
  return written;
}

export async function rpcJobStatus(job: string): Promise<JobProgress | null> {
  return parseJobStatus(await desktopInvokeRaw(CORE_RPC_COMMANDS.JOB_STATUS, { job }));
}

export async function rpcJobCancel(job: string, by: JobStopBy): Promise<void> {
  await desktopInvokeRaw(CORE_RPC_COMMANDS.JOB_CANCEL, { job, by });
}

/** Copy the backups named by `keys` into `destDir`, as the job `job`. */
export async function rpcBackupExport(
  id: string,
  keys: readonly string[],
  destDir: string,
  job: string,
): Promise<{ path: string; size: number }> {
  const raw = await desktopInvokeRaw(CORE_RPC_COMMANDS.BACKUP_EXPORT, {
    id,
    keys: [...keys],
    destDir,
    job,
  });
  const written = parsePathWriteResult(raw);
  if (!written) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "backup_export: expected path+size",
      raw,
    );
  }
  return written;
}
