import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";

export type ImportOutcomeToast = {
  primary: I18nKey;
  primaryCount: number;
  extra: { key: I18nKey; count: number }[];
};

export function formatImportOutcomeToast(
  imported: number,
  skippedInvalid: number,
  skippedUnsupported: number,
  tr: (key: I18nKey, params?: I18nParams) => string,
): string | null {
  const outcome = importOutcomeToast(imported, skippedInvalid, skippedUnsupported);
  if (!outcome) return null;
  let message = tr(outcome.primary, { count: outcome.primaryCount });
  for (const extra of outcome.extra) {
    message += ` ${tr(extra.key, { count: extra.count })}`;
  }
  return message;
}

/** Toast parts after an import batch — never treat skipped binaries as imported. */
export function importOutcomeToast(
  imported: number,
  skippedInvalid: number,
  skippedUnsupported: number,
): ImportOutcomeToast | null {
  if (imported === 0) {
    if (skippedUnsupported === 0 && skippedInvalid === 0) return null;
    if (skippedUnsupported > 0 && skippedInvalid === 0) {
      return {
        primary: "modal.file_manager.toast.import_skipped_unsupported",
        primaryCount: skippedUnsupported,
        extra: [],
      };
    }
    if (skippedInvalid > 0 && skippedUnsupported === 0) {
      return {
        primary: "modal.file_manager.toast.import_skipped_invalid",
        primaryCount: skippedInvalid,
        extra: [],
      };
    }
    return {
      primary: "modal.file_manager.toast.import_skipped_invalid",
      primaryCount: skippedInvalid,
      extra: [
        {
          key: "modal.file_manager.toast.import_skipped_unsupported_suffix",
          count: skippedUnsupported,
        },
      ],
    };
  }
  const extra: ImportOutcomeToast["extra"] = [];
  if (skippedInvalid > 0) {
    extra.push({
      key: "modal.file_manager.toast.import_skipped_suffix",
      count: skippedInvalid,
    });
  }
  if (skippedUnsupported > 0) {
    extra.push({
      key: "modal.file_manager.toast.import_skipped_unsupported_suffix",
      count: skippedUnsupported,
    });
  }
  return {
    primary: "modal.file_manager.toast.imported",
    primaryCount: imported,
    extra,
  };
}
