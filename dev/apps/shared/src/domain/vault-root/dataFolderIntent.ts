/**
 * The primary action of Setup (Continue) and of the Data folder window
 * (Apply): what the data folder the list selects still needs before it may
 * run, read from that folder's status (`folder_status` of the data folder
 * list). Disk changes happen only on confirm, in one `data_folder_apply`.
 */

import type { I18nKey } from "../../i18n/catalog";
import type { DataFolderStatus } from "../folder-lists";
import type { IncompleteReplacePolicy } from "./types";

/** Continue (Setup, Repair) vs Apply (Data folder window). */
export type VaultRootConfirmAction = "continue" | "apply";

export interface DataFolderGate {
  /** True while the primary action waits. */
  blocksPrimary: boolean;
  /** The selected choice wears attention: it misses a step the person can take. */
  attention: boolean;
  /** The selected folder holds a broken `.upriv`: a replace choice is its step. */
  needsReplacePolicy: boolean;
  /** Why the selected folder cannot be used, when it cannot. */
  problem?: I18nKey;
  /** Notes listed under the confirm step while this choice applies. */
  confirmNotes?: readonly I18nKey[];
}

export const DATA_FOLDER_GATE_IDLE: DataFolderGate = {
  blocksPrimary: false,
  attention: false,
  needsReplacePolicy: false,
};

function confirmNoteKey(
  primaryAction: VaultRootConfirmAction,
  kind: IncompleteReplacePolicy | "create",
): I18nKey {
  if (primaryAction === "apply") return `modal.data_folder.apply_confirm_note.${kind}`;
  return `modal.vault_root_gate.continue_confirm_note.${kind}`;
}

/** Confirm-step notes for an incomplete replace policy (Repair / gates). */
export function confirmNotesForReplacePolicy(
  policy: IncompleteReplacePolicy | null | undefined,
  primaryAction: VaultRootConfirmAction = "continue",
): readonly I18nKey[] | undefined {
  if (policy == null) return undefined;
  return [confirmNoteKey(primaryAction, policy)];
}

/**
 * The gate for the folder the list selects.
 * - `switching`: the selection names a folder other than the one in use.
 *   Only list edits (names, order, other devices) need no check.
 * - `status`: that folder's status; `null` while its check runs.
 */
export function dataFolderGate(args: {
  switching: boolean;
  status: DataFolderStatus | null;
  replacePolicy: IncompleteReplacePolicy | null;
  primaryAction?: VaultRootConfirmAction;
}): DataFolderGate {
  const { switching, status, replacePolicy, primaryAction = "continue" } = args;
  if (!switching) return DATA_FOLDER_GATE_IDLE;
  // A check still running: no attention yet, and the action waits.
  if (!status) return { blocksPrimary: true, attention: false, needsReplacePolicy: false };
  if (status.state !== "ok") {
    return {
      blocksPrimary: true,
      attention: true,
      needsReplacePolicy: false,
      problem: `folder_list.status.${status.state}`,
    };
  }
  switch (status.content) {
    case "incomplete":
      return {
        blocksPrimary: replacePolicy == null,
        attention: replacePolicy == null,
        needsReplacePolicy: true,
        confirmNotes: confirmNotesForReplacePolicy(replacePolicy, primaryAction),
      };
    case "unreadable":
      return {
        blocksPrimary: true,
        attention: true,
        needsReplacePolicy: false,
        problem: "modal.vault_root_setup.error_io",
      };
    case "empty":
      return {
        blocksPrimary: false,
        attention: false,
        needsReplacePolicy: false,
        confirmNotes: [confirmNoteKey(primaryAction, "create")],
      };
    default:
      return DATA_FOLDER_GATE_IDLE;
  }
}
