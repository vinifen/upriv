import { downloadFiles } from "@/lib/downloadZip";

export function downloadLogsZip(
  files: ReadonlyArray<{ filename: string; content: string }>,
  zipFilename: string,
): void {
  if (files.length === 0) return;

  downloadFiles(
    files.map((file) => ({
      filename: file.filename,
      data: new TextEncoder().encode(file.content),
    })),
    zipFilename,
  );
}
