import { RpcError } from "../../domain/core-rpc/errors";
import { delayMs } from "../../domain/timing/delay";
import { VAULT_ERROR_CODES } from "../../domain/vault/errors/codes";
import type { VaultStorage } from "../../domain/vault-settings";
import { setMockVaultUnlockPreset } from "../vault/mockVaultHeaderKdf";
import type { VaultSecurityService } from "./VaultSecurityService";

/**
 * Expo Go only. Reports success without rewriting `store/`. Live desktop and
 * native factories call `vault_change_password`, `vault_password_change_finish`,
 * `vault_change_kdf`, `vault_change_storage`, `vault_key_copies_update`,
 * `vault_key_status`, and `vault_rebuild`. A mock
 * vault's header and index always open, so a rebuild is refused.
 */
const MOCK_WRONG_PASSWORD = "wrong";
const MOCK_CHANGE_PASSWORD_MS = 700;
const MOCK_CHANGE_KDF_MS = 900;
const MOCK_CHANGE_STORAGE_MS = 600;
const MOCK_REBUILD_MS = 500;

function rejectWrongPassword(password: string): void {
  if (password.trim() === MOCK_WRONG_PASSWORD) {
    throw new RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD, "mock: wrong vault password");
  }
}

export interface MockVaultSecurityHooks {
  /** Expo Go stamps `password_changed_at` on the in-memory config. */
  onPasswordChanged?: (vaultId: string) => void;
  /** Expo Go reads the storage value of the in-memory config. */
  storageOf?: (vaultId: string) => VaultStorage | null;
  /** Expo Go writes the stored value into the in-memory config. */
  onStorageChanged?: (vaultId: string, storage: VaultStorage) => void;
}

export function createMockVaultSecurityService(
  hooks?: MockVaultSecurityHooks,
): VaultSecurityService {
  return {
    async changePassword(vaultId, input) {
      await delayMs(MOCK_CHANGE_PASSWORD_MS);
      rejectWrongPassword(input.currentPassword);
      hooks?.onPasswordChanged?.(vaultId);
      return {
        backup: null,
        backupSkipped: input.backUpFirst ? "no_room" : "off",
        unreadable: 0,
        keyCopies: "done",
      };
    },
    async finishPasswordChange(_vaultId, input) {
      await delayMs(MOCK_CHANGE_PASSWORD_MS);
      rejectWrongPassword(input.password);
      return { unreadable: 0, keyCopies: "done" };
    },
    async changeKdfPreset(vaultId, input) {
      await delayMs(MOCK_CHANGE_KDF_MS);
      rejectWrongPassword(input.currentPassword);
      setMockVaultUnlockPreset(vaultId, input.nextPreset);
      return { keyCopies: "done" };
    },
    async changeStorage(vaultId, input) {
      const current = hooks?.storageOf?.(vaultId);
      if (
        current &&
        current.mode === input.storage.mode &&
        current.plain_files === input.storage.plain_files
      ) {
        throw new RpcError(VAULT_ERROR_CODES.STORAGE_UNCHANGED, "mock: the storage is this one");
      }
      await delayMs(MOCK_CHANGE_STORAGE_MS);
      rejectWrongPassword(input.password);
      hooks?.onStorageChanged?.(vaultId, input.storage);
      return { storage: input.storage };
    },
    async updateKeyCopies() {
      return "done";
    },
    async keyStatus() {
      return null;
    },
    async rebuildIndex(_vaultId, input) {
      await delayMs(MOCK_REBUILD_MS);
      rejectWrongPassword(input.password);
      throw new RpcError(VAULT_ERROR_CODES.INDEX_READABLE, "mock: the index opens");
    },
  };
}
