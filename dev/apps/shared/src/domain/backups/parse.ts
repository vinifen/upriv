import { RpcError } from "../core-rpc/errors";
import { backupSnapshotFileName } from "./format";
import { parseBackupFolderStatus, type BackupFolderStatus } from "./folders";
import type {
  ChosenBackupFolder,
  VaultBackupEntry,
  VaultBackupListing,
  VaultBackupSaved,
} from "./types";

const INVALID_RESPONSE = "invalid_response";

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, `${label}: expected object`, raw);
  }
  return raw as Record<string, unknown>;
}

function parseEntry(raw: unknown, vaultId: string): VaultBackupEntry {
  const record = asRecord(raw, "backup");
  const stamp = typeof record.stamp === "string" ? record.stamp : "";
  const fromWire = typeof record.fileName === "string" ? record.fileName.trim() : "";
  return {
    stamp,
    fileName: fromWire || backupSnapshotFileName(stamp, vaultId.trim()),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : undefined,
    saved: record.saved === true,
    location: record.location === "chosen" ? "chosen" : "data_folder",
    path: typeof record.path === "string" ? record.path : undefined,
  };
}

function parseChosen(raw: unknown): ChosenBackupFolder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.path !== "string") return null;
  return { path: record.path, status: parseBackupFolderStatus(record.status) ?? "other" };
}

/** `backup_list`. */
export function parseBackupListing(raw: unknown, vaultId: string): VaultBackupListing {
  const record = asRecord(raw, "backup_list");
  if (!Array.isArray(record.backups)) {
    throw new RpcError(INVALID_RESPONSE, "backup_list: expected backups", raw);
  }
  return {
    backups: record.backups.map((entry) => parseEntry(entry, vaultId)),
    chosen: parseChosen(record.chosen),
  };
}

/** `backup_save`. */
export function parseBackupSaved(raw: unknown, vaultId: string): VaultBackupSaved {
  const record = asRecord(raw, "backup_save");
  return {
    backup: parseEntry(record.backup, vaultId),
    fallback: parseBackupFolderStatus(record.fallback),
  };
}

/** `backup_folder_check`. */
export function parseBackupFolderCheck(raw: unknown): BackupFolderStatus {
  return parseBackupFolderStatus(asRecord(raw, "backup_folder_check").status) ?? "other";
}
