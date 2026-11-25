import {
  CLOSING_PIPELINE_STEP_COUNT,
  OPENING_PIPELINE_STEP_COUNT,
  RpcError,
  VAULT_ERROR_CODES,
  VAULT_PIPELINE_ERROR_CODES,
  VaultPipelineError,
  createDefaultAppSettings,
  isMockLifecyclePasswordValid,
  isRpcError,
  isVaultPipelineError,
  NO_LISTS_SAVED,
  runTimedPipeline,
  DEFAULT_KDF_UNLOCK_PRESET,
  displayNameToVaultId,
  normalizeStoredName,
  parseCloseVaultOutcome,
  UPRIV_WORKSPACE_PATH,
  VAULT_WELCOME_README_PATH,
  vaultExportFilename,
  type AppLogFile,
  type AppServices,
  type AppSettingsLoadResult,
  type CreateVaultInput,
  backupExportFilename,
  type DataFolderChoice,
  type DeviceGroups,
  type DeviceInfo,
  type VaultBackupEntry,
  type VaultBackupListing,
  type VaultListItem,
  type VaultPipelineError as VaultPipelineErrorType,
  type VaultRenameResult,
  type VaultSettingsConfig,
} from "@upriv/shared";
import {
  applyMockListChanges,
  cloneJson,
  remapVaultWorkspaceSnapshot,
  createAsyncVaultFileSystemService,
  clearMockVaultUnlockPreset,
  createMockVaultGroupService,
  createMockVaultSecurityService,
  getMockVaultUnlockPreset,
  importVaultFile,
  mockVaultExportBytes,
  resetVaultFileSession,
  resetVaultWorkspaceSnapshots,
  setMockVaultUnlockPreset,
  setVaultFileContent,
} from "@upriv/shared/testing";
import {
  knownMockVaultIds,
  listMockVaultSeedRows,
  registerMockVaultId,
  registerRemappedMockSeedVault,
  removeRemappedMockSeedVault,
  suppressMockSeedVaultId,
  unregisterMockVaultId,
} from "./data/vaults";
import { MOCK_VAULT_GROUPS } from "./data/vaultGroups";
import { MOCK_DEFAULT_ANCHOR, MOCK_VAULT_ROOT_URI } from "./data/paths";
import {
  getMockVaultSettings,
  registerMockVaultSettings,
  unregisterMockVaultSettings,
} from "./stores/vaultSettings";

/** Expo Go's stand-in for this phone. */
const MOCK_DEVICE: DeviceInfo = { id: "e".repeat(32), system: "android", os: "Android 15" };

/** Stands in for the upriv-core header probe round-trip. */
const MOCK_IMPORT_PASSWORD_TEST_MS = 400;

/** Pre-seeded so Expo Go lands on the vault list; Gate still re-resolves. */
let dataFolderConfigured = true;
let dataFolders: DeviceGroups<DataFolderChoice> = {};

let runtimeSettings = createDefaultAppSettings();
runtimeSettings = {
  ...runtimeSettings,
  app: { ...runtimeSettings.app, last_opened_vault: "my-encrypted-notes" },
};
let settingsOnDisk = true;

const vaultPasswordInRam = new Map<string, string>();

function setMockVaultsHidden(vaultIds: readonly string[], hidden: boolean) {
  for (const id of vaultIds) {
    const settings = getMockVaultSettings(id);
    if (settings.vault.hidden === hidden) continue;
    registerMockVaultSettings({
      ...settings,
      vault: { ...settings.vault, hidden },
    });
  }
}

const mockGroups = createMockVaultGroupService({
  getKnownVaultIds: () => knownMockVaultIds(),
  initialGroups: MOCK_VAULT_GROUPS,
  hideVaults: (ids) => setMockVaultsHidden(ids, true),
  unhideVaults: (ids) => setMockVaultsHidden(ids, false),
  onGroupHidden: () => appendMockLogEvent("vault_group_hidden"),
});

