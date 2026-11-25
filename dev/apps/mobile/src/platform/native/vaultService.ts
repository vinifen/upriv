import {
  createLiveVaultService,
  isContentUri,
  newJobId,
  parseImportBlocked,
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
  rpcVaultDeleteHurry,
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
  rememberContentTree,
  type ContentImportTree,
  type ContentTreeImportIo,
} from "./contentTreeImport";
import { releaseImportCache } from "./importCache";
import { mountDeviceTrees } from "./deviceTrees";
import { nativeExportTrees } from "./exportTrees";

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
  close(id, stopped) {
    return rpcVaultFinishImport(id, stopped);
  },
  abort(id) {
    return rpcVaultDiscardImport(id);
  },
};

/**
 * Run a picked folder's import, then let its listing go. An import refused for
 * items it names keeps the listing as the wizard's pick, so "Import without
 * them" can run it again; closing that window lets it go
 * (`releasePendingImport`).
 */
async function finishContentImport<T>(tree: ContentImportTree, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (parseImportBlocked(error)?.whole === false) rememberContentTree(tree);
    throw error;
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
  async saveSettings(vaultId, config, lists) {
    const saved = await rpcVaultConfigSave(vaultId, config, lists);
    // A row picked on this phone is reached at its tree's root.
    await mountDeviceTrees();
    return saved;
  },
  async rename(vaultId, displayName) {
    return rpcVaultRename(vaultId, displayName);
  },
  async deleteVault(vaultId, input) {
    return rpcVaultDelete(vaultId, input);
  },
  async hurryDelete(vaultId) {
    return rpcVaultDeleteHurry(vaultId);
  },
  // A picked folder is reached at its tree's root, so Rust writes the file straight into it.
  async exportVaultToFolder(vaultId, request, destDir, job) {
    return nativeExportTrees.withExportFolder(destDir, job, (dir) =>
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
    const { folders, removedVaults } = await rpcVaultUnfinishedSweep();
    for (const folder of folders) {
      await nativeExportTrees
        .withExportFolder(folder, newJobId(), () => rpcVaultUnfinishedSweep())
        .catch(() => undefined);
    }
    return { removedVaults };
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
