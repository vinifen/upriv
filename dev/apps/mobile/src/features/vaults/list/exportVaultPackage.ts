import {
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
} from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import {
  vaultExportFilename,
  type VaultExportFormat,
  type VaultExportRequest,
  type VaultPathWriteResult,
  type VaultRow,
} from "@upriv/shared";
import { fsPathFromFileUri } from "@/lib/fileUri";

/** Own cache subfolder so the sweep can never touch unrelated cached files. */
const EXPORT_CACHE_DIR = "upriv-exports/";
/** How long a staged export may linger before the next export sweeps it. */
const EXPORT_CACHE_TTL_MS = 10 * 60 * 1000;

export interface ExportVaultPackageFns {
  exportToPath: (
    vault: VaultRow,
    request: VaultExportRequest,
    destPath: string,
    job: string,
  ) => Promise<VaultPathWriteResult>;
}

function exportMimeType(format: VaultExportFormat): string {
  return format === "store_zip" ? "application/zip" : "application/x-7z-compressed";
}

function exportUti(format: VaultExportFormat): string {
  return format === "store_zip" ? "public.zip-archive" : "org.7-zip.7-zip-archive";
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

async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await getInfoAsync(uri);
    return info.exists === true;
  } catch {
    return false;
  }
}

/**
 * Write `{display_name}.zip` / `.7z` in core as the job `job`, then open the
 * share sheet. The archive never crosses the JS bridge.
 *
 * `signal` is aborted when the caller's loading budget expires: an export that
 * outlived its overlay must not pop a share sheet over an unrelated screen.
 */
export async function exportVaultPackage(
  vault: VaultRow,
  fns: ExportVaultPackageFns,
  request: VaultExportRequest,
  job: string,
  signal?: AbortSignal,
): Promise<"written" | "cancelled"> {
  const filename = vaultExportFilename(vault.displayName, request.format);
  const root = cacheDirectory;
  if (!root) {
    throw new Error("cacheDirectory unavailable");
  }

  const dir = `${root}${EXPORT_CACHE_DIR}`;
  await makeDirectoryAsync(dir, { intermediates: true });
  await sweepStaleExports(dir);
  if (signal?.aborted) return "cancelled";

  const uri = `${dir}${filename}`;
  await fns.exportToPath(vault, request, fsPathFromFileUri(uri), job);
  if (signal?.aborted) {
    await deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    return "cancelled";
  }
  if (!(await fileExists(uri))) {
    throw new Error("export file was not written");
  }

  if (!(await isAvailableAsync())) {
    throw new Error("sharing unavailable on this device");
  }
  await shareAsync(uri, {
    mimeType: exportMimeType(request.format),
    UTI: exportUti(request.format),
    dialogTitle: filename,
  });
  return "written";
}
