import { DAEMON_COMMANDS, SHELL_COMMANDS } from "./commands";
import { BRIDGE_ERROR_CODES, RpcError, isRpcError } from "./errors";
import { desktopInvokeRaw } from "./invoke";
import { parseAppVersionResult, type AppVersionResult } from "./types";
import type {
  AppSettingsConfig,
  NearbyVaultRootStatusResult,
  VaultRootAliasInfo,
  VaultRootInspectResult,
  VaultRootResolveResult,
  VaultRootSource,
} from "@upriv/shared";
import { normalizeAppSettings } from "@upriv/shared";

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

function isVaultRootSource(value: unknown): value is VaultRootSource {
  return value === "explicit" || value === "alias" || value === "nearby";
}

function parseVaultRootResolve(raw: unknown): VaultRootResolveResult {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_resolve: expected object",
      raw,
    );
  }
  const record = raw as Record<string, unknown>;
  if (record.status === "found") {
    if (typeof record.rootPath !== "string" || !isVaultRootSource(record.source)) {
      throw new RpcError(
        BRIDGE_ERROR_CODES.INVALID_RESPONSE,
        "vault_root_resolve: invalid found payload",
        raw,
      );
    }
    return {
      status: "found",
      rootPath: record.rootPath,
      source: record.source,
    };
  }
  if (record.status === "needs_setup") {
    if (typeof record.aliasPath !== "string" || typeof record.nearbyAnchor !== "string") {
      throw new RpcError(
        BRIDGE_ERROR_CODES.INVALID_RESPONSE,
        "vault_root_resolve: invalid needs_setup payload",
        raw,
      );
    }
    return {
      status: "needs_setup",
      aliasPath: record.aliasPath,
      nearbyAnchor: record.nearbyAnchor,
    };
  }
  throw new RpcError(
    BRIDGE_ERROR_CODES.INVALID_RESPONSE,
    "vault_root_resolve: unknown status",
    raw,
  );
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

export async function rpcAppSettingsSave(settings: AppSettingsConfig): Promise<{ wrote: boolean }> {
  const raw = await desktopInvokeRaw(
    DAEMON_COMMANDS.APP_SETTINGS_SAVE,
    settings as unknown as Record<string, unknown>,
  );
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
  autoDetect?: boolean;
  explicitPath?: string | null;
  binaryDir?: string | null;
}): Promise<VaultRootResolveResult> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_RESOLVE, {
    autoDetect: options?.autoDetect ?? true,
    explicitPath: options?.explicitPath ?? null,
    binaryDir: options?.binaryDir ?? null,
  });
  return parseVaultRootResolve(raw);
}

export async function rpcVaultRootSetupNearby(options?: {
  replaceIncomplete?: boolean;
  replacePolicy?: "delete" | "rename";
  locale?: string | null;
}): Promise<{ rootPath: string }> {
  const replaceIncomplete = options?.replaceIncomplete ?? false;
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_SETUP_NEARBY, {
    replaceIncomplete,
    // Required by daemon when replaceIncomplete; default rename (safer than delete).
    ...(replaceIncomplete
      ? { replacePolicy: options?.replacePolicy ?? "rename" }
      : { replacePolicy: options?.replacePolicy ?? null }),
    locale: options?.locale ?? null,
  });
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { rootPath?: unknown }).rootPath !== "string"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_setup_nearby: expected { rootPath }",
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
    locale?: string | null;
  },
): Promise<{ rootPath: string; aliasPath: string }> {
  const replaceIncomplete = options?.replaceIncomplete ?? false;
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_SETUP_PATH, {
    path,
    replaceIncomplete,
    ...(replaceIncomplete
      ? { replacePolicy: options?.replacePolicy ?? "rename" }
      : { replacePolicy: options?.replacePolicy ?? null }),
    locale: options?.locale ?? null,
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

export async function rpcVaultRootRewriteAlias(path: string): Promise<void> {
  await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_REWRITE_ALIAS, { path });
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

export async function rpcVaultRootNearbyStatus(): Promise<NearbyVaultRootStatusResult> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_NEARBY_STATUS);
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { nearbyAnchor?: unknown }).nearbyAnchor !== "string"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_nearby_status: expected { status, nearbyAnchor }",
      raw,
    );
  }
  const status = (raw as { status?: unknown }).status;
  if (
    status !== "absent" &&
    status !== "valid" &&
    status !== "incomplete" &&
    status !== "unreadable"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_nearby_status: invalid status",
      raw,
    );
  }
  return {
    status,
    nearbyAnchor: (raw as { nearbyAnchor: string }).nearbyAnchor,
  };
}

export async function rpcVaultRootInspectPath(path: string): Promise<VaultRootInspectResult> {
  const raw = await desktopInvokeRaw(DAEMON_COMMANDS.VAULT_ROOT_INSPECT_PATH, { path });
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { path?: unknown }).path !== "string"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_inspect_path: expected { status, path }",
      raw,
    );
  }
  const status = (raw as { status?: unknown }).status;
  if (
    status !== "absent" &&
    status !== "valid" &&
    status !== "incomplete" &&
    status !== "unreadable"
  ) {
    throw new RpcError(
      BRIDGE_ERROR_CODES.INVALID_RESPONSE,
      "vault_root_inspect_path: invalid status",
      raw,
    );
  }
  return {
    status,
    path: (raw as { path: string }).path,
  };
}
