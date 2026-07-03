import {
  normalizeLastAccessedIso,
  type VaultListItem,
  type VaultService,
  type StorageMode,
} from "@upriv/shared";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { mapRawVaultConfig, mergeVaultSettings, type RawVaultConfig } from "./mapVaultConfig";
import {
  clearPendingVaultSettings,
  getPendingVaultSettings,
  getPendingVaultStorageMode,
  isVaultConfigMissingError,
  setPendingVaultSettings,
} from "./pendingVaultSettings";
import { resolveVaultRootPath } from "./vaultRoot";

interface VaultListRowDto {
  id: string;
  displayName: string;
  persistence: "closed" | "sealed";
  session: "open" | "closing" | "recovery" | null;
  storageMode: StorageMode;
  order?: number;
  passwordHint?: string;
  canSeal: boolean;
  hidden?: boolean;
  note: string;
  lastAccessedAt?: string;
}

const storageModeByVaultId = new Map<string, StorageMode>();

function formatLastAccessed(iso: string | undefined): { lastAccessedAt: string; lastAccessedWhen: string } {
  // Normalize to canonical ISO-8601 (core may emit the legacy `"<secs>Z"` form).
  // The friendly, locale-aware label is computed at render time from `lastAccessedAt`.
  const lastAccessedAt = normalizeLastAccessedIso(iso);
  return { lastAccessedAt, lastAccessedWhen: "" };
}

function mapListRow(row: VaultListRowDto): VaultListItem {
  storageModeByVaultId.set(row.id, row.storageMode);
  return {
    id: row.id,
    displayName: row.displayName,
    persistence: row.persistence,
    session: row.session,
    storageMode: row.storageMode,
    order: row.order,
    passwordHint: row.passwordHint,
    canSeal: row.canSeal,
    hidden: row.hidden,
    note: row.note ?? "",
    ...formatLastAccessed(row.lastAccessedAt),
  };
}

export function getVaultStorageMode(vaultId: string): StorageMode | undefined {
  return storageModeByVaultId.get(vaultId) ?? getPendingVaultStorageMode(vaultId);
}

export function createTauriVaultService(): VaultService {
  return {
    async listVaults() {
      const vaultRoot = await resolveVaultRootPath();
      const rows = await tauriInvoke<VaultListRowDto[]>(TAURI_COMMANDS.VAULT_LIST, {
        vaultRoot,
      });
      return rows.map(mapListRow);
    },

    async getSettings(vaultId) {
      const pending = getPendingVaultSettings(vaultId);
      if (pending) {
        return pending;
      }

      const vaultRoot = await resolveVaultRootPath();
      const raw = await tauriInvoke<RawVaultConfig>(TAURI_COMMANDS.VAULT_CONFIG_GET, {
        vaultRoot,
        vaultId,
      });
      return mapRawVaultConfig(raw);
    },

    async registerSettings(vaultId, config) {
      const vaultRoot = await resolveVaultRootPath();
      try {
        const existing = await tauriInvoke<RawVaultConfig>(TAURI_COMMANDS.VAULT_CONFIG_GET, {
          vaultRoot,
          vaultId,
        });
        const merged = mergeVaultSettings(existing, config);
        await tauriInvoke(TAURI_COMMANDS.VAULT_CONFIG_SAVE, {
          vaultRoot,
          vaultId,
          config: merged,
        });
        clearPendingVaultSettings(vaultId);
        storageModeByVaultId.set(vaultId, config.storage.mode);
      } catch (error) {
        if (!isVaultConfigMissingError(error)) {
          throw error;
        }
        // Create wizard: vault not on disk yet — keep config in RAM until create is wired.
        setPendingVaultSettings(vaultId, config);
        storageModeByVaultId.set(vaultId, config.storage.mode);
      }
    },

    async unregisterSettings(vaultId) {
      const vaultRoot = await resolveVaultRootPath();
      try {
        await tauriInvoke(TAURI_COMMANDS.VAULT_DELETE, { vaultRoot, vaultId });
      } catch (error) {
        if (!isVaultConfigMissingError(error)) {
          throw error;
        }
      }
      clearPendingVaultSettings(vaultId);
      storageModeByVaultId.delete(vaultId);
    },

    async reorderVaults(orderedIds) {
      if (orderedIds.length === 0) return;
      const vaultRoot = await resolveVaultRootPath();
      await tauriInvoke(TAURI_COMMANDS.VAULT_REORDER, {
        vaultRoot,
        orderedIds: [...orderedIds],
      });
    },

    async getArchiveExportBytes(vault) {
      const vaultRoot = await resolveVaultRootPath();
      const bytes = await tauriInvoke<number[]>(TAURI_COMMANDS.VAULT_ARCHIVE_BYTES, {
        vaultRoot,
        vaultId: vault.id,
      });
      return Uint8Array.from(bytes);
    },
  };
}
