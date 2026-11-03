import type { EmbeddedVaultSettings } from "../../domain/vault-create/applyEmbeddedVaultSettings";
import type { ImportZipClassification } from "../../domain/vault-create/zipClassification";

export interface ImportPackageProbe {
  ok: boolean;
  embedded: EmbeddedVaultSettings | null;
}

/** Create-vault wizard platform hooks (import package probe). */
export interface CreateVaultService {
  /**
   * `ok: false` is a wrong password — probing is not an error path. A `.7z`
   * test runs as the job `job`: a stop rejects with `job_cancelled`.
   */
  testImportPackagePassword(
    password: string,
    importFile: { path: string; fileName: string; kind?: "file" | "backup" } | undefined,
    job: string,
  ): Promise<ImportPackageProbe>;
  /**
   * Classify a `.zip` (store copy vs documents) and read store settings.
   * `null` means the archive could not be classified.
   */
  readImportPackageSettings(importFile: {
    path: string;
    fileName: string;
    kind?: "file" | "backup";
  }): Promise<ImportZipClassification | null>;
  /** File picker. Resolves `null` when the user cancels. */
  selectImportPackageForProbe(): Promise<{ path: string; fileName: string } | null>;
  /** Folder picker. Absent on platforms that have no directory dialog. */
  selectImportFolder?(): Promise<{ path: string; fileName: string } | null>;
}
