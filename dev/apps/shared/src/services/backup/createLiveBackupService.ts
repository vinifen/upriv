import type {
  BackupFolderStatus,
  VaultBackupListing,
  VaultBackupSaved,
} from "../../domain/backups";
import type { BackupService } from "./BackupService";

export interface VaultPathWriteResult {
  path: string;
  size: number;
}

export interface LiveBackupRpc {
  listBackups: (vaultId: string) => Promise<VaultBackupListing>;
  deleteBackups: (vaultId: string, stamps: readonly string[]) => Promise<void>;
  promoteToSave: (vaultId: string, stamp: string) => Promise<void>;
  saveNow: (vaultId: string, job: string) => Promise<VaultBackupSaved>;
  exportTo: (
    vaultId: string,
    keys: readonly string[],
    destDir: string,
    job: string,
  ) => Promise<VaultPathWriteResult>;
  checkFolder: (path: string, vaultId: string | null) => Promise<BackupFolderStatus>;
  reuseFolder: (vaultId: string) => Promise<void>;
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
    checkFolder: (path, vaultId) => rpc.checkFolder(path, vaultId),
    reuseFolder: (vaultId) => rpc.reuseFolder(vaultId),
  };
}
