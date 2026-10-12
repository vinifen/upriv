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
 * 6. Mark the unresolved option with `PolicyRadioOption` `attention` while
 *    `blocksPrimary` is true.
 * 7. Side-effect reminders go in `confirmNotes` (i18n keys) for
 *    `VaultRootConfirmFooter` — wording follows `primaryAction`.
 */

import type { I18nKey } from "../../i18n/catalog";
import type { IncompleteReplacePolicy, VaultRootDirStatus } from "./types";

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
  /** SAF permission gone — user must re-pick the folder. */
  | "unauthorized"
  /**
   * Saved folder stays selected, but its volume does not answer.
   * Android SAF inspect is the only producer today (grant still held).
   * iOS security-scoped bookmarks reuse this when the bookmark is still valid
   * and the volume is gone. Desktop does not emit it: a missing path is the
   * same signal as a deleted folder, so that stays alias recovery.
   */
  | "unreachable"
  /**
   * `content://` tree. Vault create and edit need a filesystem path, so this
   * folder must not become the data folder.
   */
  | "not_vault_capable"
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
  kind: IncompleteReplacePolicy | "create",
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
  if (policy == null) return undefined;
  return [confirmNoteKeys(primaryAction, policy)] as const;
}

/** Disk status for an inspect / default-root probe. `valid` is ready to use. */
export function diskFromDirStatus(status: VaultRootDirStatus): VaultRootDiskStatus {
  switch (status) {
    case "incomplete":
      return "incomplete";
    case "unreadable":
      return "unreadable";
    case "unauthorized":
      return "unauthorized";
    case "unreachable":
      return "unreachable";
    case "absent":
      return "will_create";
    case "valid":
      return "ready";
  }
}

/** Copy for a disk check that blocks the primary action. Null when the row has no error. */
export function vaultRootDiskProblemKey(disk: VaultRootDiskStatus): I18nKey | null {
  if (disk === "unauthorized") return "modal.vault_root_setup.error_saf_unauthorized";
  if (disk === "unreachable") return "modal.vault_root_setup.error_unreachable";
  if (disk === "unreadable") return "modal.vault_root_setup.error_io";
  return null;
}

/** Identity of the draft a disk check belongs to. Path whitespace matches dirty checks. */
export function vaultRootDraftKey(mode: string, path: string): string {
  return `${mode}\0${path.trim()}`;
}

/**
 * Disk status for the draft on screen.
 * A result from another mode or path stays hidden until this draft is checked.
 */
export function visibleVaultRootDisk(
  disk: VaultRootDiskStatus,
  checkedKey: string,
  draftKey: string,
  dirty: boolean,
): VaultRootDiskStatus {
  if (!dirty) return "ready";
  if (checkedKey !== draftKey) return "checking";
  return disk;
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
  if (
    disk === "checking" ||
    disk === "unreadable" ||
    disk === "unauthorized" ||
    disk === "unreachable" ||
    disk === "not_vault_capable" ||
    disk === "needs_folder"
  ) {
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
  return {
    blocksPrimary: false,
    disk,
    replacePolicy: undefined,
  };
}
