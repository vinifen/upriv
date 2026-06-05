import { zipSync } from "fflate";

function triggerBrowserDownload(data: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadFilesAsZip(
  files: ReadonlyArray<{ filename: string; data: Uint8Array }>,
  zipFilename: string,
): void {
  if (files.length === 0) return;

  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.filename] = file.data;
  }

  triggerBrowserDownload(zipSync(entries), zipFilename, "application/zip");
}

/** One file → direct download; multiple → zip. */
export function downloadFiles(
  files: ReadonlyArray<{ filename: string; data: Uint8Array }>,
  zipFilename: string,
): void {
  if (files.length === 0) return;
  if (files.length === 1) {
    triggerBrowserDownload(files[0].data, files[0].filename, "application/octet-stream");
    return;
  }
  downloadFilesAsZip(files, zipFilename);
}
