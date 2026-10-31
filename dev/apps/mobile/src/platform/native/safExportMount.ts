import {
  RpcError,
  VAULT_ERROR_CODES,
  isSafContentUri,
  type ExportFolderGrants,
  type JobProgress,
} from "@upriv/shared";
import { rpcJobStatus } from "@/lib/rpc";
import { SAF_EXPORT_ROOT } from "./androidVaultHome";
import { mountSafExport, safReleaseImportTree, unmountSafExport } from "./safVaultRoot";

/** How often an ended call asks whether core still runs its job. */
const SETTLE_POLL_MS = 1_000;

/** Bridge calls the mount uses. Injected so tests run without Android. */
export interface SafExportIo {
  /** `job_status`: `null` once core no longer runs that job. */
  jobStatus(job: string): Promise<JobProgress | null>;
  /** Mount Rust `/upriv-saf-export` on a picked `content://` tree. Throws when it cannot. */
  mountExportTree(treeUri: string): void;
  unmountExportTree(): void;
  /** Drop the access the folder picker took. The data folder's grant is never dropped. */
  releaseTree(treeUri: string): void;
  /** Defaults to a timer. */
  wait?(ms: number): Promise<void>;
}

/**
 * The phone's one export mount, Rust `/upriv-saf-export`, and the grants
 * behind the folders picked for an export. The vault export, the backup
 * export, and Export data folder share it. One export writes through it at a
 * time: a second one into a picked folder is refused with `vault_busy`.
 */
export interface SafExportMount extends ExportFolderGrants {
  /**
   * Run `write` with the folder core writes into: a filesystem path as it is,
   * or `/upriv-saf-export` mounted on a picked `content://` tree, so the file
   * goes straight there and nothing is staged in app storage. The mount is
   * dropped only once core no longer runs `job`, waiting at most `budgetMs`:
   * after a timed-out call core may still be removing its partial file
   * through it.
   */
  withExportFolder<T>(
    destDir: string,
    job: string,
    budgetMs: number,
    write: (dir: string) => Promise<T>,
  ): Promise<T>;
}

function timer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A picked folder's access is dropped once nothing holds it and no export is
 * writing there, so two fields may keep the same folder.
 */
export function createSafExportMount(io: SafExportIo): SafExportMount {
  const wait = io.wait ?? timer;
  /** The tree mounted for the running export. */
  let mounted: string | null = null;
  const holds = new Map<string, number>();

  const releaseIfUnused = (uri: string) => {
    if (uri === mounted || (holds.get(uri) ?? 0) > 0) return;
    io.releaseTree(uri);
  };

  const untilJobEnds = async (job: string, budgetMs: number): Promise<void> => {
    const deadline = Date.now() + budgetMs;
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
    hold(folder) {
      const uri = folder.trim();
      if (!isSafContentUri(uri)) return;
      holds.set(uri, (holds.get(uri) ?? 0) + 1);
    },
    release(folder) {
      const uri = folder.trim();
      if (!isSafContentUri(uri)) return;
      const left = (holds.get(uri) ?? 0) - 1;
      if (left > 0) holds.set(uri, left);
      else holds.delete(uri);
      releaseIfUnused(uri);
    },
    async withExportFolder(destDir, job, budgetMs, write) {
      const target = destDir.trim();
      if (!isSafContentUri(target)) return write(target);
      if (mounted !== null) {
        // Mounting another tree would send the running export's writes there.
        throw new RpcError(
          VAULT_ERROR_CODES.VAULT_BUSY,
          "another export is writing through the export folder",
        );
      }
      mounted = target;
      try {
        io.mountExportTree(target);
      } catch (error) {
        // The field still holds the pick; it can try again or choose another.
        mounted = null;
        throw error;
      }
      try {
        return await write(SAF_EXPORT_ROOT);
      } finally {
        await untilJobEnds(job, budgetMs);
        io.unmountExportTree();
        mounted = null;
        releaseIfUnused(target);
      }
    },
  };
}

/** The app's export mount over the native bridge. */
export const nativeSafExportMount = createSafExportMount({
  jobStatus: (job) => rpcJobStatus(job),
  mountExportTree: (treeUri) => mountSafExport(treeUri),
  unmountExportTree: () => unmountSafExport(),
  releaseTree: (treeUri) => safReleaseImportTree(treeUri),
});
