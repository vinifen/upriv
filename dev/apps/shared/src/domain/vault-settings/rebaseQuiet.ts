import { vaultConfigEditAllowed } from "../edit-policy/policy";
import type { VaultPipelineListStatus, VaultRow } from "../vault/types";
import type { VaultSettingsConfig } from "./types";

/**
 * When quiet-gated fields are locked (vault open/opening/closing), keep baseline
 * values so a preferences save can still persist `anytime` fields without
 * sending stale quiet dirty from before the lock.
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
  if (!vaultConfigEditAllowed("mount.workspace_path", row, pipeline)) {
    next = {
      ...next,
      mount: { ...next.mount, workspace_path: baseline.mount.workspace_path },
    };
  }
  if (!vaultConfigEditAllowed("storage.mode", row, pipeline)) {
    next = {
      ...next,
      storage: { ...next.storage, mode: baseline.storage.mode },
    };
  }
  if (!vaultConfigEditAllowed("security.mode", row, pipeline)) {
    next = {
      ...next,
      security: { ...next.security, mode: baseline.security.mode },
    };
  }
  return next;
}
