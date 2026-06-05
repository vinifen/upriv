import { zipSync } from "fflate";

export function downloadLogsZip(
  files: ReadonlyArray<{ filename: string; content: string }>,
  zipFilename: string,
): void {
  if (files.length === 0) return;

  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.filename] = new TextEncoder().encode(file.content);
  }

  const zipped = zipSync(entries);
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = zipFilename;
  anchor.click();
  URL.revokeObjectURL(url);
}
