import { RpcError } from "../core-rpc/errors";
import { normalizeStoredName } from "../format/storedName";
import { parseKdfUnlockPreset, type KdfUnlockPreset } from "../vault-settings/kdf";
import { STORAGE_MODES, type StorageMode, type VaultSession } from "../vault/types";
import type { VaultListItem } from "./types";

const INVALID_RESPONSE = "invalid_response";

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, `${label}: expected object`, raw);
  }
  return raw as Record<string, unknown>;
}

function parseStorageMode(raw: unknown): StorageMode {
  if (raw == null || raw === "") return "encrypted_dir";
  if (typeof raw === "string" && (STORAGE_MODES as readonly string[]).includes(raw)) {
    return raw as StorageMode;
  }
  throw new RpcError(INVALID_RESPONSE, "vault: invalid storageMode", raw);
}

function parseSession(raw: unknown): VaultSession | null {
  if (raw === "open" || raw === "closing" || raw === "recovery") return raw;
  return null;
}

function parseUnlockPreset(raw: unknown): KdfUnlockPreset | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new RpcError(INVALID_RESPONSE, "vault: invalid unlockPreset", raw);
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = parseKdfUnlockPreset(trimmed);
  if (!parsed) {
    throw new RpcError(INVALID_RESPONSE, "vault: invalid unlockPreset", raw);
  }
  return parsed;
}

/** Parse one `vault_list` row (camelCase wire). */
export function parseVaultListItemWire(raw: unknown): VaultListItem {
  const r = asRecord(raw, "vault");
  if (typeof r.id !== "string" || !r.id.trim()) {
    throw new RpcError(INVALID_RESPONSE, "vault: missing id", raw);
  }
  if (typeof r.displayName !== "string" || !r.displayName.trim()) {
    throw new RpcError(INVALID_RESPONSE, "vault: missing displayName", raw);
  }
  const lastAccessedAt = typeof r.lastAccessedAt === "string" ? r.lastAccessedAt : "";
  const passwordHint = typeof r.passwordHint === "string" ? r.passwordHint : "";
  return {
    id: r.id.trim(),
    displayName: normalizeStoredName(r.displayName),
    session: parseSession(r.session),
    storageMode: parseStorageMode(r.storageMode),
    order: typeof r.order === "number" ? r.order : 0,
    passwordHint: passwordHint || undefined,
    hidden: r.hidden === true,
    lastAccessedWhen: "",
    lastAccessedAt,
    note: typeof r.note === "string" ? r.note : "",
    unlockPreset: parseUnlockPreset(r.unlockPreset),
  };
}

export function parseVaultListResult(raw: unknown): VaultListItem[] {
  const r = asRecord(raw, "vault_list");
  if (!Array.isArray(r.vaults)) {
    throw new RpcError(INVALID_RESPONSE, "vault_list: expected vaults array", raw);
  }
  return r.vaults.map(parseVaultListItemWire);
}
