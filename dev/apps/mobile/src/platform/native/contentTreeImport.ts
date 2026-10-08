import { safReleaseImportTree } from "@/platform/native/safVaultRoot";
import {
  contentTreeFromFolderPick,
  contentTreeFromPickedFile,
  createContentTreeRegistry,
  importContentTree,
  type ContentImportTree,
  type ContentTreeImportIo,
} from "./contentTreePlan";
import { releaseImportCache, retainsImportCache } from "./importCache";

export {
  contentTreeFromFolderPick,
  contentTreeFromPickedFile,
  importContentTree,
  type ContentImportTree,
  type ContentTreeImportIo,
};

const registry = createContentTreeRegistry();
const claimedByVault = new Map<string, ContentImportTree>();
const pendingListings = new Map<string, Promise<ContentImportTree>>();
const cancelledListings = new Set<string>();
const listingErrors = new Map<string, unknown>();
const listingListeners = new Set<() => void>();

function notifyListingListeners(): void {
  for (const listener of listingListeners) listener();
}

/** Error from a folder listing that already finished, keyed by the grant URI. */
export function importFolderListingError(path: string): unknown | undefined {
  return listingErrors.get(path.trim());
}

export function subscribeImportFolderListing(listener: () => void): () => void {
  listingListeners.add(listener);
  return () => {
    listingListeners.delete(listener);
  };
}

export function rememberContentTree(tree: ContentImportTree): void {
  registry.remember(tree);
}

/**
 * Index a picked folder after the wizard already shows its path.
 * Create waits on this promise. Cancel drops the result.
 */
export function startContentTreeListing(
  directoryUri: string,
  load: () => Promise<ContentImportTree>,
): void {
  const key = directoryUri.trim();
  if (!key) return;
  cancelledListings.delete(key);
  listingErrors.delete(key);
  notifyListingListeners();
  const current: { job?: Promise<ContentImportTree> } = {};
  const job = load().then((tree) => {
    if (cancelledListings.has(key)) {
      safReleaseImportTree(key);
      return tree;
    }
    // A newer pick replaced this job. Do not publish its tree or its error.
    if (pendingListings.get(key) !== current.job) return tree;
    registry.remember(tree);
    listingErrors.delete(key);
    notifyListingListeners();
    return tree;
  });
  current.job = job;
  pendingListings.set(key, job);
  void job.then(
    () => undefined,
    (error: unknown) => {
      if (cancelledListings.has(key)) return;
      if (pendingListings.get(key) !== current.job) return;
      listingErrors.set(key, error);
      notifyListingListeners();
    },
  );
  void job.finally(() => {
    if (pendingListings.get(key) === job) pendingListings.delete(key);
  });
}

export function cancelContentTreeListing(path: string): void {
  const key = path.trim();
  if (!key) return;
  cancelledListings.add(key);
  pendingListings.delete(key);
  listingErrors.delete(key);
  notifyListingListeners();
}

function hasContentTree(path: string): boolean {
  return registry.has(path);
}

export async function claimContentTreeForCreate(vaultId: string, path: string): Promise<void> {
  const key = path.trim();
  const pending = key ? pendingListings.get(key) : undefined;
  if (pending) await pending;
  const failed = key ? listingErrors.get(key) : undefined;
  if (failed) throw failed;
  if (key && cancelledListings.has(key)) return;
  const id = vaultId.trim();
  if (!id) return;
  const tree = registry.takeForJob(path);
  if (!tree) return;
  const previous = claimedByVault.get(id);
  claimedByVault.set(id, tree);
  if (previous && previous !== tree) releaseContentJob(previous);
}

export function contentTreeClaimedForCreate(vaultId: string): ContentImportTree | undefined {
  return claimedByVault.get(vaultId.trim());
}

/**
 * Cancel the wizard's pick. A job that already took the listing keeps the permission.
 * `true` when this call dropped the wizard's listing.
 */
export function releaseContentTree(path: string): boolean {
  if (!registry.releaseWizard(path)) return false;
  safReleaseImportTree(path.trim());
  return true;
}

/** Drop a pick no job took, including its cache copy. */
export function releaseUnclaimedImport(path: string): void {
  if (!releaseContentTree(path)) return;
  void releaseImportCache(path).catch(() => undefined);
}

/** The creating job finished reading this listing. */
export function releaseContentJob(tree: ContentImportTree): void {
  for (const [id, claimed] of claimedByVault) {
    if (claimed === tree) claimedByVault.delete(id);
  }
  if (!registry.releaseJob(tree)) return;
  safReleaseImportTree(tree.directoryUri);
}

/** True while create still needs this listing or its cache copy. */
export function retainsPendingImport(path: string): boolean {
  return hasContentTree(path) || retainsImportCache(path);
}

/** Release a cancelled pick: listing permission, then one cache copy. */
export function releasePendingImport(path: string): Promise<void> {
  cancelContentTreeListing(path);
  releaseContentTree(path);
  return releaseImportCache(path);
}
