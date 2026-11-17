import { folderShownName, isContentUri } from "@upriv/shared";
import { isAndroidSharedDocumentsRoot } from "@/platform/native/documentsGrant";
import { treeOfPath } from "@/platform/native/safVaultRoot";

/**
 * A folder as the screen names it: a picked tree by where it is
 * (`folderShownName`: `Documents/Upriv`, or `1234-5678/Upriv` on a memory
 * card), a path Rust reaches inside a tree by that tree's name and the rest,
 * any other path as it is.
 */
export function shownPath(path: string): string {
  const trimmed = path.trim();
  if (isContentUri(trimmed)) return folderShownName(trimmed);
  const inside = treeOfPath(trimmed);
  if (!inside) return trimmed;
  // Default's grant is Documents; the data folder is its `Upriv` child.
  const name =
    inside.dataFolder && isAndroidSharedDocumentsRoot(inside.tree)
      ? `${folderShownName(inside.tree)}/Upriv`
      : folderShownName(inside.tree);
  return inside.rest ? `${name}/${inside.rest}` : name;
}
