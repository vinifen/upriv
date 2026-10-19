import type { I18nKey } from "../../i18n/catalog";
import { isRpcError } from "../core-rpc/errors";

/** Data-folder export wire codes from `upriv-rpc` (`map_core_err`). */
export const DATA_FOLDER_EXPORT_ERROR_CODES = {
  /** A vault is open, closing, or held by other work, so the export cannot start. */
  BUSY: "data_folder_busy",
  /** An export is running. A new vault, an import, and a backup delete or pin wait for it. */
  EXPORT_BUSY: "data_folder_export_busy",
  /** The user stopped the export. Its partial zip was removed. */
  CANCELLED: "data_folder_export_cancelled",
  /** The chosen drive is short of space. `details` carries `needed` and `available`. */
  SPACE_SHORT: "data_folder_export_space_short",
  /** The chosen folder is inside a `.upriv`. */
  DESTINATION_RESERVED: "data_folder_export_destination_reserved",
} as const;

export type DataFolderExportErrorCode =
  (typeof DATA_FOLDER_EXPORT_ERROR_CODES)[keyof typeof DATA_FOLDER_EXPORT_ERROR_CODES];

const DATA_FOLDER_EXPORT_ERROR_I18N_KEYS = {
  [DATA_FOLDER_EXPORT_ERROR_CODES.BUSY]: "error.data_folder_busy",
  [DATA_FOLDER_EXPORT_ERROR_CODES.EXPORT_BUSY]: "error.data_folder_export_busy",
  [DATA_FOLDER_EXPORT_ERROR_CODES.CANCELLED]: "error.data_folder_export_cancelled",
  [DATA_FOLDER_EXPORT_ERROR_CODES.SPACE_SHORT]: "error.data_folder_export_space_short",
  [DATA_FOLDER_EXPORT_ERROR_CODES.DESTINATION_RESERVED]:
    "error.data_folder_export_destination_reserved",
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

/** The user stopped the export: not a failure to report. */
export function isDataFolderExportCancelled(error: unknown): boolean {
  return isRpcError(error) && error.code === DATA_FOLDER_EXPORT_ERROR_CODES.CANCELLED;
}
