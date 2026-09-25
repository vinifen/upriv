import type { CreateVaultService } from "@upriv/shared";
import { RpcError } from "@upriv/shared";
import { rpcVaultImportProbe } from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable } from "./safVaultRpcGuard";

type DocumentPickerModule = typeof import("expo-document-picker");

function loadDocumentPicker(): DocumentPickerModule {
  try {
    return require("expo-document-picker") as DocumentPickerModule;
  } catch (error) {
    throw new RpcError(
      "not_implemented",
      error instanceof Error ? error.message : "Document picker is unavailable",
    );
  }
}

function fsPathFromPickerUri(uri: string): string {
  if (uri.startsWith("file://")) {
    try {
      return decodeURIComponent(uri.slice("file://".length));
    } catch {
      return uri.slice("file://".length);
    }
  }
  return uri;
}

/** Native create-vault import picker + archive probe. */
export const nativeCreateVaultService: CreateVaultService = {
  async selectImportPackageForProbe() {
    const DocumentPicker = loadDocumentPicker();
    let result: Awaited<ReturnType<DocumentPickerModule["getDocumentAsync"]>>;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-7z-compressed", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch (error) {
      throw new RpcError(
        "not_implemented",
        error instanceof Error ? error.message : "Document picker is unavailable",
      );
    }
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    const fileName = asset.name?.trim() || "import.zip";
    const path = fsPathFromPickerUri(asset.uri);
    return { path, fileName };
  },

  async testImportPackagePassword(password, importFile) {
    if (importFile?.kind === "backup" || importFile?.fileName.toLowerCase().endsWith(".zip")) {
      return true;
    }
    assertSafVaultPathRpcAvailable();
    if (!importFile?.path) return false;
    const probed = await rpcVaultImportProbe({
      archivePath: importFile.path,
      archivePassword: password,
      kind: "seven_zip",
    });
    return probed.ok;
  },
};
