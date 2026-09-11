import type { VaultExportRequest } from "../domain/vault-list/export";
import type { VaultRow } from "../domain/vault/types";

const ZIP_LOCAL_FILE_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const SEVEN_ZIP_MAGIC = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

function concatBytes(prefix: Uint8Array, rest: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + rest.length);
  out.set(prefix, 0);
  out.set(rest, prefix.length);
  return out;
}

/**
 * Mock export payload until `upriv-core` streams a zip of `contents/` or a logical `.7z`.
 * Magics differ per format so a “`.zip`” download is never a 7z signature.
 *
 * Import from `@upriv/shared/testing` — not the domain barrel.
 */
export function mockVaultExportBytes(
  vault: Pick<VaultRow, "id" | "displayName">,
  request: VaultExportRequest,
): Uint8Array {
  const sevenZip = request.sevenZip;
  const meta = [
    vault.id,
    vault.displayName,
    request.format,
    sevenZip
      ? `${sevenZip.archive_mode}:${sevenZip.compression_level}:${sevenZip.encrypt_file_names}`
      : "",
  ].join("\n");
  const body = new TextEncoder().encode(meta);
  if (request.format === "seven_zip") {
    return concatBytes(SEVEN_ZIP_MAGIC, body);
  }
  return concatBytes(ZIP_LOCAL_FILE_MAGIC, body);
}
