import { downloadFiles } from "@/lib/downloadZip";
import { isElectronRenderer } from "@/lib/invoke";
import { rpcPickSaveFile } from "@/lib/rpc";
import type { VaultExportRequest, VaultPathWriteResult, VaultRow } from "@upriv/shared";
import { vaultExportFilename } from "@upriv/shared";

export interface ExportVaultPackageFns {
  getExportBytes: (vault: VaultRow, request: VaultExportRequest) => Promise<Uint8Array>;
  exportToPath: (
    vault: VaultRow,
    request: VaultExportRequest,
    destPath: string,
  ) => Promise<VaultPathWriteResult>;
}

function saveFilters(
  format: VaultExportRequest["format"],
): { name: string; extensions: string[] }[] {
  return format === "seven_zip"
    ? [{ name: "7-Zip archive", extensions: ["7z"] }]
    : [{ name: "Zip archive", extensions: ["zip"] }];
}

/**
 * Write `{display_name}.zip` / `.7z` via core `destPath` in Electron so the
 * archive never rides the NDJSON line. Browser mock still downloads bytes.
 *
 * `signal` is aborted when the caller's loading budget expires: an export that
 * outlived its overlay must not start a download the user already gave up on.
 */
export async function exportVaultPackage(
  vault: VaultRow,
  fns: ExportVaultPackageFns,
  request: VaultExportRequest,
  signal?: AbortSignal,
): Promise<"written" | "cancelled"> {
  const filename = vaultExportFilename(vault.displayName, request.format);
  if (isElectronRenderer()) {
    const destPath = await rpcPickSaveFile({
      title: filename,
      defaultPath: filename,
      filters: saveFilters(request.format),
    });
    if (!destPath || signal?.aborted) return "cancelled";
    await fns.exportToPath(vault, request, destPath);
    return "written";
  }

  const data = await fns.getExportBytes(vault, request);
  if (signal?.aborted) return "cancelled";
  downloadFiles([{ filename, data }], filename);
  return "written";
}
