import {
  OPERATION_LIMIT_MS,
  isSafContentUri,
  type ExportFolderGrants,
  type JobProgress,
} from "@upriv/shared";
import { rpcJobStatus } from "@/lib/rpc";
import { isDeviceTree } from "./deviceTrees";
import { checkTree, mountTree, safReleaseImportTree, unmountTree } from "./safVaultRoot";

/** How often an ended call asks whether core still runs its job. */
const SETTLE_POLL_MS = 1_000;

/** Bridge calls the export folders use. Injected so tests run without Android. */
export interface ExportTreeIo {
  /** `job_status`: `null` once core no longer runs that job. */
  jobStatus(job: string): Promise<JobProgress | null>;
  /** Throws when the tree's grant is gone or its drive is away. */
  checkTree(treeUri: string): void;
  /** Mount the tree and return the root Rust reaches it at. */
  mountTree(treeUri: string): string;
  unmountTree(treeUri: string): void;
  /** Drop the access the folder picker took. */
  releaseTree(treeUri: string): void;
  /** A row of this phone names the tree: its mount and grant stay. */
  isListed(treeUri: string): boolean;
  /** Defaults to a timer. */
  wait?(ms: number): Promise<void>;
}

/**
 * The folders picked for an export on a phone, each reached at its own tree
 * root: the vault export, the backup export, and Export data folder write
 * straight there, and nothing is staged in app storage.
 */
export interface ExportTrees extends ExportFolderGrants {
  /**
   * Run `write` with the folder core writes into: a filesystem path as it is,
   * or the root of the picked `content://` tree. The tree goes once
   * `job_status` says `job` ended (waiting at most `OPERATION_LIMIT_MS` after
   * the call returned) and nothing holds it: a call that failed in the
   * bridge may leave core still removing its partial file there.
   */
  withExportFolder<T>(destDir: string, job: string, write: (dir: string) => Promise<T>): Promise<T>;
}

function timer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A picked folder's mount and access go once nothing holds it and no export
 * writes there, so two fields may keep the same folder. A folder a row of
 * this phone names keeps both.
 */
export function createExportTrees(io: ExportTreeIo): ExportTrees {
  const wait = io.wait ?? timer;
  const holds = new Map<string, number>();
  const writing = new Map<string, number>();

  const count = (map: Map<string, number>, uri: string, delta: number) => {
    const left = (map.get(uri) ?? 0) + delta;
    if (left > 0) map.set(uri, left);
    else map.delete(uri);
  };

  const letGoIfUnused = (uri: string) => {
    if (holds.has(uri) || writing.has(uri) || io.isListed(uri)) return;
    io.unmountTree(uri);
    io.releaseTree(uri);
  };

  const untilJobEnds = async (job: string): Promise<void> => {
    const deadline = Date.now() + OPERATION_LIMIT_MS;
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
      count(holds, uri, 1);
    },
    release(folder) {
      const uri = folder.trim();
      if (!isSafContentUri(uri)) return;
      count(holds, uri, -1);
      letGoIfUnused(uri);
    },
    async withExportFolder(destDir, job, write) {
      const target = destDir.trim();
      if (!isSafContentUri(target)) return write(target);
      io.checkTree(target);
      const root = io.mountTree(target);
      count(writing, target, 1);
      try {
        return await write(root);
      } finally {
        await untilJobEnds(job);
        count(writing, target, -1);
        letGoIfUnused(target);
      }
    },
  };
}

/** The phone's export folders over the native bridge. */
export const nativeExportTrees = createExportTrees({
  jobStatus: (job) => rpcJobStatus(job),
  checkTree,
  mountTree,
  unmountTree,
  releaseTree: (treeUri) => safReleaseImportTree(treeUri),
  isListed: isDeviceTree,
});
