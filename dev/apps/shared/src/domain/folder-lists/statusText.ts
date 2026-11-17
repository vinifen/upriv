import type { I18nKey } from "../../i18n/catalog";
import { formatBytes } from "../format/bytes";
import { choiceNameLabel, type ListTranslate } from "./labels";
import type { DataFolderStatus, FolderStatus } from "./status";
import { uniqueSwitches, type FolderSwitch, type SwitchList } from "./switches";

/** A row's status line: what to say, and whether it is a problem. */
export interface StatusLine {
  tone: "checking" | "ok" | "problem";
  text: string;
}

const CHECKING = (t: ListTranslate): StatusLine => ({
  tone: "checking",
  text: t("folder_list.status.checking"),
});

/** The status line of an unlocked folder or backup row. `null` while its check runs. */
export function folderStatusLine(
  status: FolderStatus | null,
  list: "unlocked" | "backup",
  t: ListTranslate,
): StatusLine {
  if (!status) return CHECKING(t);
  if (status.state !== "ok")
    return { tone: "problem", text: t(`folder_list.status.${status.state}`) };
  const details = status.details;
  if (!details) return { tone: "ok", text: t("folder_list.status.ok") };
  const parts: string[] = [];
  if (details.freeBytes !== null) {
    parts.push(t("folder_list.details.free", { size: formatBytes(details.freeBytes) }));
  }
  if (list === "unlocked") {
    if (details.openVaults.length > 0) {
      parts.push(t("folder_list.details.open_vaults", { names: details.openVaults.join(", ") }));
    }
    if (details.plainLeft > 0) {
      parts.push(
        details.plainLeft === 1
          ? t("folder_list.details.plain_left_one")
          : t("folder_list.details.plain_left", { count: details.plainLeft }),
      );
    }
    if (details.noEncryptedFolder) {
      return {
        tone: "problem",
        text: [...parts, t("folder_list.details.no_encrypted_folder")].join(" · "),
      };
    }
  } else {
    const size = formatBytes(details.zipBytes);
    parts.push(
      details.zips === 1
        ? t("folder_list.details.zips_one", { size })
        : t("folder_list.details.zips", { count: details.zips, size }),
    );
    if (details.nextZipBytes !== null) {
      const short = details.freeBytes !== null && details.freeBytes < details.nextZipBytes;
      const next = t("folder_list.details.next_zip", { size: formatBytes(details.nextZipBytes) });
      if (short) return { tone: "problem", text: [...parts, next].join(" · ") };
      parts.push(next);
    }
  }
  return { tone: "ok", text: parts.length > 0 ? parts.join(" · ") : t("folder_list.status.ok") };
}

/** The status line of a folder of the data folder list. `null` while its check runs. */
export function dataFolderStatusLine(
  status: DataFolderStatus | null,
  t: ListTranslate,
): StatusLine {
  if (!status) return CHECKING(t);
  if (status.state !== "ok")
    return { tone: "problem", text: t(`folder_list.status.${status.state}`) };
  switch (status.content) {
    case "valid":
      return {
        tone: "ok",
        text: !status.details
          ? t("folder_list.data_folder.valid")
          : status.details.vaults === 1
            ? t("folder_list.data_folder.valid_details_one", {
                size: formatBytes(status.details.sizeBytes),
              })
            : t("folder_list.data_folder.valid_details", {
                count: status.details.vaults,
                size: formatBytes(status.details.sizeBytes),
              }),
      };
    case "empty":
      return { tone: "ok", text: t("folder_list.data_folder.empty") };
    case "incomplete":
      return { tone: "problem", text: t("folder_list.data_folder.incomplete") };
    case "unreadable":
      return { tone: "problem", text: t("folder_list.data_folder.unreadable") };
    default:
      return { tone: "ok", text: t("folder_list.status.ok") };
  }
}

const SWITCH_KEYS = {
  data_folder: { app: "folder_list.switch.data_folder_app", vault: null },
  unlocked_folder: {
    app: "folder_list.switch.unlocked_folder_app",
    vault: "folder_list.switch.unlocked_folder_vault",
  },
  backup: { app: "folder_list.switch.backup_app", vault: "folder_list.switch.backup_vault" },
} as const satisfies Record<SwitchList, Record<FolderSwitch["level"], I18nKey | null>>;

/**
 * A switch as its toast says it: the list, the vault for a vault's list,
 * the choice left, the choice taken, and why. `vaultName` names a vault by
 * its id.
 */
export function switchMessage(
  change: FolderSwitch,
  t: ListTranslate,
  vaultName: (vaultId: string) => string = (vaultId) => vaultId,
): string {
  const key = SWITCH_KEYS[change.list][change.level] ?? SWITCH_KEYS[change.list].app;
  const text = t(key, {
    from: choiceNameLabel(change.from, t),
    to: choiceNameLabel(change.to, t),
    reason: t(`folder_list.status.${change.reason}`),
    vault: change.vault ? vaultName(change.vault) : "",
  });
  return change.saved ? text : `${text} ${t("folder_list.switch.not_saved")}`;
}

/** Every switch of one action in one toast, each once; `null` when there is none. */
export function switchesMessage(
  switches: readonly FolderSwitch[],
  t: ListTranslate,
  vaultName?: (vaultId: string) => string,
): string | null {
  const unique = uniqueSwitches(switches);
  if (unique.length === 0) return null;
  return unique.map((change) => switchMessage(change, t, vaultName)).join(" ");
}
