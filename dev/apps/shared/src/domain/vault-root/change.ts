import { switchMessage, type FolderSwitch, type ListTranslate } from "../folder-lists";

/**
 * What a change of the data folder in use says once it lands: the switch a
 * search made (the folder left, the folder taken, and why), and the vaults
 * that closed with a lost data folder. `null` when there is nothing to say.
 */
export function dataFolderChangeMessage(
  change: FolderSwitch | null,
  ended: readonly string[],
  t: ListTranslate,
): string | null {
  const parts = [
    change ? switchMessage(change, t) : null,
    ended.length > 0
      ? t("modal.vault_root_setup.sessions_ended", { names: ended.join(", ") })
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}
