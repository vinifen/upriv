/**
 * Settings “rich field” pattern (vault-root is the first case).
 *
 * Problem: if every special config waits until Save to ask follow-up questions,
 * the modal footer becomes a serial wizard (vault repair → next field → …).
 *
 * Rule for rich fields:
 * 1. Validate as soon as the user changes the control (radio, folder pick, …).
 * 2. Render extra choices under that option — not in a global Save queue.
 * 3. Keep side-effects in draft until Save (inspect / choose policy only;
 *    disk mutations happen in `replaceSettings` / Context).
 * 4. Block Save only while **that field is dirty and unresolved**.
 *    Unrelated dirty fields (locale, theme) stay saveable if this field was
 *    reverted to the last saved values (or never changed).
 * 5. Switching away from an option discards its pending extra choices.
 * 6. Mark the unresolved option with `PolicyRadioOption` `attention` (amber
 *    border) while `blocksSave` is true so the user sees what still needs input.
 * 7. Side-effect reminders for Save go in `saveConfirmNotes` (i18n keys).
 *    The footer always shows the generic confirm, then appends every note from
 *    every rich-field gate — no per-field confirm steps, no inline “this will
 *    delete now” buttons.
 *
 * **Gate vs Settings confirmation severity:** `VaultRootGate` (setup/repair)
 * confirms destructive delete immediately (inline confirm step) because it
 * mutates disk on Continue. Settings keeps delete/rename/create notes in
 * `saveConfirmNotes` and only applies them on Save — intentional: draft until
 * Save, Gate acts now.
 *
 * When adding another rich setting later, give it a similar gate +
 * `blocksSave` / `saveConfirmNotes` to `AppSettingsModal`.
 */

import type { I18nKey, IncompleteReplacePolicy } from "@upriv/shared";

/** Disk check outcome for the current draft vault-root mode/path. */
export type VaultRootDiskStatus =
  | "checking"
  | "ready"
  /** Nearby or custom with no `.upriv` yet — Save will create it. */
  | "will_create"
  | "incomplete"
  | "unreadable"
  | "needs_folder";

/**
 * Shared slice every rich-field gate should expose to the settings modal.
 * Compose notes from multiple gates via `collectAppSettingsSaveConfirmNotes`.
 */
export interface AppSettingsRichFieldGate {
  blocksSave: boolean;
  /** i18n keys listed under the generic Save confirm while this field applies. */
  saveConfirmNotes?: readonly I18nKey[];
}

export interface VaultRootSettingsGate extends AppSettingsRichFieldGate {
  /** Set when incomplete `.upriv/` must be replaced on Save. */
  replacePolicy?: IncompleteReplacePolicy;
  disk: VaultRootDiskStatus;
}

export const VAULT_ROOT_GATE_IDLE: VaultRootSettingsGate = {
  blocksSave: false,
  disk: "ready",
};

/** Flatten notes from all rich-field gates (order = footer display order). */
export function collectAppSettingsSaveConfirmNotes(
  gates: readonly AppSettingsRichFieldGate[],
): I18nKey[] {
  const notes: I18nKey[] = [];
  for (const gate of gates) {
    if (!gate.saveConfirmNotes) continue;
    for (const key of gate.saveConfirmNotes) {
      if (!notes.includes(key)) notes.push(key);
    }
  }
  return notes;
}

export function isVaultRootDraftDirty(
  draftMode: string,
  draftPath: string,
  savedMode: string,
  savedPath: string,
): boolean {
  return draftMode !== savedMode || draftPath.trim() !== savedPath.trim();
}

export function vaultRootGateFromState(args: {
  dirty: boolean;
  disk: VaultRootDiskStatus;
  replacePolicy: IncompleteReplacePolicy | null;
}): VaultRootSettingsGate {
  const { dirty, disk, replacePolicy } = args;
  if (!dirty) {
    return { blocksSave: false, disk: "ready" };
  }
  if (disk === "checking" || disk === "unreadable" || disk === "needs_folder") {
    return { blocksSave: true, disk };
  }
  if (disk === "incomplete") {
    return {
      blocksSave: replacePolicy == null,
      disk,
      replacePolicy: replacePolicy ?? undefined,
      saveConfirmNotes:
        replacePolicy === "delete"
          ? (["modal.app_settings.save_confirm_note.vault_root_delete"] as const)
          : replacePolicy === "rename"
            ? (["modal.app_settings.save_confirm_note.vault_root_rename"] as const)
            : undefined,
    };
  }
  if (disk === "will_create") {
    return {
      blocksSave: false,
      disk,
      replacePolicy: undefined,
      saveConfirmNotes: ["modal.app_settings.save_confirm_note.vault_root_create"] as const,
    };
  }
  // ready
  return {
    blocksSave: false,
    disk,
    replacePolicy: undefined,
  };
}
