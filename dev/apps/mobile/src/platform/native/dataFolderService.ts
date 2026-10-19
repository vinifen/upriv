import {
  DATA_FOLDER_EXPORT_ERROR_CODES,
  LOADING_BUDGET_MS,
  RpcError,
  isSafContentUri,
  type DataFolderExportProgress,
  type DataFolderService,
  type VaultPathWriteResult,
} from "@upriv/shared";
import {
  rpcDataFolderExport,
  rpcDataFolderExportCancel,
  rpcDataFolderExportStatus,
} from "@/lib/rpc";
import { SAF_EXPORT_ROOT } from "./androidVaultHome";
import { mountSafExport, safReleaseImportTree, unmountSafExport } from "./safVaultRoot";

/** How often an ended call asks whether core still runs the export. */
const SETTLE_POLL_MS = 1_000;

/** Bridge calls the adapter uses. Injected so tests run without Android. */
export interface NativeDataFolderIo {
  exportTo(destDir: string): Promise<VaultPathWriteResult>;
  exportProgress(): Promise<DataFolderExportProgress | null>;
  cancelExport(): Promise<boolean>;
  /** Mount Rust `/upriv-saf-export` on a picked `content://` tree. Throws when it cannot. */
  mountExportTree(treeUri: string): void;
  unmountExportTree(): void;
  /** Drop the access the folder picker took. The data folder's grant is never dropped. */
  releaseTree(treeUri: string): void;
  /** Defaults to a timer. */
  wait?(ms: number): Promise<void>;
}

function timer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Export data folder on the phone.
 *
 * A picked `content://` folder is mounted at `/upriv-saf-export` for one
 * export, so Rust writes the zip straight into it. Nothing is staged in app
 * storage. The mount and the picker's access are dropped only once core no
 * longer runs the export: after a timed-out call, core may still be removing
 * its partial zip through that mount. A filesystem path goes to Rust as it is.
 */
export function createNativeDataFolderService(io: NativeDataFolderIo): DataFolderService {
  const wait = io.wait ?? timer;
  /** The tree mounted for the running export. */
  let mounted: string | null = null;

  const untilCoreIdle = async (): Promise<void> => {
    const deadline = Date.now() + LOADING_BUDGET_MS.dataFolderExport;
    while (Date.now() < deadline) {
      let running: DataFolderExportProgress | null;
      try {
        running = await io.exportProgress();
      } catch {
        return;
      }
      if (!running) return;
      await wait(SETTLE_POLL_MS);
    }
  };

  return {
    async exportTo(destDir) {
      const target = destDir.trim();
      if (!isSafContentUri(target)) return io.exportTo(target);
      if (mounted !== null) {
        // Mounting another tree would send the running export's writes there.
        throw new RpcError(
          DATA_FOLDER_EXPORT_ERROR_CODES.EXPORT_BUSY,
          "a data folder export is running",
        );
      }
      mounted = target;
      try {
        io.mountExportTree(target);
      } catch (error) {
        mounted = null;
        io.releaseTree(target);
        throw error;
      }
      try {
        return await io.exportTo(SAF_EXPORT_ROOT);
      } finally {
        await untilCoreIdle();
        io.unmountExportTree();
        io.releaseTree(target);
        mounted = null;
      }
    },
    exportProgress: () => io.exportProgress(),
    cancelExport: () => io.cancelExport(),
    releaseDestination(destDir) {
      const target = destDir.trim();
      if (!isSafContentUri(target) || target === mounted) return;
      io.releaseTree(target);
    },
  };
}

/** Native → `upriv-ffi` `data_folder_export*` with the picked folder mounted. */
export const nativeDataFolderService = createNativeDataFolderService({
  exportTo: (destDir) => rpcDataFolderExport(destDir),
  exportProgress: () => rpcDataFolderExportStatus(),
  cancelExport: () => rpcDataFolderExportCancel(),
  mountExportTree: (treeUri) => mountSafExport(treeUri),
  unmountExportTree: () => unmountSafExport(),
  releaseTree: (treeUri) => safReleaseImportTree(treeUri),
});
