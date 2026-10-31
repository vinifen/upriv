import type { EmbeddedVaultSettings } from "./applyEmbeddedVaultSettings";
import type { ZipImportLayout } from "./types";

/** What `vault_import_probe` decided about a `.zip`, plus any settings it carries. */
export interface ImportZipClassification {
  embedded: EmbeddedVaultSettings | null;
  zipLayout: ZipImportLayout;
  /** A `.zip` of files carries a file manager layout. A store zip keeps its own. */
  carriesWorkspace: boolean;
}

/**
 * `files_zip` encrypts readable files, and a plain-text export carries its
 * settings and layout in `.upriv-config/`. Any other successful or settings-less
 * probe is a store copy (`ok: false` still means "no settings", not "documents").
 * A failed files classification is `null` so the wizard blocks that `.zip`.
 */
export function importZipClassificationFromProbe(probed: {
  ok: boolean;
  kind: string;
  embedded: EmbeddedVaultSettings | null;
  carriesWorkspace: boolean;
}): ImportZipClassification | null {
  if (probed.kind === "files_zip") {
    if (!probed.ok) return null;
    return {
      embedded: probed.embedded,
      zipLayout: "files",
      carriesWorkspace: probed.carriesWorkspace,
    };
  }
  return {
    embedded: probed.ok ? probed.embedded : null,
    zipLayout: "store",
    carriesWorkspace: false,
  };
}
