import type { PlainFiles, VaultStorage } from "../vault-settings/types";
import type { KeyChangeReportLine } from "./keyChanges";
import type { StorageMode } from "./types";

/** What `vault_change_storage` stored: the vault's storage value, sealed and copied. */
export interface StorageChangeResult {
  storage: VaultStorage;
}

const MODES = new Set<StorageMode>(["encrypted_dir", "upriv_plain"]);
const PLAIN_FILES = new Set<PlainFiles>(["chosen", "whole"]);

/** A `vault_change_storage` answer, or `null` when it names no storage value. */
export function parseStorageChangeResult(raw: unknown): StorageChangeResult | null {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const storage =
    typeof body.storage === "object" && body.storage !== null
      ? (body.storage as Record<string, unknown>)
      : null;
  if (
    !storage ||
    !MODES.has(storage.mode as StorageMode) ||
    !PLAIN_FILES.has(storage.plain_files as PlainFiles)
  ) {
    return null;
  }
  return {
    storage: { mode: storage.mode as StorageMode, plain_files: storage.plain_files as PlainFiles },
  };
}

/**
 * What a Storage change that ended leaves in its window: the value it
 * stored, or that it stopped with nothing changed. `null` when it failed,
 * since the window shows the error instead.
 */
export function storageChangeReportLines(outcome: {
  result: StorageChangeResult | null;
  stopped: boolean;
}): KeyChangeReportLine[] | null {
  const { result } = outcome;
  if (!result) return outcome.stopped ? [{ key: "vault.change_storage.stopped" }] : null;
  if (result.storage.mode === "encrypted_dir") {
    return [{ key: "vault.change_storage.success_encrypted" }];
  }
  return [
    {
      key:
        result.storage.plain_files === "whole"
          ? "vault.change_storage.success_plain_whole"
          : "vault.change_storage.success_plain_chosen",
    },
  ];
}
