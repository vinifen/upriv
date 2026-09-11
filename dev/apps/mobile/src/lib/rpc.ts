import {
  CORE_RPC_COMMANDS,
  CORE_RPC_TIMEOUT_MS,
  RpcError,
  isRpcError,
  normalizeAppSettings,
  parseAppLogFile,
  parseDefaultRootStatus,
  parseVaultGroupListResult,
  parseVaultGroupWire,
  parseVaultRootInspect,
  parseVaultRootResolve,
  type AppLogFile,
  type AppSettingsConfig,
  type DefaultRootStatusResult,
  type VaultGroup,
  type VaultGroupCreateInput,
  type VaultGroupListResult,
  type VaultGroupUpdateInput,
  type VaultRootAliasInfo,
  type VaultRootBootstrapPrefs,
  type VaultRootInspectResult,
  type VaultRootMode,
  type VaultRootResolveResult,
} from "@upriv/shared";
import { getUprivCoreNative } from "upriv-core";

const BRIDGE = {
  INVALID_RESPONSE: "invalid_response",
  BRIDGE_INVOKE_FAILED: "bridge_invoke_failed",
  RPC_TIMEOUT: "rpc_timeout",
} as const;

const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;

function unwrapInvokeEnvelope(envelope: unknown): unknown {
  if (typeof envelope !== "object" || envelope === null) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "invoke: expected envelope object", envelope);
  }
  const record = envelope as { ok?: unknown; result?: unknown; error?: unknown };
  if (record.ok === true) {
    return record.result;
  }
  if (
    typeof record.error === "object" &&
    record.error !== null &&
    typeof (record.error as { code?: unknown }).code === "string" &&
    typeof (record.error as { message?: unknown }).message === "string"
  ) {
    const err = record.error as { code: string; message: string; details?: unknown };
    throw new RpcError(err.code, err.message, err.details);
  }
  throw new RpcError(BRIDGE.INVALID_RESPONSE, "invoke: malformed error envelope", envelope);
}

function invokeFailure(error: unknown): RpcError {
  if (isRpcError(error)) return error;
  return new RpcError(
    BRIDGE.BRIDGE_INVOKE_FAILED,
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Call CORE RPC through UniFFI `invoke`. Same envelope as desktop daemon.
 * Honors `CORE_RPC_TIMEOUT_MS` / `LOADING_BUDGET_MS` like desktop `desktopInvokeRaw`.
 * @throws {RpcError}
 */
export async function nativeInvokeRaw(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = (CORE_RPC_TIMEOUT_MS as Record<string, number | undefined>)[method] ??
    DEFAULT_INVOKE_TIMEOUT_MS,
): Promise<unknown> {
  const native = getUprivCoreNative();
  if (!native) {
    throw new RpcError(BRIDGE.BRIDGE_INVOKE_FAILED, "UprivCore native module not loaded");
  }

  const paramsJson = JSON.stringify(params ?? {});
  const invocation = Promise.resolve(native.invoke(method, paramsJson)).then((raw) => {
    try {
      return unwrapInvokeEnvelope(JSON.parse(raw));
    } catch (error) {
      throw invokeFailure(error);
    }
  });

  if (timeoutMs <= 0) {
    try {
      return await invocation;
    } catch (error) {
      throw invokeFailure(error);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  invocation.catch(() => undefined);
  try {
    return await Promise.race([
      invocation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new RpcError(BRIDGE.RPC_TIMEOUT, `invoke timeout after ${timeoutMs}ms: ${method}`),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    throw invokeFailure(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function rpcAppSettingsGet(): Promise<{
  settings: AppSettingsConfig;
  rootPath: string | null;
  onDisk: boolean;
}> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.APP_SETTINGS_GET);
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "app_settings_get: expected object", raw);
  }
  const record = raw as Record<string, unknown>;
  return {
    settings: normalizeAppSettings(record.settings as AppSettingsConfig),
    rootPath: typeof record.rootPath === "string" ? record.rootPath : null,
    onDisk: record.onDisk === true,
  };
}

export async function rpcAppSettingsSave(
  settings: AppSettingsConfig,
  options?: { syncAlias?: boolean },
): Promise<{ wrote: boolean }> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.APP_SETTINGS_SAVE, {
    settings,
    syncAlias: options?.syncAlias ?? true,
  });
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { wrote?: unknown }).wrote !== "boolean"
  ) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "app_settings_save: expected { wrote }", raw);
  }
  return { wrote: (raw as { wrote: boolean }).wrote };
}

