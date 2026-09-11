import { downloadFiles } from "@/lib/downloadZip";
import type { VaultExportRequest, VaultRow } from "@upriv/shared";
import { vaultExportFilename } from "@upriv/shared";

/**
 * Download `{display_name}.zip` or `{display_name}.7z`.
 *
 * `signal` is aborted when the caller's loading budget expires: an export that
 * outlived its overlay must not start a download the user already gave up on.
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
  downloadFiles([{ filename, data }], filename);
}
