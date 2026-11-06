import {
  createLiveVaultService,
  isContentUri,
  newJobId,
  RpcError,
  type CreateVaultInput,
} from "@upriv/shared";
import {
  rpcImportContentUri,
  rpcVaultConfigGet,
  rpcVaultDiskUsage,
  rpcVaultConfigSave,
  rpcVaultCreate,
  rpcVaultDelete,
  rpcVaultDiscardImport,
  rpcVaultExportCapabilities,
  rpcVaultExportToFolder,
  rpcVaultImport7z,
  rpcVaultImportFilesZip,
  rpcVaultImportOsPath,
  rpcVaultImportZip,
  rpcVaultIngestDirectory,
  rpcVaultIngestOpen,
  rpcVaultFinishImport,
  rpcVaultList,
  rpcVaultRename,
  rpcVaultUnfinishedSweep,
} from "@/lib/rpc";
import {
  contentTreeClaimedForCreate,
  importContentTree,
  releaseContentJob,
  type ContentImportTree,
  type ContentTreeImportIo,
} from "./contentTreeImport";
import { releaseImportCache } from "./importCache";
import { nativeSafExportMount } from "./safExportMount";

const contentIo: ContentTreeImportIo = {
  createVault(input, job) {
    return rpcVaultCreate(input, job, true);
  },
  openSession(id, password) {
    return rpcVaultIngestOpen(id, password);
  },
  addDirectory(id, logicalPath) {
    return rpcVaultIngestDirectory(id, logicalPath);
  },
  addFile(id, logicalPath, uri, job) {
    return rpcImportContentUri(id, logicalPath, uri, job);
  },
  close(id) {
    return rpcVaultFinishImport(id);
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
  createVault(input: CreateVaultInput, job) {
    return rpcVaultCreate(input, job);
  },
  async getSettings(vaultId) {
    return rpcVaultConfigGet(vaultId);
  },
  async diskUsage(vaultId) {
    return rpcVaultDiskUsage(vaultId);
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
  // A picked folder is mounted for the export, so Rust writes the file straight into it.
  async exportVaultToFolder(vaultId, request, destDir, job) {
    return nativeSafExportMount.withExportFolder(destDir, job, (dir) =>
      rpcVaultExportToFolder(vaultId, request, dir, job),
    );
  },
  async exportCapabilities() {
    return rpcVaultExportCapabilities();
  },
  // Rust reaches a picked folder only while it is mounted, so each one that
  // holds a leftover is mounted for a second sweep. Its access stays after a
  // kill, because nothing ran to release it. A folder that no longer answers
  // keeps its record for the next launch.
  async sweepUnfinished() {
    const { folders } = await rpcVaultUnfinishedSweep();
    for (const folder of folders) {
      await nativeSafExportMount
        .withExportFolder(folder, newJobId(), () => rpcVaultUnfinishedSweep())
        .catch(() => undefined);
    }
  },
  importZip: (input, job) =>
    finishImport(input.importPackage?.archivePath ?? "", () => rpcVaultImportZip(input, job)),
  import7z: (input, job) =>
    finishImport(input.importPackage?.archivePath ?? "", () => rpcVaultImport7z(input, job)),
  importFilesZip: (input, job) =>
    finishImport(input.importPackage?.archivePath ?? "", () => rpcVaultImportFilesZip(input, job)),
  importOsPath: (input, job) => {
    const path = input.importPackage?.archivePath ?? "";
    const tree = contentTreeClaimedForCreate(input.settings.vault.id);
    if (tree) {
      return finishContentImport(tree, () => importContentTree(input, tree, contentIo, job));
    }
    if (isContentUri(path)) {
      return Promise.reject(new RpcError("invalid_request", "import folder is unavailable"));
    }
    return finishImport(path, () => rpcVaultImportOsPath(input, job));
  },
});
