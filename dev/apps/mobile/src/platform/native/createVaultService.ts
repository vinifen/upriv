import { Platform } from "react-native";
import { importZipClassificationFromProbe, type CreateVaultService } from "@upriv/shared";
import { RpcError } from "@upriv/shared";
import {
  nativeOsPathFromImportUri,
  pickImportFolder,
} from "@/features/vaults/file-manager/lib/osFileImport";
import { rpcVaultImportProbe } from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable } from "./safVaultRpcGuard";
import { contentTreeFromFolderPick, rememberContentTree } from "./contentTreeImport";
import { safReleaseImportTree } from "./safVaultRoot";

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
  const parsed = nativeOsPathFromImportUri(uri);
  if (parsed) return parsed;
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
        type: "*/*",
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

  async selectImportFolder() {
    if (Platform.OS !== "android") return null;
    const picked = await pickImportFolder({ failClosed: true });
    if (!picked) return null;
    try {
      const tree = contentTreeFromFolderPick(picked);
      rememberContentTree(tree);
      return { path: tree.directoryUri, fileName: tree.folderName };
    } catch (error) {
      if (picked.releaseSafTree) safReleaseImportTree(picked.releaseSafTree);
      throw error;
    }
  },

  async testImportPackagePassword(password, importFile) {
    if (importFile?.kind === "backup" || importFile?.fileName.toLowerCase().endsWith(".zip")) {
      return { ok: true, embedded: null };
    }
    assertSafVaultPathRpcAvailable();
    if (!importFile?.path) return { ok: false, embedded: null };
    const probed = await rpcVaultImportProbe({
      archivePath: importFile.path,
      archivePassword: password,
      kind: "seven_zip",
    });
    return { ok: probed.ok, embedded: probed.ok ? probed.embedded : null };
  },

  async readImportPackageSettings(importFile) {
    if (!importFile.path.trim()) return null;
    if (importFile.kind === "backup" || importFile.fileName.toLowerCase().endsWith(".zip")) {
      assertSafVaultPathRpcAvailable();
    }
    const probed = await rpcVaultImportProbe({
      archivePath: importFile.path,
      kind: "store_zip",
    });
    return importZipClassificationFromProbe(probed);
  },
};
