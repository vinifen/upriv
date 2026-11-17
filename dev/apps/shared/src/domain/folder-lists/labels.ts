import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";
import type { ChoiceName } from "./switches";
import { NOTHING_SELECTED, type DeviceGroup, type FolderRow, type Selection } from "./types";

/** Any `t` of the UI. */
export type ListTranslate = (key: I18nKey, params?: I18nParams) => string;

const FIXED_CHOICE_KEYS: Record<string, I18nKey> = {
  default: "folder_list.choice.default",
  beside: "folder_list.choice.beside",
  inherit: "folder_list.choice.inherit",
  data_folder: "folder_list.choice.data_folder",
};

/** A row's label: its name, or "Folder N". */
export function rowLabel(row: Pick<FolderRow, "number" | "name">, t: ListTranslate): string {
  return row.name.trim() || t("folder_list.row.unnamed", { number: row.number });
}

/** A fixed choice's label. */
export function fixedChoiceLabel(choice: string, t: ListTranslate): string {
  const key = FIXED_CHOICE_KEYS[choice];
  return key ? t(key) : choice;
}

/** A choice as a switch or Info names it. */
export function choiceNameLabel(choice: ChoiceName, t: ListTranslate): string {
  switch (choice.kind) {
    case "row":
      return rowLabel(choice, t);
    case "fixed":
      return fixedChoiceLabel(choice.choice, t);
    case "nothing":
      return t("folder_list.choice.none");
  }
}

/** What `selection` names in `group`: a row's label, a fixed choice, or nothing. */
export function selectionLabel<F extends string>(
  selection: Selection<F>,
  group: DeviceGroup<F> | undefined,
  t: ListTranslate,
): string {
  if (selection === NOTHING_SELECTED) return t("folder_list.choice.none");
  if (typeof selection === "number") {
    const row = group?.rows.find((candidate) => candidate.number === selection);
    return row ? rowLabel(row, t) : t("folder_list.row.unnamed", { number: selection });
  }
  return fixedChoiceLabel(selection, t);
}
