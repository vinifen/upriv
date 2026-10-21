import type { DataFolderService } from "@upriv/shared";
import { rpcDataFolderExport } from "@/lib/rpc";

/** Desktop → daemon `data_folder_export`. Progress and stop go through the job service. */
export const desktopDataFolderService: DataFolderService = {
  exportTo: (destDir, name, job) => rpcDataFolderExport(destDir, name, job),
};
