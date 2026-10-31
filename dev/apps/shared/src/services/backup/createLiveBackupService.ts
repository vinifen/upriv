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
  saveNow: (vaultId: string, job: string) => Promise<VaultBackupEntry>;
  exportTo: (
    vaultId: string,
    keys: readonly string[],
    destDir: string,
    job: string,
  ) => Promise<VaultPathWriteResult>;
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
    saveNow: (vaultId, job) => rpc.saveNow(vaultId, job),
    exportTo: (vaultId, keys, destDir, job) => rpc.exportTo(vaultId, keys, destDir, job),
  };
}
