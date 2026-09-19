/**
 * Last path segment of a SAF tree/document URI (picked folder or child name).
 * Not a filesystem path.
 */
export function safDocumentName(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri.trim());
    const withoutQuery = decoded.split("?")[0] ?? decoded;
    const slash = withoutQuery.lastIndexOf("/");
    const colon = withoutQuery.lastIndexOf(":");
    const cut = Math.max(slash, colon);
    const leaf = (cut >= 0 ? withoutQuery.slice(cut + 1) : withoutQuery).replace(/\\/g, "/");
    return leaf.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}
