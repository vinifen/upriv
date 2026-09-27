import {
  createLiveVaultService,
  isContentUri,
  RpcError,
  type CreateVaultInput,
} from "@upriv/shared";
import {
  rpcImportContentUri,
  rpcVaultConfigGet,
  rpcVaultStoreSize,
  rpcVaultConfigSave,
  rpcVaultCreate,
  rpcVaultDelete,
  rpcVaultDiscardImport,
  rpcVaultExport,
  rpcVaultExportCapabilities,
  rpcVaultExportProbe,
  rpcVaultExportToPath,
  rpcVaultImport7z,
  rpcVaultImportFilesZip,
  rpcVaultImportOsPath,
  rpcVaultImportZip,
  rpcVaultIngestDirectory,
  rpcVaultIngestOpen,
  rpcVaultList,
  rpcVaultRecoverAck,
  rpcVaultRename,
  rpcVaultClose,
} from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable, safVaultPathRpcUnavailable } from "./safVaultRpcGuard";
import {
  contentTreeClaimedForCreate,
  importContentTree,
  releaseContentJob,
  takeContentTreeForJob,
  type ContentImportTree,
  type ContentTreeImportIo,
} from "./contentTreeImport";
import { releaseImportCache } from "./importCache";

const contentIo: ContentTreeImportIo = {
  createVault(input) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultCreate(input);
  },
  openSession(id, password) {
    return rpcVaultIngestOpen(id, password);
  },
  addDirectory(id, logicalPath) {
    return rpcVaultIngestDirectory(id, logicalPath);
  },
  addFile(id, logicalPath, uri) {
    return rpcImportContentUri(id, logicalPath, uri);
  },
  close(id, password) {
    return rpcVaultClose(id, password).then(() => undefined);
  },
  abort(id) {
    return rpcVaultDiscardImport(id);
  },
};

async function finishContentImport<T>(tree: ContentImportTree, run: () => Promise<T>): Promise<T> {
  try {
    assertSafVaultPathRpcAvailable();
    return await run();
  } finally {
    releaseContentJob(tree);
  }
}

async function finishImport<T>(path: string, run: () => Promise<T>): Promise<T> {
  try {
    assertSafVaultPathRpcAvailable();
    return await run();
  } finally {
    await releaseImportCache(path).catch(() => undefined);
  }
}

/** Native → `upriv-ffi` vault list / create / import / config / rename / delete / export. */
export const nativeVaultService = createLiveVaultService({
  async listVaults() {
    if (safVaultPathRpcUnavailable()) return [];
    return rpcVaultList();
  },
  createVault(input: CreateVaultInput) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultCreate(input);
  },
  async getSettings(vaultId) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultConfigGet(vaultId);
  },
  async storeOnDiskBytes(vaultId) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultStoreSize(vaultId);
  },
  async saveSettings(vaultId, config) {
    assertSafVaultPathRpcAvailable();
    await rpcVaultConfigSave(vaultId, config);
  },
  async rename(vaultId, displayName) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultRename(vaultId, displayName);
  },
  async deleteVault(vaultId) {
    assertSafVaultPathRpcAvailable();
    await rpcVaultDelete(vaultId);
  },
  async exportVault(vaultId, request) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExport(vaultId, request);
  },
  async exportVaultToPath(vaultId, request, destPath) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExportToPath(vaultId, request, destPath);
  },
  async exportCapabilities() {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExportCapabilities();
  },
  async probeExportPassword(vaultId, password) {
    assertSafVaultPathRpcAvailable();
    return rpcVaultExportProbe(vaultId, password);
  },
  importZip: (input) =>
    finishImport(input.importPackage?.archivePath ?? "", () => rpcVaultImportZip(input)),
  import7z: (input) =>
    finishImport(input.importPackage?.archivePath ?? "", () => rpcVaultImport7z(input)),
  importFilesZip: (input) =>
    finishImport(input.importPackage?.archivePath ?? "", () => rpcVaultImportFilesZip(input)),
  importOsPath: (input) => {
    const path = input.importPackage?.archivePath ?? "";
    const tree =
      contentTreeClaimedForCreate(input.settings.vault.id) ?? takeContentTreeForJob(path);
    if (tree) {
      return finishContentImport(tree, () => importContentTree(input, tree, contentIo));
    }
    if (isContentUri(path)) {
      return Promise.reject(new RpcError("invalid_request", "import folder is unavailable"));
    }
    return finishImport(path, () => rpcVaultImportOsPath(input));
  },
  recoverDirtyClose: async (vaultId) => {
    assertSafVaultPathRpcAvailable();
    await rpcVaultRecoverAck(vaultId);
  },
});
