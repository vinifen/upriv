import { downloadFiles } from "@/lib/downloadZip";
import type { VaultRow } from "@upriv/shared";
import { vaultArchiveFilename } from "@upriv/shared";

/** Download main archive `{display_name}.7z`. */
export async function exportVaultArchive(
  vault: VaultRow,
  getArchiveBytes: (vault: VaultRow) => Promise<Uint8Array>,
): Promise<void> {
  const filename = vaultArchiveFilename(vault);
  const data = await getArchiveBytes(vault);
  downloadFiles([{ filename, data }], filename);
}
