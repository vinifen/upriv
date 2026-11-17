import { vaultConfigEditAllowed } from "../edit-policy/policy";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import type { VaultSettingsConfig } from "./types";

/**
 * When gated fields are locked (vault open/opening/closing/creating/queued),
 * keep baseline values so a preferences save can still persist `anytime`
 * fields without sending stale dirty from before the lock. The lists are
 * saved as change sets, which leave out a group the gate locks
 * (`vaultListChanges`).
 */
export function rebaseQuietLockedVaultSettings(
  draft: VaultSettingsConfig,
  baseline: VaultSettingsConfig,
  row: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): VaultSettingsConfig {
  let next = draft;
  if (!vaultConfigEditAllowed("vault.display_name", row, pipeline)) {
    next = {
      ...next,
      vault: { ...next.vault, display_name: baseline.vault.display_name },
    };
  }
  if (!vaultConfigEditAllowed("storage.mode", row, pipeline)) {
    next = {
      ...next,
      storage: { ...next.storage, mode: baseline.storage.mode },
    };
  }
  if (!vaultConfigEditAllowed("unlocked_folder", row, pipeline)) {
    next = {
      ...next,
      unlocked_folder: { ...next.unlocked_folder, encrypted: baseline.unlocked_folder.encrypted },
    };
  }
  if (!vaultConfigEditAllowed("storage.plain_files", row, pipeline)) {
    next = {
      ...next,
      storage: { ...next.storage, plain_files: baseline.storage.plain_files },
    };
  }
  return next;
}
