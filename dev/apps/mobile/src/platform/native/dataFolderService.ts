import {
  DATA_FOLDER_EXPORT_ERROR_CODES,
  LOADING_BUDGET_MS,
  RpcError,
  isSafContentUri,
  type DataFolderService,
  type JobProgress,
  type VaultPathWriteResult,
} from "@upriv/shared";
import { rpcDataFolderExport, rpcJobStatus } from "@/lib/rpc";
import { SAF_EXPORT_ROOT } from "./androidVaultHome";
import { mountSafExport, safReleaseImportTree, unmountSafExport } from "./safVaultRoot";

/** How often an ended call asks whether core still runs the export. */
const SETTLE_POLL_MS = 1_000;

/** Bridge calls the adapter uses. Injected so tests run without Android. */
export interface NativeDataFolderIo {
  exportTo(destDir: string, name: string, job: string): Promise<VaultPathWriteResult>;
  /** `job_status` of that export: `null` once core no longer runs it. */
  jobStatus(job: string): Promise<JobProgress | null>;
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
 * storage. The mount is dropped only once core no longer runs the export:
 * after a timed-out call, core may still be removing its partial zip through
 * that mount. The picker's access belongs to the Data folder window, which
 * keeps the folder for the next export; when it lets the folder go during an
 * export, the access is dropped once that export ends. A filesystem path goes
 * to Rust as it is.
 */
export function createNativeDataFolderService(io: NativeDataFolderIo): DataFolderService {
  const wait = io.wait ?? timer;
  /** The tree mounted for the running export. */
  let mounted: string | null = null;
  /** The window let the mounted tree go; it is released when the export ends. */
  let releaseWhenDone = false;

  const untilJobEnds = async (job: string): Promise<void> => {
    const deadline = Date.now() + LOADING_BUDGET_MS.dataFolderExport;
    while (Date.now() < deadline) {
      let running: JobProgress | null;
      try {
        running = await io.jobStatus(job);
      } catch {
        return;
      }
      if (!running) return;
      await wait(SETTLE_POLL_MS);
    }
  };

  return {
    async exportTo(destDir, name, job) {
      const target = destDir.trim();
      if (!isSafContentUri(target)) return io.exportTo(target, name, job);
      if (mounted !== null) {
        // Mounting another tree would send the running export's writes there.
        throw new RpcError(
          DATA_FOLDER_EXPORT_ERROR_CODES.EXPORT_BUSY,
          "a data folder export is running",
        );
      }
      mounted = target;
      releaseWhenDone = false;
      try {
        io.mountExportTree(target);
      } catch (error) {
        // The window still holds the pick; it can try again or choose another.
        mounted = null;
        throw error;
      }
      try {
        return await io.exportTo(SAF_EXPORT_ROOT, name, job);
      } finally {
        await untilJobEnds(job);
        io.unmountExportTree();
        mounted = null;
        if (releaseWhenDone) io.releaseTree(target);
        releaseWhenDone = false;
      }
    },
    releaseDestination(destDir) {
      const target = destDir.trim();
      if (!isSafContentUri(target)) return;
      if (target === mounted) {
        releaseWhenDone = true;
        return;
      }
      io.releaseTree(target);
    },
  };
}

/** Native → `upriv-ffi` `data_folder_export` with the picked folder mounted. */
export const nativeDataFolderService = createNativeDataFolderService({
  exportTo: (destDir, name, job) => rpcDataFolderExport(destDir, name, job),
  jobStatus: (job) => rpcJobStatus(job),
  mountExportTree: (treeUri) => mountSafExport(treeUri),
  unmountExportTree: () => unmountSafExport(),
  releaseTree: (treeUri) => safReleaseImportTree(treeUri),
});
