export interface ImportCacheRoots {
  cacheOs: string | null;
  cacheUri: string | null;
}

/** `file` is one document-picker copy. `leave` is anything else. */
export type ImportCacheKind = "file" | "leave";

function trimmed(path: string): string {
  return path.trim().replace(/\/+$/, "");
}

/** A file strictly inside `root`. `..` does not count as inside. */
function isFileInsideRoot(candidate: string, root: string): boolean {
  const prefix = `${root}/`;
  if (!candidate.startsWith(prefix)) return false;
  const rest = candidate.slice(prefix.length);
  return rest.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/**
 * Decide whether an import path is an app-cache copy that may be deleted.
 * A path outside the cache, including the cache directory itself, is left alone.
 */
export function classifyImportCachePath(path: string, roots: ImportCacheRoots): ImportCacheKind {
  const candidate = trimmed(path);
  const cacheOs = roots.cacheOs ? trimmed(roots.cacheOs) : "";
  const cacheUri = roots.cacheUri ? trimmed(roots.cacheUri) : "";
  if (cacheOs && isFileInsideRoot(candidate, cacheOs)) return "file";
  if (cacheUri && isFileInsideRoot(candidate, cacheUri)) return "file";
  return "leave";
}
