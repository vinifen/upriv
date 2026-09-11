import { shareFilesAsZip } from "@/lib/shareZip";

/** Share a zip of the selected log files — desktop `downloadLogsZip`. */
export async function shareLogsZip(
  files: ReadonlyArray<{ filename: string; content: string }>,
  zipFilename: string,
): Promise<void> {
  if (files.length === 0) return;
  const encoder = new TextEncoder();
  await shareFilesAsZip(
    files.map((file) => ({
      filename: file.filename,
      data: encoder.encode(file.content),
    })),
    zipFilename,
  );
}
