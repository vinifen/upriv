import type { DataFolderService } from "@upriv/shared";
import {
  rpcDataFolderExport,
  rpcDataFolderExportCancel,
  rpcDataFolderExportStatus,
} from "@/lib/rpc";

/** Desktop → daemon `data_folder_export*`. */
export const desktopDataFolderService: DataFolderService = {
  exportTo: (destDir) => rpcDataFolderExport(destDir),
  exportProgress: () => rpcDataFolderExportStatus(),
  cancelExport: () => rpcDataFolderExportCancel(),
};
