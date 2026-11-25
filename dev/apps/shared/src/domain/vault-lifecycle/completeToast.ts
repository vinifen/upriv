import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";
import type { ImportEnding } from "../vault-create/importBlocked";

/** The toast an open or a close that ran in the background ends with. */
export function pipelineCompleteText(
  kind: "open" | "close",
  name: string,
  t: (key: I18nKey, params?: I18nParams) => string,
): string {
  return kind === "open"
    ? t("toast.pipeline_complete_open", { name })
    : t("toast.pipeline_complete_close", { name });
}

/**
 * The toast a create ends with. A create the person stopped says the vault
 * keeps what got in; one that left out items it could not import, as the
 * person chose, counts them.
 */
export function createdVaultText(
  name: string,
  ending: ImportEnding,
  t: (key: I18nKey, params?: I18nParams) => string,
): string {
  if (ending.stopped) return t("toast.pipeline_complete_create_stopped", { name });
  if (ending.leftOut === 1) return t("toast.pipeline_complete_create_left_out_one", { name });
  if (ending.leftOut > 1) {
    return t("toast.pipeline_complete_create_left_out", {
      name,
      count: String(ending.leftOut),
    });
  }
  return t("toast.pipeline_complete_create", { name });
}

/**
 * The toast once the launch sweep removed the vaults whose create or store
 * copy a crash cut off, which held nothing to keep, by name.
 */
export function unfinishedVaultsRemovedText(
  names: readonly string[],
  t: (key: I18nKey, params?: I18nParams) => string,
): string {
  if (names.length === 1) {
    return t("toast.unfinished_vault_removed_one", { name: names[0] ?? "" });
  }
  return t("toast.unfinished_vault_removed", { count: String(names.length) });
}