/**
 * Pure `settings.toml` → `AppSettingsConfig` parse (no disk access).
 *
 * Used by the Android SAF flow: Kotlin reads the TOML body through the
 * DocumentFile bridge, Rust owns the `TOML → wire` mapping so mobile and
 * desktop stay identical downstream of the wire shape.
 */
export async function rpcAppSettingsParseToml(toml: string): Promise<AppSettingsConfig> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.APP_SETTINGS_PARSE_TOML, { toml });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "app_settings_parse_toml: expected object", raw);
  }
  const settings = (raw as { settings?: unknown }).settings;
  if (typeof settings !== "object" || settings === null) {
    throw new RpcError(
      BRIDGE.INVALID_RESPONSE,
      "app_settings_parse_toml: expected { settings }",
      raw,
    );
  }
  return normalizeAppSettings(settings as AppSettingsConfig);
}

/**
 * Pure `AppSettingsConfig` → `settings.toml` serialization preserving
 * `[package]` from `previousToml` (when provided). `[app].last_opened_vault`
 * comes from `settings` (empty clears). Symmetric with
 * [`rpcAppSettingsParseToml`] for the Android SAF flow.
 */
export async function rpcAppSettingsSerializeToml(
  settings: AppSettingsConfig,
  previousToml?: string | null,
): Promise<string> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.APP_SETTINGS_SERIALIZE_TOML, {
    settings,
    previous: previousToml ?? null,
  });
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { toml?: unknown }).toml !== "string"
  ) {
    throw new RpcError(
      BRIDGE.INVALID_RESPONSE,
      "app_settings_serialize_toml: expected { toml }",
      raw,
    );
  }
  return (raw as { toml: string }).toml;
}

export async function rpcVaultRootResolve(options?: {
  vaultRootMode?: VaultRootMode;
  explicitPath?: string | null;
  binaryDir?: string | null;
}): Promise<VaultRootResolveResult> {
  return parseVaultRootResolve(
    await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_RESOLVE, {
      vaultRootMode: options?.vaultRootMode ?? "default_root",
      explicitPath: options?.explicitPath ?? null,
      binaryDir: options?.binaryDir ?? null,
    }),
  );
}

export async function rpcVaultRootSetupDefaultRoot(options?: {
  replaceIncomplete?: boolean;
  replacePolicy?: "delete" | "rename";
  bootstrap?: VaultRootBootstrapPrefs | null;
}): Promise<{ rootPath: string }> {
  const replaceIncomplete = options?.replaceIncomplete ?? false;
  if (replaceIncomplete && options?.replacePolicy == null) {
    throw new RpcError(
      BRIDGE.INVALID_RESPONSE,
      "replacePolicy is required when replaceIncomplete is true",
    );
  }
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_SETUP_DEFAULT_ROOT, {
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
      BRIDGE.INVALID_RESPONSE,
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
      BRIDGE.INVALID_RESPONSE,
      "replacePolicy is required when replaceIncomplete is true",
    );
  }
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_SETUP_PATH, {
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
      BRIDGE.INVALID_RESPONSE,
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
  await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_DEACTIVATE_ALIAS);
}

export async function rpcVaultRootReadAlias(): Promise<VaultRootAliasInfo | null> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_READ_ALIAS);
  if (raw === null || raw === undefined) return null;
  if (
    typeof raw !== "object" ||
    typeof (raw as { path?: unknown }).path !== "string" ||
    typeof (raw as { active?: unknown }).active !== "boolean"
  ) {
    throw new RpcError(
      BRIDGE.INVALID_RESPONSE,
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
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_SUGGESTED_CUSTOM_PATH);
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { path?: unknown }).path !== "string"
  ) {
    throw new RpcError(
      BRIDGE.INVALID_RESPONSE,
      "vault_root_suggested_custom_path: expected { path }",
      raw,
    );
  }
  return (raw as { path: string }).path;
}

