import {
  CLOSING_PIPELINE_STEP_COUNT,
  OPENING_PIPELINE_STEP_COUNT,
  VAULT_PIPELINE_ERROR_CODES,
  VaultPipelineError,
  createDefaultAppSettings,
  isMockLifecyclePasswordValid,
  isRpcError,
  isVaultPipelineError,
  resolveVaultMountPoint,
  runTimedPipeline,
  WORKSPACE_PATH_DEFAULT,
  DEFAULT_KDF_UNLOCK_PRESET,
  displayNameToVaultId,
  normalizeStoredName,
  type AppLogFile,
  type AppServices,
  type AppSettingsLoadResult,
  type CreateVaultInput,
  type VaultBackupEntry,
  type VaultListItem,
  type VaultPipelineError as VaultPipelineErrorType,
  type VaultRenameResult,
  type VaultRootMode,
  type VaultSettingsConfig,
} from "@upriv/shared";
import {
  cloneJson,
  remapVaultWorkspaceSnapshot,
  createAsyncVaultFileSystemService,
  clearMockVaultUnlockPreset,
  createMockVaultGroupService,
  createMockVaultSecurityService,
  getMockVaultUnlockPreset,
  mockVaultExportBytes,
  setMockVaultUnlockPreset,
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
import { MOCK_ALIAS_URI, MOCK_DEFAULT_ANCHOR, MOCK_VAULT_ROOT_URI } from "./data/paths";
import {
  getMockVaultSettings,
  registerMockVaultSettings,
  unregisterMockVaultSettings,
} from "./stores/vaultSettings";

interface MockVaultRootState {
  configured: boolean;
  rootPath: string;
  aliasPath?: string;
  aliasActive: boolean;
}

/** Stands in for the upriv-core header probe round-trip. */
const MOCK_IMPORT_PASSWORD_TEST_MS = 400;

/** Pre-seeded so Expo Go lands on the vault list; Gate still re-resolves. */
let runtimeRoot: MockVaultRootState = {
  configured: true,
  rootPath: MOCK_VAULT_ROOT_URI,
  aliasPath: MOCK_ALIAS_URI,
  aliasActive: false,
};

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

function mockCloseGateFails(vaultId: string): boolean {
  return vaultPasswordInRam.get(vaultId) === "gatefail";
}

const MOCK_BACKUPS: Record<string, VaultBackupEntry[]> = {
  "my-encrypted-notes": [
    {
      stamp: "20260601T120000",
      createdAt: "2026-06-01T12:00:00.000Z",
      sizeBytes: 128_000,
    },
    {
      stamp: "20260520T090000",
      createdAt: "2026-05-20T09:00:00.000Z",
      sizeBytes: 120_000,
      saved: true,
    },
  ],
  "work-documents": [
    {
      stamp: "20260602T080000",
      createdAt: "2026-06-02T08:00:00.000Z",
      sizeBytes: 256_000,
    },
  ],
};

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
    vault: {
      canPersistSettings: true,
      canDeleteVault: true,
      canExportVault: true,
      async listVaults() {
        return [...listMockVaultSeedRows(), ...extraCreatedVaults].map((v) => {
          const settings = getMockVaultSettings(v.id);
          return {
            ...v,
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
        return item;
      },
      async getSettings(vaultId) {
        return getMockVaultSettings(vaultId);
      },
      async registerSettings(vaultId, config: VaultSettingsConfig) {
        registerMockVaultSettings({ ...config, vault: { ...config.vault, id: vaultId } });
      },
      rename: mockRename,
      async unregisterSettings(vaultId) {
        unregisterMockVaultSettings(vaultId);
        clearMockVaultUnlockPreset(vaultId);
        const index = extraCreatedVaults.findIndex((row) => row.id === vaultId);
        if (index >= 0) extraCreatedVaults.splice(index, 1);
        unregisterMockVaultId(vaultId);
        suppressMockSeedVaultId(vaultId);
        removeRemappedMockSeedVault(vaultId);
      },
      async recoverDirtyClose() {},
      async getUnlockPreset(vaultId) {
        return getMockVaultUnlockPreset(vaultId);
      },
      async setUnlockPreset(vaultId, preset) {
        setMockVaultUnlockPreset(vaultId, preset);
      },
      async getExportBytes(vault, request) {
        return mockVaultExportBytes(vault, request);
      },
      async exportToPath(vault, request, destPath) {
        const data = mockVaultExportBytes(vault, request);
        return { path: destPath, size: data.byteLength };
      },
      async exportCapabilities() {
        return { sevenZip: true };
      },
      async probeExportPassword(_vaultId, password) {
        return isMockLifecyclePasswordValid(password);
      },
    },

    vaultGroups: mockGroups.service,

    vaultRoot: {
      async resolve(options = {}) {
        const vaultRootMode: VaultRootMode = options.vaultRootMode ?? "default_root";
        const explicit = options.explicitPath?.trim();
        if (explicit) {
          return { status: "found", rootPath: explicit, source: "explicit" };
        }
        if (!runtimeRoot.configured) {
          return {
            status: "needs_setup",
            aliasPath: MOCK_ALIAS_URI,
            defaultRootAnchor: MOCK_DEFAULT_ANCHOR,
            distribution: "installed",
          };
        }
        if (vaultRootMode === "custom_root") {
          const path = runtimeRoot.aliasPath?.trim() || runtimeRoot.rootPath;
          if (!path || !runtimeRoot.aliasActive) {
            return {
              status: "needs_setup",
              aliasPath: MOCK_ALIAS_URI,
              defaultRootAnchor: MOCK_DEFAULT_ANCHOR,
              distribution: "installed",
            };
          }
          return { status: "found", rootPath: path, source: "custom_root" };
        }
        return {
          status: "found",
          rootPath: runtimeRoot.rootPath || MOCK_VAULT_ROOT_URI,
          source: "default_root",
        };
      },

      async setupDefaultRoot() {
        runtimeRoot = {
          configured: true,
          rootPath: MOCK_VAULT_ROOT_URI,
          aliasPath: runtimeRoot.aliasPath,
          aliasActive: false,
        };
        settingsOnDisk = true;
        return { rootPath: MOCK_VAULT_ROOT_URI };
      },

      async setupAtPath(path: string) {
        const rootPath = path.trim() || MOCK_VAULT_ROOT_URI;
        runtimeRoot = {
          configured: true,
          rootPath,
          aliasPath: rootPath,
          aliasActive: true,
        };
        settingsOnDisk = true;
        return { rootPath, aliasPath: MOCK_ALIAS_URI };
      },

      async readAlias() {
        if (!runtimeRoot.aliasPath) return null;
        return {
          path: runtimeRoot.aliasPath,
          active: runtimeRoot.aliasActive,
        };
      },

      async defaultRootStatus() {
        return {
          status: runtimeRoot.configured ? ("valid" as const) : ("absent" as const),
          defaultRootAnchor: MOCK_DEFAULT_ANCHOR,
        };
      },

      async inspectAtPath(path: string) {
        const trimmed = path.trim();
        if (!trimmed) {
          return { status: "absent", path: trimmed };
        }
        if (runtimeRoot.configured && trimmed === runtimeRoot.rootPath) {
          return { status: "valid", path: trimmed };
        }
        return { status: "absent", path: trimmed };
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

    appSettings: {
      async load(): Promise<AppSettingsLoadResult> {
        return {
          settings: cloneJson(runtimeSettings),
          onDisk: settingsOnDisk,
          rootPath: settingsOnDisk ? runtimeRoot.rootPath : null,
        };
      },
      async save(config) {
        runtimeSettings = cloneJson(config);
        settingsOnDisk = true;
        return true;
      },
    },

    backups: {
      async listBackups(vaultId) {
        return (MOCK_BACKUPS[vaultId] ?? []).map((b) => ({ ...b }));
      },
      async deleteBackups(vaultId, stamps) {
        const list = MOCK_BACKUPS[vaultId];
        if (!list) return;
        const set = new Set(stamps);
        MOCK_BACKUPS[vaultId] = list.filter((b) => !set.has(b.stamp));
      },
      async promoteToSave(vaultId, stamp) {
        const list = MOCK_BACKUPS[vaultId];
        if (!list) return;
        for (const entry of list) {
          if (entry.stamp === stamp) entry.saved = true;
        }
      },
      async getBackupBytes(_vaultId, entry) {
        const header = `[Upriv mock backup]\n${entry.stamp}\n${entry.saved ? "saved\n" : ""}`;
        return new TextEncoder().encode(header);
      },
      async exportToPath(_vaultId, entry, destPath) {
        const header = `[Upriv mock backup]\n${entry.stamp}\n${entry.saved ? "saved\n" : ""}`;
        const data = new TextEncoder().encode(header);
        return { path: destPath, size: data.byteLength };
      },
      async exportSnapshotsToPath(_vaultId, stamps, destPath) {
        return { path: destPath, size: stamps.length };
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
      },
      async runClosingPipeline(vaultId, onStep) {
        await runTimedPipeline(CLOSING_PIPELINE_STEP_COUNT, onStep, (stepIndex) => {
          if (stepIndex === 0 && mockCloseGateFails(vaultId)) {
            throw new VaultPipelineError(VAULT_PIPELINE_ERROR_CODES.HEADER_TEST_FAILED);
          }
        });
        return { backupFailed: false };
      },
      resolveWorkspacePath(displayName, options) {
        return (
          resolveVaultMountPoint(
            options?.globalWorkspacePath ?? runtimeSettings.workspace.path,
            options?.mountWorkspacePath ?? WORKSPACE_PATH_DEFAULT,
            displayName,
          ) ?? ""
        );
      },
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

    vaultSecurity: createMockVaultSecurityService(),

    createVault: {
      async testImportPackagePassword(password) {
        await new Promise((resolve) => setTimeout(resolve, MOCK_IMPORT_PASSWORD_TEST_MS));
        return password.length > 0;
      },
      async selectImportPackageForProbe() {
        return {
          path: "content://upriv.mock/import/demo.zip",
          fileName: "demo.zip",
        };
      },
    },
  };
}
