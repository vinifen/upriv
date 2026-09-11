import { RpcError } from "../core-rpc/errors";
import type {
  AppDistribution,
  DefaultRootStatusResult,
  VaultRootInspectResult,
  VaultRootResolveResult,
  VaultRootResolveSource,
} from "./types";

const INVALID_RESPONSE = "invalid_response";

function normalizeVaultRootSource(value: unknown): VaultRootResolveSource | null {
  if (value === "explicit" || value === "custom_root" || value === "default_root") return value;
  return null;
}

function isAppDistribution(value: unknown): value is AppDistribution {
  return value === "portable" || value === "installed" || value === "dev";
}

function isVaultRootDirStatus(value: unknown): value is DefaultRootStatusResult["status"] {
  return (
    value === "absent" ||
    value === "valid" ||
    value === "incomplete" ||
    value === "unreadable" ||
    value === "unauthorized"
  );
}

/** Parse `vault_root_resolve` wire. Shared by desktop and mobile RPC. */
export function parseVaultRootResolve(raw: unknown): VaultRootResolveResult {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: expected object", raw);
  }
  const record = raw as Record<string, unknown>;
  if (record.status === "found") {
    const source = normalizeVaultRootSource(record.source);
    if (typeof record.rootPath !== "string" || source == null) {
      throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: invalid found payload", raw);
    }
    return { status: "found", rootPath: record.rootPath, source };
  }
  if (record.status === "needs_setup") {
    const defaultRootAnchor =
      typeof record.defaultRootAnchor === "string" ? record.defaultRootAnchor : null;
    if (
      typeof record.aliasPath !== "string" ||
      defaultRootAnchor == null ||
      !isAppDistribution(record.distribution)
    ) {
      throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: invalid needs_setup payload", raw);
    }
    return {
      status: "needs_setup",
      aliasPath: record.aliasPath,
      defaultRootAnchor,
      distribution: record.distribution,
    };
  }
  throw new RpcError(INVALID_RESPONSE, "vault_root_resolve: unknown status", raw);
}

/** Parse `vault_root_default_root_status` wire. */
export function parseDefaultRootStatus(raw: unknown): DefaultRootStatusResult {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { defaultRootAnchor?: unknown }).defaultRootAnchor !== "string"
  ) {
    throw new RpcError(
      INVALID_RESPONSE,
      "vault_root_default_root_status: expected { status, defaultRootAnchor }",
      raw,
    );
  }
  const status = (raw as { status?: unknown }).status;
  if (!isVaultRootDirStatus(status)) {
    throw new RpcError(INVALID_RESPONSE, "vault_root_default_root_status: invalid status", raw);
  }
  return {
    status,
    defaultRootAnchor: (raw as { defaultRootAnchor: string }).defaultRootAnchor,
  };
}

/** Parse `vault_root_inspect_path` wire. */
export function parseVaultRootInspect(raw: unknown): VaultRootInspectResult {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { path?: unknown }).path !== "string"
  ) {
    throw new RpcError(INVALID_RESPONSE, "vault_root_inspect_path: expected { status, path }", raw);
  }
  const status = (raw as { status?: unknown }).status;
  if (!isVaultRootDirStatus(status)) {
    throw new RpcError(INVALID_RESPONSE, "vault_root_inspect_path: invalid status", raw);
  }
  return { status, path: (raw as { path: string }).path };
}