export async function rpcVaultRootDefaultRootStatus(): Promise<DefaultRootStatusResult> {
  return parseDefaultRootStatus(
    await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_DEFAULT_ROOT_STATUS),
  );
}

export async function rpcVaultRootInspectPath(path: string): Promise<VaultRootInspectResult> {
  return parseVaultRootInspect(
    await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_ROOT_INSPECT_PATH, { path }),
  );
}

function parseAppLogFileOrThrow(raw: unknown): AppLogFile {
  try {
    return parseAppLogFile(raw);
  } catch (error) {
    throw new RpcError(
      BRIDGE.INVALID_RESPONSE,
      error instanceof Error ? error.message : "log file: invalid shape",
      raw,
    );
  }
}

export async function rpcLogList(): Promise<AppLogFile[]> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.LOG_LIST);
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as { files?: unknown }).files)
  ) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "log_list: expected { files }", raw);
  }
  return (raw as { files: unknown[] }).files.map(parseAppLogFileOrThrow);
}

export async function rpcLogGet(filename: string): Promise<AppLogFile | undefined> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.LOG_GET, { filename });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "log_get: expected object", raw);
  }
  const file = (raw as { file?: unknown }).file;
  if (file === null || file === undefined) return undefined;
  return parseAppLogFileOrThrow(file);
}

export async function rpcLogDelete(filenames: readonly string[]): Promise<void> {
  await nativeInvokeRaw(CORE_RPC_COMMANDS.LOG_DELETE, { filenames: [...filenames] });
}

export async function rpcLogEvent(
  event: "vault_hidden" | "vault_group_hidden" | "ui_crash",
): Promise<void> {
  await nativeInvokeRaw(CORE_RPC_COMMANDS.LOG_EVENT, { event });
}

/**
 * Vault-group RPC helpers are wired ahead of live mobile vault ids on disk.
 * Keep them ready so group UI can switch from mock storage once vault list/core
 * integration is activated on mobile release builds.
 */
export async function rpcVaultGroupList(): Promise<VaultGroupListResult> {
  return parseVaultGroupListResult(await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_LIST));
}

export async function rpcVaultGroupCreate(input: VaultGroupCreateInput): Promise<VaultGroup> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_CREATE, {
    id: input.id,
    displayName: input.displayName,
    groupedVaults: input.groupedVaults ?? [],
    groupedVaultSort: input.groupedVaultSort,
    groupedVaultSortDirection: input.groupedVaultSortDirection,
    hidden: input.hidden,
  });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "vault_group_create: expected object", raw);
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupUpdate(input: VaultGroupUpdateInput): Promise<VaultGroup> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_UPDATE, {
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
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "vault_group_update: expected object", raw);
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupDelete(id: string): Promise<void> {
  await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_DELETE, { id });
}

export async function rpcVaultGroupSetCollapsed(
  id: string,
  collapsed: boolean,
): Promise<VaultGroup> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_SET_COLLAPSED, { id, collapsed });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "vault_group_set_collapsed: expected object", raw);
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupReorder(
  orders: { id: string; order: number }[],
): Promise<VaultGroup[]> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_REORDER, { orders });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "vault_group_reorder: expected object", raw);
  }
  const groups = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) {
    throw new RpcError(BRIDGE.INVALID_RESPONSE, "vault_group_reorder: expected groups array", raw);
  }
  return groups.map(parseVaultGroupWire);
}

export async function rpcVaultGroupReorderGroupedVaults(
  id: string,
  groupedVaults: string[],
): Promise<VaultGroup> {
  const raw = await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_REORDER_GROUPED_VAULTS, {
    id,
    groupedVaults,
  });
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE.INVALID_RESPONSE,
      "vault_group_reorder_grouped_vaults: expected object",
      raw,
    );
  }
  return parseVaultGroupWire((raw as { group?: unknown }).group);
}

export async function rpcVaultGroupRepair(): Promise<void> {
  await nativeInvokeRaw(CORE_RPC_COMMANDS.VAULT_GROUP_REPAIR);
}
