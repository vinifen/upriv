import { downloadFilesAsZip } from "@/lib/downloadZip";

/** Always downloads a zip — consistent with bulk vault export. */
export function downloadLogsZip(
  files: ReadonlyArray<{ filename: string; content: string }>,
  zipFilename: string,
): void {
  if (files.length === 0) return;

  downloadFilesAsZip(
    files.map((file) => ({
      filename: file.filename,
      data: new TextEncoder().encode(file.content),
    })),
    zipFilename,
  );
}
