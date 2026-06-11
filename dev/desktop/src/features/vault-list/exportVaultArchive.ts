import { downloadFiles } from "@/lib/downloadZip";
import type { VaultRow } from "@/types";
import {
  getMockVaultArchiveBytes,
  vaultArchiveFilename,
} from "@/features/app-settings/vaultBulkExport";

/** Download main archive `{display_name}.7z` (mock until Tauri reads from disk). */
export function exportVaultArchive(vault: VaultRow): void {
  const filename = vaultArchiveFilename(vault);
  downloadFiles([{ filename, data: getMockVaultArchiveBytes(vault) }], filename);
}
