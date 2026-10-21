import type { I18nKey } from "../../i18n/catalog";

/** Data-folder export wire codes from `upriv-rpc` (`map_core_err`). */
export const DATA_FOLDER_EXPORT_ERROR_CODES = {
  /** A vault is open, closing, or held by other work, so the export cannot start. */
  BUSY: "data_folder_busy",
  /** An export is running. A new vault, an import, and a backup delete or pin wait for it. */
  EXPORT_BUSY: "data_folder_export_busy",
  /** The chosen drive is short of space. `details` carries `needed` and `available`. */
  SPACE_SHORT: "data_folder_export_space_short",
  /** The zip name is not a file name every system takes (`dataFolderZipNameIssue`). */
  NAME_INVALID: "data_folder_export_name_invalid",
  /** The chosen folder already has `<name>.zip`, or one still being written. Nothing was replaced. */
  NAME_TAKEN: "data_folder_export_name_taken",
} as const;

export type DataFolderExportErrorCode =
  (typeof DATA_FOLDER_EXPORT_ERROR_CODES)[keyof typeof DATA_FOLDER_EXPORT_ERROR_CODES];

const DATA_FOLDER_EXPORT_ERROR_I18N_KEYS = {
  [DATA_FOLDER_EXPORT_ERROR_CODES.BUSY]: "error.data_folder_busy",
  [DATA_FOLDER_EXPORT_ERROR_CODES.EXPORT_BUSY]: "error.data_folder_export_busy",
  [DATA_FOLDER_EXPORT_ERROR_CODES.SPACE_SHORT]: "error.data_folder_export_space_short",
  [DATA_FOLDER_EXPORT_ERROR_CODES.NAME_INVALID]: "error.data_folder_export_name_invalid",
  [DATA_FOLDER_EXPORT_ERROR_CODES.NAME_TAKEN]: "error.data_folder_export_name_taken",
} as const satisfies Record<DataFolderExportErrorCode, I18nKey>;

const DATA_FOLDER_EXPORT_ERROR_CODE_VALUES = new Set<string>(
  Object.values(DATA_FOLDER_EXPORT_ERROR_CODES),
);

export function isDataFolderExportErrorCode(code: string): code is DataFolderExportErrorCode {
  return DATA_FOLDER_EXPORT_ERROR_CODE_VALUES.has(code);
}

export function dataFolderExportErrorI18nKey(code: DataFolderExportErrorCode): I18nKey {
  return DATA_FOLDER_EXPORT_ERROR_I18N_KEYS[code];
}