function mockOpenRamFails(vaultId: string): boolean {
  return vaultId === "cold-storage";
}

/** A backup of `vaultId` in the data folder's backups. */
function mockBackup(
  vaultId: string,
  stamp: string,
  sizeBytes: number,
  saved = false,
): VaultBackupEntry {
  const fileName = `${stamp}-${vaultId}.zip`;
  const place = saved ? `saves/${fileName}` : fileName;
  return {
    key: `data/${place}`,
    stamp,
    fileName,
    name: "",
    createdAt: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}.000Z`,
    sizeBytes,
    saved,
    path: `${MOCK_VAULT_ROOT_URI}/.upriv/vaults/${vaultId}/backups/${place}`,
    lowerUnlockRam: false,
  };
}

const MOCK_BACKUPS: Record<string, VaultBackupEntry[]> = {
  "my-encrypted-notes": [
    mockBackup("my-encrypted-notes", "20260601120000", 128_000),
    mockBackup("my-encrypted-notes", "20260520090000", 120_000, true),
  ],
  "work-documents": [mockBackup("work-documents", "20260602080000", 256_000)],
};

/** A vault's backups, all in the data folder's section. */
function mockBackupListing(vaultId: string): VaultBackupListing {
  return {
    sections: [
      {
        folder: "data",
        kind: "data_folder",
        path: `${MOCK_VAULT_ROOT_URI}/.upriv/vaults/${vaultId}/backups`,
        device: null,
        status: "ok",
        entries: (MOCK_BACKUPS[vaultId] ?? []).map((entry) => ({ ...entry })),
      },
    ],
  };
}

const MOCK_LOG_CURRENT = [
  "0001 2026-06-02T12:00:00.000Z INFO  app_start          version=0.1.0-beta source=mobile_mock",
  "0002 2026-06-02T12:00:01.120Z DEBUG vault_root_resolve status=ready",
  "0003 2026-06-02T12:00:02.400Z INFO  vault_list         count=5",
  "0004 2026-06-02T12:01:10.000Z WARN  unlock_failed      vault=work-documents",
].join("\n");

const MOCK_LOG_ROTATED = [
  "0001 2026-06-01T09:00:00.000Z INFO  app_start          version=0.1.0-beta",
  "0002 2026-06-01T09:00:04.000Z INFO  settings_save      wrote=true",
].join("\n");

const MOCK_LOGS: AppLogFile[] = [
  {
    filename: "current-000002-20260602120000.log",
    seq: 2,
    isCurrent: true,
    createdAt: "2026-06-02T12:00:00.000Z",
    sizeBytes: MOCK_LOG_CURRENT.length,
    lineCount: 4,
    lineCountExact: true,
    content: `${MOCK_LOG_CURRENT}\n`,
  },
  {
    filename: "000001-20260601090000.log",
    seq: 1,
    isCurrent: false,
    createdAt: "2026-06-01T09:00:00.000Z",
    sizeBytes: MOCK_LOG_ROTATED.length,
    lineCount: 2,
    lineCountExact: true,
    content: `${MOCK_LOG_ROTATED}\n`,
  },
];

function appendMockLogEvent(event: string, level: "INFO" | "WARN" | "ERROR" = "INFO") {
  const file = MOCK_LOGS.find((entry) => entry.isCurrent) ?? MOCK_LOGS[0];
  if (!file) return;
  const nextIndex = String(file.lineCount + 1).padStart(4, "0");
  file.content += `${nextIndex} ${new Date().toISOString()} ${level.padEnd(5)} ${event.padEnd(20)} \n`;
  file.lineCount += 1;
  file.sizeBytes = file.content.length;
}

/**
 * In-memory AppServices for Expo Go (no `upriv-ffi`).
 * Paths use `content://upriv.mock/...` stubs (SAF-shaped), not desktop FS paths.
 */
export function createMobileMockServices(): AppServices {
  const extraCreatedVaults: VaultListItem[] = [];

  async function mockRename(vaultId: string, displayName: string): Promise<VaultRenameResult> {
    const trimmed = normalizeStoredName(displayName);
    const listed = [
      ...listMockVaultSeedRows(),
      ...extraCreatedVaults.map((row) => structuredClone(row)),
    ];
    const existing = listed.map((row) => row.id).filter((id) => id !== vaultId);
    const newId = displayNameToVaultId(trimmed, existing);
    const idChanged = newId !== vaultId;
    const settings = getMockVaultSettings(vaultId);
    const nextSettings = {
      ...settings,
      vault: { ...settings.vault, id: newId, display_name: trimmed },
    };

    if (idChanged) {
      remapVaultWorkspaceSnapshot(vaultId, newId);
      if (runtimeSettings.app.last_opened_vault.trim() === vaultId) {
        runtimeSettings = {
          ...runtimeSettings,
          app: { ...runtimeSettings.app, last_opened_vault: newId },
        };
      }
      const preset = getMockVaultUnlockPreset(vaultId);
      unregisterMockVaultSettings(vaultId);
      clearMockVaultUnlockPreset(vaultId);
      unregisterMockVaultId(vaultId);

      const createdIdx = extraCreatedVaults.findIndex((row) => row.id === vaultId);
      if (createdIdx >= 0) {
        extraCreatedVaults[createdIdx] = {
          ...extraCreatedVaults[createdIdx],
          id: newId,
          displayName: trimmed,
        };
        registerMockVaultId(newId);
      } else {
        const seed = listMockVaultSeedRows().find((row) => row.id === vaultId);
        removeRemappedMockSeedVault(vaultId);
        suppressMockSeedVaultId(vaultId);
        registerRemappedMockSeedVault({
          ...(seed ?? {
            id: vaultId,
            displayName: trimmed,
            session: null,
            storageMode: settings.storage.mode,
            order: settings.vault.order,
            lastAccessedWhen: "—",
            lastAccessedAt: new Date().toISOString(),
            note: settings.vault.note,
            hidden: settings.vault.hidden,
          }),
          id: newId,
          displayName: trimmed,
        });
      }
      if (preset) setMockVaultUnlockPreset(newId, preset);
    } else {
      const createdIdx = extraCreatedVaults.findIndex((row) => row.id === vaultId);
      if (createdIdx >= 0) {
        extraCreatedVaults[createdIdx] = {
          ...extraCreatedVaults[createdIdx],
          displayName: trimmed,
        };
      }
    }

    registerMockVaultSettings(nextSettings);
    return {
      id: newId,
      previousId: vaultId,
      displayName: trimmed,
      idChanged,
    };
  }

  return {
    device: {
      async info() {
        return MOCK_DEVICE;
      },
    },
    vault: {
      canPersistSettings: true,
      canDeleteVault: true,
      canExportVault: true,
      async listVaults() {
        return [...listMockVaultSeedRows(), ...extraCreatedVaults].map((v) => {
          const settings = getMockVaultSettings(v.id);
          return {
            ...v,
            storageMode: settings.storage.mode,
            order: settings.vault.order,
            hidden: settings.vault.hidden,
            unlockPreset: getMockVaultUnlockPreset(v.id),
          };
        });
      },
      async createVault(input: CreateVaultInput) {
        const id = input.settings.vault.id.trim();
        const settings = { ...input.settings, vault: { ...input.settings.vault, id } };
        registerMockVaultSettings(settings);
        const unlockPreset = input.unlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET;
        setMockVaultUnlockPreset(id, unlockPreset);
        const item: VaultListItem = {
          id,
          displayName: settings.vault.display_name,
          session: null,
          storageMode: settings.storage.mode,
          order: settings.vault.order,
          lastAccessedWhen: "—",
          lastAccessedAt: new Date().toISOString(),
          note: settings.vault.note,
          passwordHint: settings.vault.password_hint || undefined,
          hidden: settings.vault.hidden,
          unlockPreset,
        };
        const existing = extraCreatedVaults.findIndex((row) => row.id === item.id);
        if (existing >= 0) extraCreatedVaults.splice(existing, 1);
        extraCreatedVaults.push(item);
        registerMockVaultId(item.id);
        if (input.welcome) {
          resetVaultFileSession(id);
          resetVaultWorkspaceSnapshots(id);
          importVaultFile(id, "/", VAULT_WELCOME_README_PATH.slice(1), input.welcome.readme);
          setVaultFileContent(id, UPRIV_WORKSPACE_PATH, input.welcome.workspace);
        }
        return { vault: item, leftOut: 0, stopped: false };
      },
      async diskUsage() {
        return null;
      },
      async getSettings(vaultId) {
        return getMockVaultSettings(vaultId);
      },
      async registerSettings(vaultId, config: VaultSettingsConfig, lists) {
        const saved = getMockVaultSettings(vaultId);
        registerMockVaultSettings({
          ...config,
          vault: { ...config.vault, id: vaultId },
          // As core: a save keeps the storage value; only the Storage change sets it.
          storage: saved.storage,
          unlocked_folder: {
            ...config.unlocked_folder,
            devices: lists
              ? applyMockListChanges(
                  saved.unlocked_folder.devices,
                  lists.unlockedFolder,
                  MOCK_DEVICE,
                )
              : saved.unlocked_folder.devices,
          },
          backup: {
            ...config.backup,
            devices: lists
              ? applyMockListChanges(saved.backup.devices, lists.backup, MOCK_DEVICE)
              : saved.backup.devices,
          },
        });
        return NO_LISTS_SAVED;
      },
      rename: mockRename,
      // A mock vault has no files to overwrite: the delete removes it at once.
      async deleteVault(vaultId: string) {
        unregisterMockVaultSettings(vaultId);
        clearMockVaultUnlockPreset(vaultId);
        const index = extraCreatedVaults.findIndex((row) => row.id === vaultId);
        if (index >= 0) extraCreatedVaults.splice(index, 1);
        unregisterMockVaultId(vaultId);
        suppressMockSeedVaultId(vaultId);
        removeRemappedMockSeedVault(vaultId);
        return { outside: "none" as const, folder: null };
      },
      async hurryDelete() {
        return false;
      },
      // A mock pick is not a real folder: report the file core would write there.
      async exportToFolder(vault, request, destDir) {
        // A `.7z` or a plain-text `.zip` unlocks the vault with its password, as core does.
        if (
          request.format !== "store_zip" &&
          !isMockLifecyclePasswordValid(request.password ?? "")
        ) {
          throw new RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD, "mock: wrong vault password");
        }
        const filename = vaultExportFilename(vault.displayName, request.format);
        return {
          path: `${destDir.replace(/\/+$/, "")}/${filename}`,
          size: mockVaultExportBytes(vault, request).byteLength,
          unreadable: [],
        };
      },
      async exportCapabilities() {
        return { sevenZip: true };
      },
      async sweepUnfinished() {
        return { removedVaults: [] };
      },
    },

    vaultGroups: mockGroups.service,

    // Mock exports and saves finish at once: nothing runs to watch or stop.
    jobs: {
      async status() {
        return null;
      },
      async cancel() {},
      async skipBackup() {
        return false;
      },
    },

    vaultRoot: {
      async resolve(options = {}) {
        const explicit = options.explicitPath?.trim();
        if (explicit) return { status: "found", rootPath: explicit, source: "explicit" };
        if (!dataFolderConfigured) {
          return {
            status: "needs_setup",
            defaultRootAnchor: MOCK_DEFAULT_ANCHOR,
            distribution: "installed",
            ended: [],
          };
        }
        return { status: "found", rootPath: MOCK_VAULT_ROOT_URI, source: "default" };
      },

      async list(options) {
        return {
          groups: options?.newList ? {} : cloneJson(dataFolders),
          osNames: {},
          defaultFolder: null,
          explicit: null,
        };
      },

      // Mock vaults keep nothing on disk.
      async size() {
        return 0;
      },

      async status(path) {
        return {
          state: "ok",
          content: path === null && dataFolderConfigured ? "valid" : "empty",
          details: null,
        };
      },

      async apply(request) {
        dataFolders = applyMockListChanges(
          request.newList ? {} : dataFolders,
          request.changes,
          MOCK_DEVICE,
        );
        const switched = !dataFolderConfigured;
        dataFolderConfigured = true;
        settingsOnDisk = true;
        return { rootPath: MOCK_VAULT_ROOT_URI, source: "default", switched, ended: [] };
      },

      async search() {
        return { found: false, switch: null, ended: [] };
      },

      async suggestedCustomRootPath() {
        return MOCK_DEFAULT_ANCHOR;
      },

      async pickFolder(defaultPath) {
        // Prefer real Android SAF when the OS picker is available (Expo Go / device).
        try {
          const { pickVaultRootFolder } = await import("@/platform/native/pickVaultRootFolder");
          const picked = await pickVaultRootFolder(defaultPath);
          if (picked) return picked;
        } catch (error) {
          if (isRpcError(error) && error.code === "unsupported_platform") {
            throw error;
          }
          /* fall through to stub */
        }
        return `${MOCK_DEFAULT_ANCHOR}/picked-${Date.now()}`;
      },
    },

    folderLists: {
      async status() {
        return { state: "ok", details: null };
      },
      async unlockedFolderInfo() {
        return { choice: { kind: "nothing" }, path: null, mounted: false };
      },
    },

    appSettings: {
      async load(): Promise<AppSettingsLoadResult> {
        return {
          settings: cloneJson(runtimeSettings),
          onDisk: settingsOnDisk,
          rootPath: settingsOnDisk ? MOCK_VAULT_ROOT_URI : null,
          osNames: {},
        };
      },
      async save(config, lists) {
        runtimeSettings = {
          ...cloneJson(config),
          unlocked_folders: {
            ...config.unlocked_folders,
            devices: lists
              ? applyMockListChanges(
                  runtimeSettings.unlocked_folders.devices,
                  lists.unlockedFolders,
                  MOCK_DEVICE,
                )
              : runtimeSettings.unlocked_folders.devices,
          },
          backups: {
            devices: lists
              ? applyMockListChanges(runtimeSettings.backups.devices, lists.backups, MOCK_DEVICE)
              : runtimeSettings.backups.devices,
          },
        };
        settingsOnDisk = true;
        return { wrote: true, ...NO_LISTS_SAVED };
      },
    },

    backups: {
      async listBackups(vaultId) {
        return mockBackupListing(vaultId);
      },
      async deleteBackups(vaultId, keys) {
        const gone = new Set(keys);
        MOCK_BACKUPS[vaultId] = (MOCK_BACKUPS[vaultId] ?? []).filter(
          (entry) => !gone.has(entry.key),
        );
      },
      async promoteToSave(vaultId, key) {
        MOCK_BACKUPS[vaultId] = (MOCK_BACKUPS[vaultId] ?? []).map((entry) =>
          entry.key === key ? mockBackup(vaultId, entry.stamp, entry.sizeBytes, true) : entry,
        );
      },
      async renameBackup(vaultId, key, name) {
        let renamed: VaultBackupEntry | null = null;
        MOCK_BACKUPS[vaultId] = (MOCK_BACKUPS[vaultId] ?? []).map((entry) => {
          if (entry.key !== key) return entry;
          renamed = { ...mockBackup(vaultId, entry.stamp, entry.sizeBytes, true), name };
          return renamed;
        });
        if (!renamed) throw new RpcError("backup_not_found", "mock: no such backup");
        return renamed;
      },
      async forgetFolder() {},
      async saveNow(vaultId) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-T:]/g, "");
        const entry = mockBackup(vaultId, stamp, 128_000, true);
        MOCK_BACKUPS[vaultId] = [entry, ...(MOCK_BACKUPS[vaultId] ?? [])];
        return { backup: { ...entry }, switches: [] };
      },
      async exportTo(vaultId, keys, destDir) {
        return { path: `${destDir}/${backupExportFilename(keys, vaultId)}`, size: keys.length };
      },
    },

    logs: {
      async listFiles() {
        return MOCK_LOGS.map((f) => ({ ...f }));
      },
      async deleteFiles(filenames) {
        const set = new Set(filenames);
        for (let i = MOCK_LOGS.length - 1; i >= 0; i -= 1) {
          if (set.has(MOCK_LOGS[i].filename)) MOCK_LOGS.splice(i, 1);
        }
      },
      async getFile(filename) {
        return MOCK_LOGS.find((f) => f.filename === filename);
      },
      async recordVaultHidden() {
        appendMockLogEvent("vault_hidden");
      },
      async recordVaultGroupHidden() {
        appendMockLogEvent("vault_group_hidden");
      },
      async recordImportCacheWipeFailed() {
        appendMockLogEvent("import_cache_wipe_failed", "WARN");
      },
    },

    filesystem: createAsyncVaultFileSystemService(),

    lifecycle: {
      hasPasswordInSession(vaultId) {
        return vaultPasswordInRam.has(vaultId);
      },
      setPasswordInSession(vaultId, password) {
        vaultPasswordInRam.set(vaultId, password);
      },
      clearPasswordInSession(vaultId) {
        vaultPasswordInRam.delete(vaultId);
      },
      openingStepCount: OPENING_PIPELINE_STEP_COUNT,
      closingStepCount: CLOSING_PIPELINE_STEP_COUNT,
      async runOpeningPipeline(vaultId, onStep) {
        await runTimedPipeline(OPENING_PIPELINE_STEP_COUNT, onStep, (stepIndex) => {
          if (stepIndex === 2 && mockOpenRamFails(vaultId)) {
            throw new VaultPipelineError(VAULT_PIPELINE_ERROR_CODES.INSUFFICIENT_RAM);
          }
        });
        return { switches: [], storageReset: null, importKept: false };
      },
      async runClosingPipeline(vaultId, onStep) {
        await runTimedPipeline(CLOSING_PIPELINE_STEP_COUNT, onStep);
        return parseCloseVaultOutcome(null);
      },
      async hurryClose() {
        return true;
      },
      async forgetPlainRecord() {},
      validateLifecyclePassword(password) {
        return isMockLifecyclePasswordValid(password);
      },
      isPipelineError(error: unknown): error is VaultPipelineErrorType {
        return isVaultPipelineError(error);
      },
      pipelineErrorCode(error) {
        return error.code;
      },
    },

    vaultSecurity: createMockVaultSecurityService({
      onPasswordChanged(vaultId) {
        const settings = getMockVaultSettings(vaultId);
        registerMockVaultSettings({
          ...settings,
          security: {
            ...settings.security,
            password_changed_at: new Date().toISOString(),
          },
        });
      },
      storageOf(vaultId) {
        return getMockVaultSettings(vaultId).storage;
      },
      onStorageChanged(vaultId, storage) {
        registerMockVaultSettings({ ...getMockVaultSettings(vaultId), storage });
      },
    }),

    createVault: {
      async testImportPackagePassword(password) {
        await new Promise((resolve) => setTimeout(resolve, MOCK_IMPORT_PASSWORD_TEST_MS));
        return { ok: password.length > 0, embedded: null, vaultName: null };
      },
      async readImportPackageSettings() {
        return {
          embedded: null,
          zipLayout: "store" as const,
          carriesWorkspace: false,
          vaultName: null,
        };
      },
      async selectImportPackageForProbe() {
        return {
          path: "content://upriv.mock/import/demo.zip",
          fileName: "demo.zip",
        };
      },
      async selectImportFolder() {
        return {
          path: "content://upriv.mock/import/Photos",
          fileName: "Photos",
        };
      },
    },
  };
}
