import { rpcPickSaveFile } from "@/lib/rpc";
import type { VaultExportRequest, VaultPathWriteResult, VaultRow } from "@upriv/shared";
import { vaultExportFilename } from "@upriv/shared";

export interface ExportVaultPackageFns {
  exportToPath: (
    vault: VaultRow,
    request: VaultExportRequest,
    destPath: string,
    job: string,
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
 * Ask where to save `{display_name}.zip` / `.7z`, then write it in core as the
 * job `job`, so the archive never rides the NDJSON line.
 *
 * `signal` is aborted when the caller's loading budget expires: an export the
 * user gave up on while the save dialog was open never starts.
 */
export async function exportVaultPackage(
  vault: VaultRow,
  fns: ExportVaultPackageFns,
  request: VaultExportRequest,
  job: string,
  signal?: AbortSignal,
): Promise<"written" | "cancelled"> {
  const filename = vaultExportFilename(vault.displayName, request.format);
  const destPath = await rpcPickSaveFile({
    title: filename,
    defaultPath: filename,
    filters: saveFilters(request.format),
  });
  if (!destPath || signal?.aborted) return "cancelled";
  await fns.exportToPath(vault, request, destPath, job);
  return "written";
}
