import type { VaultSettingsConfig } from "@/features/vault-list/vaultSettingsTypes";
import { displayNameToVaultId } from "@/lib/vaultDisplayName";
import type { CreateVaultDraft, CreateVaultResult } from "./createVaultTypes";

export function buildCreateVaultResult(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
): CreateVaultResult {
  const vaultId = displayNameToVaultId(draft.displayName, existingIds);
  const displayName = draft.displayName.trim();

  const settings: VaultSettingsConfig = {
    vault: {
      id: vaultId,
      display_name: displayName,
      order: draft.order,
      vault_file: `archive/${displayName}.7z`,
      store_dir: "store",
      backups_dir: "backups",
      password_hint: draft.passwordHint.trim(),
      note: draft.note.trim(),
    },
    storage: { ...draft.storage },
    close: { ...draft.close },
    backup: { ...draft.backup },
    security: {
      mode: draft.security.mode,
      secure_wipe_workspace: draft.security.secure_wipe_workspace,
      wipe_passes: 1,
      wipe_pattern: "random",
    },
    auto_close: { ...draft.auto_close },
    seven_zip: {
      encrypt_file_names: draft.seven_zip.encrypt_file_names,
      archive_mode: draft.seven_zip.archive_mode,
      compression_level: 5,
      solid: false,
      method: "lzma2",
    },
    policy: { ...draft.policy },
  };

  return {
    vaultId,
    displayName,
    note: draft.note.trim(),
    passwordHint: draft.passwordHint.trim(),
    order: draft.order,
    storageMode: draft.storage.mode,
    settings,
  };
}
