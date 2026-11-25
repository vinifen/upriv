import type { I18nKey } from "../../i18n/catalog";
import { parseSwitches, type FolderSwitch } from "../folder-lists";

/**
 * The open found the sealed storage value and its copy in `config.toml`
 * disagreeing: the vault opened encrypted with no unlocked folder, and both
 * values went back to the default. `unsaved` when a write failed, so the
 * next unlock writes it.
 */
export type StorageReset = "saved" | "unsaved";

/** What an open did beyond the unlock (core `VaultOpened`). */
export interface VaultOpened {
  /** The unlocked folder selections a plain-text open switched. */
  switches: FolderSwitch[];
  storageReset: StorageReset | null;
  /**
   * The vault's import had been cut off, and this unlock kept what got in:
   * it is a vault like any other now.
   */
  importKept: boolean;
}

/** A `vault_open` answer, from the wire. */
export function parseVaultOpened(raw: unknown): VaultOpened {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const reset = body.storageReset;
  return {
    switches: parseSwitches(body.switches),
    storageReset: reset === "saved" || reset === "unsaved" ? reset : null,
    importKept: body.importKept === true,
  };
}

/** The toast after an open that reset its storage value. */
export function storageResetToastKey(reset: StorageReset): I18nKey {
  return reset === "saved"
    ? "toast.vault_storage_reset.saved"
    : "toast.vault_storage_reset.unsaved";
}
