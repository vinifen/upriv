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
import {
  contentTreeClaimedForCreate,
  importContentTree,
  releaseContentJob,
  type ContentImportTree,
  type ContentTreeImportIo,
} from "./contentTreeImport";
import { releaseImportCache } from "./importCache";

const contentIo: ContentTreeImportIo = {
  createVault(input) {
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
    return await run();
  } finally {
    releaseContentJob(tree);
    await releaseImportCache(tree.directoryUri).catch(() => undefined);
  }
}

async function finishImport<T>(path: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    await releaseImportCache(path).catch(() => undefined);
  }
}

/** Native → `upriv-ffi` vault list / create / import / config / rename / delete / export. */
export const nativeVaultService = createLiveVaultService({
  async listVaults() {
    return rpcVaultList();
  },
  createVault(input: CreateVaultInput) {
    return rpcVaultCreate(input);
  },
  async getSettings(vaultId) {
    return rpcVaultConfigGet(vaultId);
  },
  async storeOnDiskBytes(vaultId) {
    return rpcVaultStoreSize(vaultId);
  },
  async saveSettings(vaultId, config) {
    await rpcVaultConfigSave(vaultId, config);
  },
  async rename(vaultId, displayName) {
    return rpcVaultRename(vaultId, displayName);
  },
  async deleteVault(vaultId) {
    await rpcVaultDelete(vaultId);
  },
  async exportVault(vaultId, request) {
    return rpcVaultExport(vaultId, request);
  },
  async exportVaultToPath(vaultId, request, destPath) {
    return rpcVaultExportToPath(vaultId, request, destPath);
  },
  async exportCapabilities() {
    return rpcVaultExportCapabilities();
  },
  async probeExportPassword(vaultId, password) {
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
    const tree = contentTreeClaimedForCreate(input.settings.vault.id);
    if (tree) {
      return finishContentImport(tree, () => importContentTree(input, tree, contentIo));
    }
    if (isContentUri(path)) {
      return Promise.reject(new RpcError("invalid_request", "import folder is unavailable"));
    }
    return finishImport(path, () => rpcVaultImportOsPath(input));
  },
  recoverDirtyClose: async (vaultId) => {
    await rpcVaultRecoverAck(vaultId);
  },
});
