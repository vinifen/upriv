import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve an XDG FileTransfer portal key (Nautilus/GTK4 drag) to absolute paths.
 * Chromium/Electron often omit `Files` for portal-only offers; RetrieveFiles is
 * the supported recovery path on Linux.
 */
export async function retrievePortalTransferPaths(key: unknown): Promise<string[]> {
  if (process.platform !== "linux") return [];
  if (typeof key !== "string") return [];
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 512 || trimmed.startsWith("-")) return [];

  try {
    const { stdout } = await execFileAsync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.portal.Documents",
        "--object-path",
        "/org/freedesktop/portal/documents",
        "--method",
        "org.freedesktop.portal.FileTransfer.RetrieveFiles",
        trimmed,
        "{}",
      ],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return parseGdbusStringArray(stdout);
  } catch {
    return [];
  }
}

/** `gdbus call` prints e.g. `(['/tmp/a', '/tmp/b'],)` or `(@as [],)`. */
export function parseGdbusStringArray(stdout: string): string[] {
  const text = stdout.trim();
  if (!text) return [];
  const paths: string[] = [];
  const re = /'(?:\\'|[^'])*'|"(?:\\"|[^"])*"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const raw = match[0];
    const body = raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (body.startsWith("/") || /^[A-Za-z]:[\\/]/.test(body)) paths.push(body);
  }
  return paths;
}
