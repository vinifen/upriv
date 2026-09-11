import { fromByteArray } from "base64-js";
import { zipSync } from "fflate";
import {
  cacheDirectory,
  deleteAsync,
  EncodingType,
  getInfoAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";

/** Own cache subfolder so the sweep cannot touch vault-export leftovers. */
const SHARE_CACHE_DIR = "upriv-shares/";
const SHARE_CACHE_TTL_MS = 10 * 60 * 1000;

function safeEntryName(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/^\.+/, "_");
}

async function sweepStaleShares(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readDirectoryAsync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - SHARE_CACHE_TTL_MS;
  await Promise.all(
    names.map(async (name) => {
      const uri = `${dir}${name}`;
      try {
        const info = await getInfoAsync(uri);
        if (!info.exists) return;
        if ((info.modificationTime ?? 0) * 1000 > cutoff) return;
        await deleteAsync(uri, { idempotent: true });
      } catch {
        /* Best-effort sweep — a locked file is retried on the next share. */
      }
    }),
  );
}

async function shareBytes(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  uti: string,
): Promise<void> {
  const root = cacheDirectory;
  if (!root) {
    throw new Error("cacheDirectory unavailable");
  }

  const dir = `${root}${SHARE_CACHE_DIR}`;
  await makeDirectoryAsync(dir, { intermediates: true });
  await sweepStaleShares(dir);

  const safeName = safeEntryName(filename);
  const uri = `${dir}${safeName}`;
  await writeAsStringAsync(uri, fromByteArray(data), { encoding: EncodingType.Base64 });

  if (!(await isAvailableAsync())) {
    throw new Error("sharing unavailable on this device");
  }
  await shareAsync(uri, {
    mimeType,
    UTI: uti,
    dialogTitle: safeName,
  });
}

/** Always share a zip (desktop logs download). */
export async function shareFilesAsZip(
  files: ReadonlyArray<{ filename: string; data: Uint8Array }>,
  zipFilename: string,
): Promise<void> {
  if (files.length === 0) return;
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[safeEntryName(file.filename)] = file.data;
  }
  await shareBytes(zipSync(entries), zipFilename, "application/zip", "public.zip-archive");
}

/** One file → share as-is; multiple → zip. Desktop `downloadFiles` parity. */
export async function shareFiles(
  files: ReadonlyArray<{ filename: string; data: Uint8Array }>,
  zipFilename: string,
): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    await shareBytes(
      files[0].data,
      safeEntryName(files[0].filename),
      "application/octet-stream",
      "public.data",
    );
    return;
  }
  await shareFilesAsZip(files, zipFilename);
}
