import type { EmbeddedVaultSettings } from "./applyEmbeddedVaultSettings";
import type { ZipImportLayout } from "./types";

/** What `vault_import_probe` decided about a `.zip`, plus any store settings. */
export interface ImportZipClassification {
  embedded: EmbeddedVaultSettings | null;
  zipLayout: ZipImportLayout;
}

/**
 * `files_zip` encrypts the documents. Any other successful or settings-less
 * probe is a store copy (`ok: false` still means "no settings", not "documents").
 * A failed files classification is `null` so the wizard blocks that `.zip`.
 */
export function importZipClassificationFromProbe(probed: {
  ok: boolean;
  kind: string;
  embedded: EmbeddedVaultSettings | null;
}): ImportZipClassification | null {
  if (probed.kind === "files_zip") {
    return probed.ok ? { embedded: null, zipLayout: "files" } : null;
  }
  return {
    embedded: probed.ok ? probed.embedded : null,
    zipLayout: "store",
  };
}
