import { safReleaseImportTree } from "@/platform/native/safVaultRoot";
import { releaseImportCache, retainsImportCache } from "./importCache";
import {
  contentTreeFromFolderPick,
  createContentTreeRegistry,
  importContentTree,
  type ContentImportTree,
  type ContentTreeImportIo,
} from "./contentTreePlan";

export {
  contentTreeFromFolderPick,
  importContentTree,
  type ContentImportTree,
  type ContentTreeImportIo,
};

const registry = createContentTreeRegistry();
const claimedByVault = new Map<string, ContentImportTree>();

export function rememberContentTree(tree: ContentImportTree): void {
  registry.remember(tree);
}

function hasContentTree(path: string): boolean {
  return registry.has(path);
}

export function claimContentTreeForCreate(vaultId: string, path: string): void {
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

/** Move the wizard's listing onto one creating job. */
export function takeContentTreeForJob(path: string): ContentImportTree | undefined {
  return registry.takeForJob(path);
}

/** Cancel the wizard's pick. A job that already took the folder keeps the permission. */
export function releaseContentTree(path: string): void {
  if (!registry.releaseWizard(path)) return;
  safReleaseImportTree(path.trim());
}

/** The creating job finished reading this listing. */
export function releaseContentJob(tree: ContentImportTree): void {
  for (const [id, claimed] of claimedByVault) {
    if (claimed === tree) claimedByVault.delete(id);
  }
  if (!registry.releaseJob(tree)) return;
  safReleaseImportTree(tree.directoryUri);
}

/** True while create still needs a cache copy or a remembered folder listing. */
export function retainsPendingImport(path: string): boolean {
  return hasContentTree(path) || retainsImportCache(path);
}

/** Release a cancelled pick: folder permission, or one document-picker cache file. */
export function releasePendingImport(path: string): Promise<void> {
  releaseContentTree(path);
  return releaseImportCache(path);
}
