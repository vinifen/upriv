/**
 * `ACTION_OPEN_DOCUMENT_TREE` result ids.
 *
 * Shared Documents stays on the phone after uninstall. Android deletes
 * app-specific storage with the app, including a Documents directory the app
 * created there with no prompt. The system screen is the grant for the shared
 * folder. `content://…/tree/primary%3ADocuments/document/…` grants the whole
 * Documents directory. `primary:Documents/Upriv` is the folder inside it.
 */
export function safTreeDocumentId(uri: string): string | null {
  const marker = "/tree/";
  const start = uri.indexOf(marker);
  if (start < 0) return null;
  let rest = uri.slice(start + marker.length);
  const end = rest.indexOf("/");
  if (end >= 0) rest = rest.slice(0, end);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** The shared Documents directory itself, not a folder the user created inside it. */
export function isAndroidSharedDocumentsRoot(uri: string): boolean {
  const id = safTreeDocumentId(uri)?.replace(/\/+$/, "");
  return id === "primary:Documents" || id === "home:Documents";
}

/** `Documents/Upriv` (or the secondary-user `home:Documents/Upriv`). */
export function isAndroidDocumentsUprivFolder(uri: string): boolean {
  const id = safTreeDocumentId(uri)?.replace(/\/+$/, "");
  return id === "primary:Documents/Upriv" || id === "home:Documents/Upriv";
}

/**
 * Grant used as the Android default: Documents itself (confirmed in one step,
 * `Upriv` created inside) or a tree that is already `Documents/Upriv`.
 */
export function isAndroidDocumentsDefaultGrant(uri: string): boolean {
  return isAndroidSharedDocumentsRoot(uri) || isAndroidDocumentsUprivFolder(uri);
}

/**
 * Path to restore when the user switches to a custom folder.
 * The Documents default grant is the default radio, so restoring it snaps
 * that radio back on.
 */
export function rememberedCustomFolderPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || isAndroidDocumentsDefaultGrant(trimmed)) return "";
  return trimmed;
}
