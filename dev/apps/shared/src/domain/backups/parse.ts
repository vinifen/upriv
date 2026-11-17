import { RpcError } from "../core-rpc/errors";
import { parseDeviceRef } from "../device";
import { parseFolderState, parseSwitches } from "../folder-lists";
import type {
  BackupSectionKind,
  VaultBackupEntry,
  VaultBackupListing,
  VaultBackupSaved,
  VaultBackupSection,
} from "./types";

const INVALID_RESPONSE = "invalid_response";

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) {
    throw new RpcError(INVALID_RESPONSE, `${label}: expected object`, raw);
  }
  return raw as Record<string, unknown>;
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** One `backup_list` entry, as `backup_rename` also answers. */
export function parseBackupEntry(raw: unknown): VaultBackupEntry {
  const record = asRecord(raw, "backup");
  if (typeof record.key !== "string" || !record.key) {
    throw new RpcError(INVALID_RESPONSE, "backup: expected key", raw);
  }
  return {
    key: record.key,
    stamp: text(record.stamp),
    fileName: text(record.fileName),
    name: text(record.name),
    createdAt: text(record.createdAt),
    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : 0,
    saved: record.saved === true,
    path: text(record.path),
    lowerUnlockRam: record.lowerUnlockRam === true,
  };
}

const SECTION_KINDS = new Set<BackupSectionKind>(["data_folder", "in_use", "other"]);

function parseSection(raw: unknown): VaultBackupSection {
  const record = asRecord(raw, "backup section");
  const kind = SECTION_KINDS.has(record.kind as BackupSectionKind)
    ? (record.kind as BackupSectionKind)
    : "other";
  const device =
    typeof record.device === "object" && record.device !== null
      ? (record.device as Record<string, unknown>)
      : null;
  return {
    folder: text(record.folder),
    kind,
    path: text(record.path),
    device: device ? parseDeviceRef(device.id, device.system) : null,
    status: parseFolderState(record.status),
    entries: Array.isArray(record.entries) ? record.entries.map(parseBackupEntry) : [],
  };
}

/** `backup_list`. */
export function parseBackupListing(raw: unknown): VaultBackupListing {
  const record = asRecord(raw, "backup_list");
  if (!Array.isArray(record.sections)) {
    throw new RpcError(INVALID_RESPONSE, "backup_list: expected sections", raw);
  }
  return { sections: record.sections.map(parseSection) };
}

/** `backup_save`. */
export function parseBackupSaved(raw: unknown): VaultBackupSaved {
  const record = asRecord(raw, "backup_save");
  return { backup: parseBackupEntry(record.backup), switches: parseSwitches(record.switches) };
}
