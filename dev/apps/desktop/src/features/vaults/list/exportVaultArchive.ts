import { downloadFiles } from "@/lib/downloadZip";
import type { VaultRow } from "@upriv/shared";
import { getMockVaultArchiveBytes, vaultArchiveFilename } from "@/features/system/settings";

/** Download main archive `{display_name}.7z` (mock until Tauri reads from disk). */
export function exportVaultArchive(vault: VaultRow): void {
  const filename = vaultArchiveFilename(vault);
  downloadFiles([{ filename, data: getMockVaultArchiveBytes(vault) }], filename);
}
