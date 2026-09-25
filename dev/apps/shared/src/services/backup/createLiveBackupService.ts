import type { VaultBackupEntry } from "../../domain/backups";
import type { BackupService } from "./BackupService";

export interface VaultPathWriteResult {
  path: string;
  size: number;
}

export interface LiveBackupRpc {
  listBackups: (vaultId: string) => Promise<VaultBackupEntry[]>;
  deleteBackups: (vaultId: string, stamps: readonly string[]) => Promise<void>;
  promoteToSave: (vaultId: string, stamp: string) => Promise<void>;
  getBackupBytes: (vaultId: string, stamp: string) => Promise<Uint8Array>;
  exportToPath: (vaultId: string, stamp: string, destPath: string) => Promise<VaultPathWriteResult>;
  exportSnapshotsToPath: (
    vaultId: string,
    stamps: readonly string[],
    destPath: string,
  ) => Promise<VaultPathWriteResult>;
}

function bytesFromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesFromContentB64(raw: unknown): Uint8Array {
  if (typeof raw !== "object" || raw === null) return new Uint8Array();
  const b64 = (raw as { contentB64?: unknown }).contentB64;
  if (typeof b64 !== "string" || !b64.trim()) return new Uint8Array();
  return bytesFromB64(b64);
}

export function parsePathWriteResult(raw: unknown): VaultPathWriteResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { path?: unknown; size?: unknown };
  if (typeof record.path !== "string" || typeof record.size !== "number") return null;
  return { path: record.path, size: record.size };
}

/** Shared live adapter — desktop daemon and native FFI pass their `rpc*` fns. */
export function createLiveBackupService(rpc: LiveBackupRpc): BackupService {
  return {
    listBackups: (vaultId) => rpc.listBackups(vaultId),
    deleteBackups: (vaultId, stamps) => rpc.deleteBackups(vaultId, stamps),
    promoteToSave: (vaultId, stamp) => rpc.promoteToSave(vaultId, stamp),
    getBackupBytes: (vaultId, entry) => rpc.getBackupBytes(vaultId, entry.stamp),
    exportToPath: (vaultId, entry, destPath) => rpc.exportToPath(vaultId, entry.stamp, destPath),
    exportSnapshotsToPath: (vaultId, stamps, destPath) =>
      stamps.length === 1
        ? rpc.exportToPath(vaultId, stamps[0], destPath)
        : rpc.exportSnapshotsToPath(vaultId, stamps, destPath),
  };
}
