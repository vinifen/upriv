import { RpcError } from "../core-rpc/errors";
import { parseOsNames } from "../device";
import {
  DATA_FOLDER_LIST,
  parseChoiceName,
  parseDeviceGroups,
  parseFolderState,
  parseOneSwitch,
} from "../folder-lists";
import type {
  AppDistribution,
  DataFolderApplied,
  DataFolderListView,
  DataFolderSearchResult,
  VaultRootPrivateRoot,
  VaultRootRelocateNotice,
  VaultRootResolveResult,
  VaultRootResolveSource,
} from "./types";

const INVALID_RESPONSE = "invalid_response";

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, `${label}: expected object`, raw);
  }
  return raw as Record<string, unknown>;
}

/** The names of the vaults that ended with a lost data folder (`ended`). */
function parseEnded(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === "string")
    : [];
}

function parseSource(value: unknown): VaultRootResolveSource | null {
  return value === "explicit" || value === "default" || value === "row" ? value : null;
}

function relocateFields(record: Record<string, unknown>): {
  relocateNotice?: VaultRootRelocateNotice;
  relocatePath?: string;
} {
  const notice = record.relocateNotice;
  const relocatePath = record.relocatePath;
  if (
    (notice === "left_behind" || notice === "move_failed") &&
    typeof relocatePath === "string" &&
    relocatePath.trim().length > 0
  ) {
    return { relocateNotice: notice, relocatePath };
  }
  return {};
}

export function parseVaultRootPrivateRoot(value: unknown): VaultRootPrivateRoot | undefined {
  if (value === "none" || value === "moved" || value === "left_behind") return value;
  return undefined;
}

function isAppDistribution(value: unknown): value is AppDistribution {
  return value === "portable" || value === "installed" || value === "dev";
}

/** Parse `vault_root_resolve`. Shared by desktop and mobile RPC. */
export function parseVaultRootResolve(raw: unknown): VaultRootResolveResult {
  const record = asRecord(raw, "vault_root_resolve");
  const relocate = relocateFields(record);
  if (record.status === "found") {
    const source = parseSource(record.source);
    if (typeof record.rootPath !== "string" || !source) {
      throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: invalid found", raw);
    }
    return { status: "found", rootPath: record.rootPath, source, ...relocate };
  }
  if (record.status === "needs_setup") {
    if (typeof record.defaultRootAnchor !== "string" || !isAppDistribution(record.distribution)) {
      throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: invalid needs_setup", raw);
    }
    return {
      status: "needs_setup",
      defaultRootAnchor: record.defaultRootAnchor,
      distribution: record.distribution,
      ended: parseEnded(record.ended),
      ...relocate,
    };
  }
  if (record.status === "selected_failed") {
    const choice = parseChoiceName(record.choice);
    if (!choice) {
      throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: invalid choice", raw);
    }
    return {
      status: "selected_failed",
      choice,
      reason: parseFolderState(record.reason),
      ended: parseEnded(record.ended),
      ...relocate,
    };
  }
  throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: unknown status", raw);
}

/** Parse `data_folder_list`. */
export function parseDataFolderList(raw: unknown): DataFolderListView {
  const record = asRecord(raw, "data_folder_list");
  const list = asRecord(record.list ?? {}, "data_folder_list list");
  return {
    groups: parseDeviceGroups(list.devices, DATA_FOLDER_LIST),
    osNames: parseOsNames(list.os_names),
    defaultFolder: typeof record.defaultFolder === "string" ? record.defaultFolder : null,
    explicit: typeof record.explicit === "string" ? record.explicit : null,
  };
}

/** Parse `data_folder_size`: the bytes of every file in the data folder's `.upriv`. */
export function parseDataFolderSize(raw: unknown): number {
  const { bytes } = asRecord(raw, "data_folder_size");
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    throw new RpcError(INVALID_RESPONSE, "data_folder_size: bytes is not a size", raw);
  }
  return bytes;
}

/** Parse `data_folder_apply`. */
export function parseDataFolderApplied(raw: unknown): DataFolderApplied {
  const record = asRecord(raw, "data_folder_apply");
  const source = parseSource(record.source);
  if (typeof record.rootPath !== "string" || !source) {
    throw new RpcError(INVALID_RESPONSE, "data_folder_apply: invalid result", raw);
  }
  const privateRoot = parseVaultRootPrivateRoot(record.privateRoot);
  return {
    rootPath: record.rootPath,
    source,
    switched: record.switched === true,
    ...(privateRoot ? { privateRoot } : {}),
    ended: parseEnded(record.ended),
  };
}

/** Parse `data_folder_search`. */
export function parseDataFolderSearch(raw: unknown): DataFolderSearchResult {
  const record = asRecord(raw, "data_folder_search");
  return {
    found: record.found === true,
    switch: parseOneSwitch(record.switch),
    ended: parseEnded(record.ended),
  };
}
