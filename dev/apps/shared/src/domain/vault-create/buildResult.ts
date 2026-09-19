import {
  createVaultChoosesKdf,
  DEFAULT_SEVEN_ZIP,
  normalizeVaultSettingsConfig,
} from "../vault-settings";
import { normalizeStoredName } from "../format/storedName";
import { displayNameToVaultId } from "../vault/displayName";
import type { CreateVaultDraft, CreateVaultGroupAssignment, CreateVaultResult } from "./types";

export function resolveCreateVaultGroupAssignment(
  draft: CreateVaultDraft,
): CreateVaultGroupAssignment {
  if (draft.groupMode === "create") {
    return { kind: "create", displayName: normalizeStoredName(draft.groupName) };
  }
  if (draft.groupMode === "existing" && draft.groupId.trim()) {
    return { kind: "existing", groupId: draft.groupId.trim() };
  }
  return { kind: "none" };
}

export function buildCreateVaultResult(
  draft: CreateVaultDraft,
  existingIds: readonly string[],
): CreateVaultResult {
  const vaultId = displayNameToVaultId(draft.displayName, existingIds);
  const displayName = normalizeStoredName(draft.displayName);

  const settings = normalizeVaultSettingsConfig({
    vault: {
      id: vaultId,
      display_name: displayName,
      order: draft.order,
      password_hint: draft.passwordHint.trim(),
      note: draft.note.trim(),
      hidden: draft.hidden,
    },
    storage: { ...draft.storage },
    mount: { ...draft.mount },
    backup: { ...draft.backup },
    security: {
      mode: draft.security.mode,
      secure_wipe_workspace: draft.security.secure_wipe_workspace,
      wipe_passes: 1,
      wipe_pattern: "random",
    },
    auto_close: { ...draft.auto_close },
    seven_zip: { ...DEFAULT_SEVEN_ZIP },
    policy: { ...draft.policy },
  });

  return {
    vaultId,
    displayName,
    note: draft.note.trim(),
    passwordHint: draft.passwordHint.trim(),
    order: draft.order,
    storageMode: settings.storage.mode,
    settings,
    unlockPreset: createVaultChoosesKdf(draft) ? draft.kdf.unlock_preset : undefined,
    groupAssignment: resolveCreateVaultGroupAssignment(draft),
    source: draft.source ?? "scratch",
  };
}
