import { SIZED_BUDGET_CEILING_MS, type DataFolderService } from "@upriv/shared";
import { rpcDataFolderExport } from "@/lib/rpc";
import { nativeSafExportMount } from "./safExportMount";

/**
 * Export data folder on the phone: Native → `upriv-ffi` `data_folder_export`.
 * A picked folder is mounted for the export, so Rust writes the zip straight
 * into it (`SafExportMount`).
 */
export const nativeDataFolderService: DataFolderService = {
  exportTo: (destDir, name, job) =>
    nativeSafExportMount.withExportFolder(destDir, job, SIZED_BUDGET_CEILING_MS, (dir) =>
      rpcDataFolderExport(dir, name, job),
    ),
};
