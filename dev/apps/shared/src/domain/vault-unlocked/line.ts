import type { I18nKey } from "../../i18n/catalog";
import type { StorageMode } from "../vault/types";
import { plainFolderClassI18nKey } from "../vault-plain/parse";
import type { UnlockedDestination } from "./types";

/** A line naming where files will appear, and the warning that goes with it. */
export interface UnlockedFolderLine {
  key: I18nKey;
  params?: Record<string, string>;
  /** Removable, network, or cloud: plain text written there leaves this computer's own disk. */
  warning: I18nKey | null;
}

/**
 * The unlock window's line, shown before the password. A plain-text vault
 * names the folder its files will be written to; with none chosen the window
 * asks where first, and with none answering the open is refused before the
 * window, so neither has a line. An encrypted vault names the folder it will
 * be mounted at while its folder is on, and says so when none is chosen or
 * none answers: it still opens, in the file manager. `null` when the window
 * shows no line.
 */
export function unlockFolderLine(
  answer: UnlockedDestination,
  mode: StorageMode,
): UnlockedFolderLine | null {
  const plain = mode === "upriv_plain";
  switch (answer.outcome) {
    case "off":
      return null;
    case "unset":
      return plain ? null : { key: "unlock.folder.mount_unset", warning: null };
    case "folder":
      return plain
        ? {
            key: "unlock.folder.plain",
            params: { path: answer.path },
            warning: answer.class ? plainFolderClassI18nKey(answer.class) : null,
          }
        : { key: "unlock.folder.mount", params: { path: answer.path }, warning: null };
    case "unavailable":
      return plain
        ? null
        : { key: "unlock.folder.mount_unavailable", params: { path: answer.path }, warning: null };
  }
}

/**
 * The note under the Storage screen's plain-text option: the folder the
 * files would be written to on this device, to check before turning plain
 * text on. `null` when the lookup gave nothing to name.
 */
export function plainFolderNote(answer: UnlockedDestination): UnlockedFolderLine | null {
  switch (answer.outcome) {
    case "off":
      return null;
    case "unset":
      return { key: "modal.storage.note.unset", warning: null };
    case "folder":
      return {
        key: "modal.storage.note.folder",
        params: { path: answer.path },
        warning: answer.class ? plainFolderClassI18nKey(answer.class) : null,
      };
    case "unavailable":
      return {
        key: "modal.storage.note.unavailable",
        params: { path: answer.path },
        warning: null,
      };
  }
}
