/**
 * Vault-root draft gate (Data folder Apply / Setup·Repair·Recovery Continue).
 *
 * Rich-field pattern:
 * 1. Validate as soon as the user changes the control (radio, folder pick, …).
 * 2. Render extra choices under that option — not as a separate modal step.
 * 3. Keep side-effects in draft until the confirm step (inspect / choose policy only;
 *    disk mutations happen in the modal via `setup*` then Context reload).
 * 4. Block the primary action only while **that field is dirty and unresolved**.
 * 5. Switching away from an option discards its pending extra choices.
 * 6. Mark the unresolved option with `PolicyRadioOption` `attention` (amber
 *    border) while `blocksPrimary` is true.
 * 7. Side-effect reminders go in `confirmNotes` (i18n keys) for
 *    `VaultRootConfirmFooter` — wording follows `primaryAction`.
 *
 * System Settings no longer hosts vault-root mode/path — that lives in
 * `VaultRootDataFolderModal` (⋯ → Data folder).
 */

import type { I18nKey, IncompleteReplacePolicy } from "@upriv/shared";

/** Continue (blocking gates) vs Apply (Data folder). */
export type VaultRootConfirmAction = "continue" | "apply";

/** Disk check outcome for the current draft vault-root mode/path. */
export type VaultRootDiskStatus =
  | "checking"
  | "ready"
  /** Default_root or custom_root with no `.upriv` yet — confirm will create it. */
  | "will_create"
  | "incomplete"
  | "unreadable"
  | "needs_folder";

export interface VaultRootSettingsGate {
  /** True while the primary action must stay disabled (unresolved draft). */
  blocksPrimary: boolean;
  /** i18n keys listed under the confirm step while this draft applies. */
  confirmNotes?: readonly I18nKey[];
  /** Set when incomplete `.upriv/` must be replaced on confirm. */
  replacePolicy?: IncompleteReplacePolicy;
  disk: VaultRootDiskStatus;
}

export const VAULT_ROOT_GATE_IDLE: VaultRootSettingsGate = {
  blocksPrimary: false,
  disk: "ready",
};

export function isVaultRootDraftDirty(
  draftMode: string,
  draftPath: string,
  savedMode: string,
  savedPath: string,
): boolean {
  return draftMode !== savedMode || draftPath.trim() !== savedPath.trim();
}

function confirmNoteKeys(
  primaryAction: VaultRootConfirmAction,
  kind: "delete" | "rename" | "create",
): I18nKey {
  if (primaryAction === "apply") {
    return `modal.data_folder.apply_confirm_note.${kind}`;
  }
  return `modal.vault_root_gate.continue_confirm_note.${kind}`;
}

/** Confirm-step notes for an incomplete replace policy (Repair / gates). */
export function confirmNotesForReplacePolicy(
  policy: IncompleteReplacePolicy | null | undefined,
  primaryAction: VaultRootConfirmAction = "continue",
): readonly I18nKey[] | undefined {
  if (policy === "delete") return [confirmNoteKeys(primaryAction, "delete")] as const;
  if (policy === "rename") return [confirmNoteKeys(primaryAction, "rename")] as const;
  return undefined;
}

export function vaultRootGateFromState(args: {
  dirty: boolean;
  disk: VaultRootDiskStatus;
  replacePolicy: IncompleteReplacePolicy | null;
  /** @default "continue" */
  primaryAction?: VaultRootConfirmAction;
}): VaultRootSettingsGate {
  const { dirty, disk, replacePolicy, primaryAction = "continue" } = args;
  if (!dirty) {
    return { blocksPrimary: false, disk: "ready" };
  }
  if (disk === "checking" || disk === "unreadable" || disk === "needs_folder") {
    return { blocksPrimary: true, disk };
  }
  if (disk === "incomplete") {
    return {
      blocksPrimary: replacePolicy == null,
      disk,
      replacePolicy: replacePolicy ?? undefined,
      confirmNotes: confirmNotesForReplacePolicy(replacePolicy, primaryAction),
    };
  }
  if (disk === "will_create") {
    return {
      blocksPrimary: false,
      disk,
      replacePolicy: undefined,
      confirmNotes: [confirmNoteKeys(primaryAction, "create")] as const,
    };
  }
  // ready
  return {
    blocksPrimary: false,
    disk,
    replacePolicy: undefined,
  };
}
