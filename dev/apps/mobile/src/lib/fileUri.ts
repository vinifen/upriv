/** Strip a `file://` URI so core `destPath` sees an absolute filesystem path. */
export function fsPathFromFileUri(uri: string): string {
  if (uri.startsWith("file://")) {
    try {
      return decodeURIComponent(uri.slice("file://".length));
    } catch {
      return uri.slice("file://".length);
    }
  }
  return uri;
}
