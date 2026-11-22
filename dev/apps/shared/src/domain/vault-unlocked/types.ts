import type { FolderState, FolderSwitch } from "../folder-lists";
import type { PlainFolderClass } from "../vault-plain";

/**
 * `vault_unlocked_destination`: where an unlock would put a vault's files on
 * this device, found before the password with nothing made or saved. Core is
 * the source of these fields.
 */
export type UnlockedDestination =
  /** No folder is wanted: an encrypted vault whose folder is off, or a device that mounts none. */
  | { outcome: "off" }
  /** A folder is wanted and none is chosen on this device. */
  | { outcome: "unset" }
  /**
   * The folder the walk lands on. `class` comes for plain text, whose files
   * are written there; `switches` are the selections the unlock would hand over.
   */
  | {
      outcome: "folder";
      path: string;
      class: PlainFolderClass | null;
      switches: FolderSwitch[];
    }
  /** No choice of the chain answers; `path` and `reason` are the selected folder's. */
  | { outcome: "unavailable"; path: string; reason: FolderState };
