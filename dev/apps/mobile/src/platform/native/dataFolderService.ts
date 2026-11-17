import type { DataFolderService } from "@upriv/shared";
import { rpcDataFolderExport } from "@/lib/rpc";
import { nativeExportTrees } from "./exportTrees";

/**
 * Export data folder on the phone: Native → `upriv-ffi` `data_folder_export`.
 * A picked folder is reached at its tree's root, so Rust writes the zip
 * straight into it.
 */
export const nativeDataFolderService: DataFolderService = {
  exportTo: (destDir, name, includeBackups, job) =>
    nativeExportTrees.withExportFolder(destDir, job, (dir) =>
      rpcDataFolderExport(dir, name, includeBackups, job),
    ),
};
