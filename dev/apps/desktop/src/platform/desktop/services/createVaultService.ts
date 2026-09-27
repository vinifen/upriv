import { importZipClassificationFromProbe, type CreateVaultService } from "@upriv/shared";
import { rpcPickDirectory, rpcPickFile, rpcVaultImportProbe } from "@/lib/rpc";

/** Desktop create-vault import picker + archive probe. */
export const desktopCreateVaultService: CreateVaultService = {
  async selectImportPackageForProbe() {
    const path = await rpcPickFile({ title: "Import a file" });
    if (!path) return null;
    const fileName = path.split(/[/\\]/).pop() ?? path;
    return { path, fileName };
  },

  async selectImportFolder() {
    const path = await rpcPickDirectory(null, "Import a folder");
    if (!path) return null;
    const fileName = path.split(/[/\\]/).pop() ?? path;
    return { path, fileName };
  },

  async testImportPackagePassword(password, importFile) {
    if (!importFile?.path) return { ok: false, embedded: null };
    if (importFile.kind === "backup" || importFile.fileName.toLowerCase().endsWith(".zip")) {
      return { ok: true, embedded: null };
    }
    const probed = await rpcVaultImportProbe({
      archivePath: importFile.path,
      archivePassword: password,
      kind: "seven_zip",
    });
    return { ok: probed.ok, embedded: probed.ok ? probed.embedded : null };
  },

  async readImportPackageSettings(importFile) {
    if (!importFile.path.trim()) return null;
    const probed = await rpcVaultImportProbe({
      archivePath: importFile.path,
      kind: "store_zip",
    });
    return importZipClassificationFromProbe(probed);
  },
};
