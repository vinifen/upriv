import type { CreateVaultService } from "@upriv/shared";
import { rpcPickFile, rpcVaultImportProbe } from "@/lib/rpc";

/** Desktop create-vault import picker + archive probe. */
export const desktopCreateVaultService: CreateVaultService = {
  async selectImportPackageForProbe() {
    const path = await rpcPickFile({
      title: "Import vault",
      filters: [{ name: "Vault package", extensions: ["zip", "7z"] }],
    });
    if (!path) return null;
    const fileName = path.split(/[/\\]/).pop() ?? path;
    return { path, fileName };
  },

  async testImportPackagePassword(password, importFile) {
    if (!importFile?.path) return false;
    if (importFile.kind === "backup" || importFile.fileName.toLowerCase().endsWith(".zip")) {
      return true;
    }
    const probed = await rpcVaultImportProbe({
      archivePath: importFile.path,
      archivePassword: password,
      kind: "seven_zip",
    });
    return probed.ok;
  },
};
