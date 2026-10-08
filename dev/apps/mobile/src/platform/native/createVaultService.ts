import { Platform } from "react-native";
import {
  importZipClassificationFromProbe,
  RpcError,
  sanitizeLogicalFileName,
  type CreateVaultService,
} from "@upriv/shared";
import {
  listGrantedImportFolder,
  nativeOsPathFromImportUri,
  pickImportFolderGrant,
} from "@/features/vaults/file-manager/lib/osFileImport";
import { rpcVaultImportProbe } from "@/lib/rpc";
import {
  contentTreeFromFolderPick,
  contentTreeFromPickedFile,
  rememberContentTree,
  startContentTreeListing,
} from "./contentTreeImport";
import { releaseImportCache } from "./importCache";
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
    const fileName = sanitizeLogicalFileName(asset.name?.trim() || "file", "file");
    const path = fsPathFromPickerUri(asset.uri).trim();
    let tree;
    try {
      tree = contentTreeFromPickedFile({ path, uri: asset.uri, fileName });
    } catch (error) {
      void releaseImportCache(path).catch(() => undefined);
      throw error;
    }
    rememberContentTree(tree);
    return { path: tree.directoryUri, fileName: tree.folderName };
  },

  async selectImportFolder() {
    if (Platform.OS !== "android") return null;
    const grant = await pickImportFolderGrant();
    if (!grant) return null;
    startContentTreeListing(grant.directoryUri, async () => {
      const picked = await listGrantedImportFolder(grant.directoryUri, grant.folderName, true);
      try {
        return contentTreeFromFolderPick(picked);
      } catch (error) {
        if (picked.releaseSafTree) safReleaseImportTree(picked.releaseSafTree);
        throw error;
      }
    });
    return { path: grant.directoryUri, fileName: grant.folderName };
  },

  async testImportPackagePassword(password, importFile) {
    if (importFile?.kind === "backup" || importFile?.fileName.toLowerCase().endsWith(".zip")) {
      return { ok: true, embedded: null };
    }
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
    const probed = await rpcVaultImportProbe({
      archivePath: importFile.path,
      kind: "store_zip",
    });
    return importZipClassificationFromProbe(probed);
  },
};
