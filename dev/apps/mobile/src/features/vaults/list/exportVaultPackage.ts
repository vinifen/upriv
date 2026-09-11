import { fromByteArray } from "base64-js";
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
import {
  vaultExportFilename,
  type VaultExportFormat,
  type VaultExportRequest,
  type VaultRow,
} from "@upriv/shared";

/** Own cache subfolder so the sweep can never touch unrelated cached files. */
const EXPORT_CACHE_DIR = "upriv-exports/";
/** How long a staged export may linger before the next export sweeps it. */
const EXPORT_CACHE_TTL_MS = 10 * 60 * 1000;

function exportMimeType(format: VaultExportFormat): string {
  return format === "contents_zip" ? "application/zip" : "application/x-7z-compressed";
}

function exportUti(format: VaultExportFormat): string {
  return format === "contents_zip" ? "public.zip-archive" : "org.7-zip.7-zip-archive";
}

/**
 * The receiving app copies the `content:` URI after the share sheet closes, so
 * the staged file cannot be deleted when `shareAsync` resolves. Leftovers are
 * ciphertext, and the next export removes the ones past the TTL.
 */
async function sweepStaleExports(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readDirectoryAsync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - EXPORT_CACHE_TTL_MS;
  await Promise.all(
    names.map(async (name) => {
      const uri = `${dir}${name}`;
      try {
        const info = await getInfoAsync(uri);
        if (!info.exists) return;
        if ((info.modificationTime ?? 0) * 1000 > cutoff) return;
        await deleteAsync(uri, { idempotent: true });
      } catch {
        /* Best-effort sweep — a locked file is retried on the next export. */
      }
    }),
  );
}

/**
 * Write `{display_name}.zip` / `.7z` to app cache and open the system share sheet.
 * Bytes come from `upriv-core` (mock ciphertext today) — never a decrypted tree.
 *
 * `signal` is aborted when the caller's loading budget expires: an export that
 * outlived its overlay must not pop a share sheet over an unrelated screen.
 *
 * TODO: once `upriv-core` writes the package itself, take a native file path
 * instead of moving the whole vault through the JS bridge.
 */
export async function exportVaultPackage(
  vault: VaultRow,
  getExportBytes: (vault: VaultRow, request: VaultExportRequest) => Promise<Uint8Array>,
  request: VaultExportRequest,
  signal?: AbortSignal,
): Promise<void> {
  const filename = vaultExportFilename(vault.displayName, request.format);
  const data = await getExportBytes(vault, request);
  if (signal?.aborted) return;

  const root = cacheDirectory;
  if (!root) {
    throw new Error("cacheDirectory unavailable");
  }

  const dir = `${root}${EXPORT_CACHE_DIR}`;
  await makeDirectoryAsync(dir, { intermediates: true });
  await sweepStaleExports(dir);
  if (signal?.aborted) return;

  const uri = `${dir}${filename}`;
  await writeAsStringAsync(uri, fromByteArray(data), { encoding: EncodingType.Base64 });

  if (signal?.aborted) {
    await deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    return;
  }

  if (!(await isAvailableAsync())) {
    throw new Error("sharing unavailable on this device");
  }
  await shareAsync(uri, {
    mimeType: exportMimeType(request.format),
    UTI: exportUti(request.format),
    dialogTitle: filename,
  });
}
