import { cacheDirectory, deleteAsync } from "expo-file-system";
import { nativeOsPathFromImportUri } from "@/features/vaults/file-manager/lib/osFileImport";
import { classifyImportCachePath } from "./importCachePath";

/** Copies and deletes of picker cache files run one at a time. */
let cacheOps: Promise<void> = Promise.resolve();

function enqueueCacheOp<T>(op: () => Promise<T>): Promise<T> {
  const run = cacheOps.then(op, op);
  cacheOps = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function cacheRoots() {
  const cacheUri = cacheDirectory ? cacheDirectory.replace(/\/+$/, "") : null;
  return {
    cacheOs: cacheDirectory ? nativeOsPathFromImportUri(cacheDirectory) : null,
    cacheUri,
  };
}

/** True when `path` is a document-picker copy that import still needs to read. */
export function retainsImportCache(path: string): boolean {
  return classifyImportCachePath(path, cacheRoots()) === "file";
}

function fileUriFromOsPath(osPath: string): string {
  const parts = osPath.split("/").map((part) => encodeURIComponent(part));
  return `file://${parts.join("/")}`;
}

/**
 * Deletes a document-picker copy that lives in app cache.
 * A user's own file, or an Android `content://` folder, is left alone.
 */
export function releaseImportCache(path: string): Promise<void> {
  return enqueueCacheOp(() => releaseImportCacheNow(path));
}

async function releaseImportCacheNow(path: string): Promise<void> {
  if (classifyImportCachePath(path, cacheRoots()) !== "file") return;
  const trimmed = path.trim();
  const uri = trimmed.startsWith("file:") ? trimmed : fileUriFromOsPath(trimmed);
  await deleteAsync(uri, { idempotent: true });
}
