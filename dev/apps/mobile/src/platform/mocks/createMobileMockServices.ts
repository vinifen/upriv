import {
  CLOSING_PIPELINE_STEP_COUNT,
  OPENING_PIPELINE_STEP_COUNT,
  VAULT_PIPELINE_ERROR_CODES,
  VaultPipelineError,
  createDefaultAppSettings,
  createMockVaultGroupService,
  isVaultPipelineError,
  runTimedPipeline,
  type AppLogFile,
  type AppServices,
  type AppSettingsLoadResult,
  type VaultBackupEntry,
  type VaultPipelineError as VaultPipelineErrorType,
  type VaultRootMode,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { MOCK_VAULTS, knownMockVaultIds } from "./data/vaults";
import { MOCK_VAULT_GROUPS } from "./data/vaultGroups";
import { MOCK_ALIAS_URI, MOCK_DEFAULT_ANCHOR, MOCK_VAULT_ROOT_URI } from "./data/paths";
import {
  createVaultFolder,
  createVaultFile,
  deleteVaultPath,
  ensureVaultFolder,
  getVaultFileContent,
  getVaultFileTree,
  getVaultTreeRevision,
  importVaultFile,
  isVaultFileEditable,
  isVaultFileImage,
  isVaultFileViewable,
  moveVaultPath,
  renameVaultPath,
  resetVaultFileSession,
  setVaultFileContent,
  vaultFileLanguageFromPath,
} from "./stores/fileSystem";
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

/** Pre-seeded so Expo Go lands on the vault list; Gate still re-resolves. */
let runtimeRoot: MockVaultRootState = {
  configured: true,
  rootPath: MOCK_VAULT_ROOT_URI,
  aliasPath: MOCK_ALIAS_URI,
  aliasActive: false,
};

let runtimeSettings = createDefaultAppSettings();
let settingsOnDisk = true;

const vaultPasswordInRam = new Map<string, string>();

const mockGroups = createMockVaultGroupService({
  getKnownVaultIds: () => knownMockVaultIds(),
  initialGroups: MOCK_VAULT_GROUPS,
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
      filename: "My Encrypted Notes-20260601-120000.7z",
      createdAt: "2026-06-01T12:00:00.000Z",
      sizeBytes: 128_000,
    },
    {
      filename: "My Encrypted Notes-20260520-090000.7z",
      createdAt: "2026-05-20T09:00:00.000Z",
      sizeBytes: 120_000,
      saved: true,
    },
  ],
  "work-documents": [
    {
      filename: "Work Documents-20260602-080000.7z",
      createdAt: "2026-06-02T08:00:00.000Z",
      sizeBytes: 256_000,
    },
  ],
};

const MOCK_LOGS: AppLogFile[] = [
  {
    filename: "current-20260602120000.log",
    seq: 0,
    isCurrent: true,
    createdAt: "2026-06-02T12:00:00.000Z",
    sizeBytes: 420,
    lineCount: 12,
    lineCountExact: true,
    content: "INFO 0001 2026-06-02T12:00:00.000Z app_start version=0.1.0-beta source=mobile_mock\n",
  },
];

/**
 * In-memory AppServices for Expo Go until the native Rust bridge lands.
 * Paths use `content://upriv.mock/...` stubs (SAF-shaped), not desktop FS paths.
 */
export function createMobileMockServices(): AppServices {
  return {
    vault: {
      async listVaults() {
        return MOCK_VAULTS.map((v) => ({ ...v }));
      },
      async getSettings(vaultId) {
        return getMockVaultSettings(vaultId);
      },
      async registerSettings(vaultId, config: VaultSettingsConfig) {
        registerMockVaultSettings({ ...config, vault: { ...config.vault, id: vaultId } });
      },
      async unregisterSettings(vaultId) {
        unregisterMockVaultSettings(vaultId);
      },
      async getArchiveExportBytes() {
        return new Uint8Array([0x37, 0x7a]);
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
        } catch {
          /* fall through to stub */
        }
        return `${MOCK_DEFAULT_ANCHOR}/picked-${Date.now()}`;
      },
    },

    appSettings: {
      async load(): Promise<AppSettingsLoadResult> {
        return {
          settings: structuredClone(runtimeSettings),
          onDisk: settingsOnDisk,
          rootPath: settingsOnDisk ? runtimeRoot.rootPath : null,
        };
      },
      async save(config) {
        runtimeSettings = structuredClone(config);
        settingsOnDisk = true;
        return true;
      },
    },

    backups: {
      async listBackups(vaultId) {
        return (MOCK_BACKUPS[vaultId] ?? []).map((b) => ({ ...b }));
      },
      async deleteBackups(vaultId, filenames) {
        const list = MOCK_BACKUPS[vaultId];
        if (!list) return;
        const set = new Set(filenames);
        MOCK_BACKUPS[vaultId] = list.filter((b) => !set.has(b.filename));
      },
      async promoteToSave(vaultId, filename) {
        const list = MOCK_BACKUPS[vaultId];
        if (!list) return;
        for (const entry of list) {
          if (entry.filename === filename) entry.saved = true;
        }
      },
      async getBackupBytes() {
        return new Uint8Array([0x37, 0x7a]);
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
        const file = MOCK_LOGS.find((entry) => entry.isCurrent) ?? MOCK_LOGS[0];
        if (!file) return;
        const nextIndex = String(file.lineCount + 1).padStart(4, "0");
        file.content += `${nextIndex} ${new Date().toISOString()} INFO  vault_hidden          \n`;
        file.lineCount += 1;
        file.sizeBytes = file.content.length;
      },
    },

    filesystem: {
      resetSession(vaultId) {
        resetVaultFileSession(vaultId);
      },
      getTreeRevision(vaultId) {
        return getVaultTreeRevision(vaultId);
      },
      getFileTree(vaultId) {
        return getVaultFileTree(vaultId);
      },
      getFileContent(vaultId, path) {
        return getVaultFileContent(vaultId, path);
      },
      isFileEditable(vaultId, path) {
        return isVaultFileEditable(vaultId, path);
      },
      isFileViewable(vaultId, path) {
        return isVaultFileViewable(vaultId, path);
      },
      isFileImage(vaultId, path) {
        return isVaultFileImage(vaultId, path);
      },
      setFileContent(vaultId, path, content) {
        return setVaultFileContent(vaultId, path, content);
      },
      createFile(vaultId, parentPath, baseName) {
        return createVaultFile(vaultId, parentPath, baseName);
      },
      importFile(vaultId, parentPath, fileName, content) {
        return importVaultFile(vaultId, parentPath, fileName, content);
      },
      createFolder(vaultId, parentPath, baseName) {
        return createVaultFolder(vaultId, parentPath, baseName);
      },
      ensureFolder(vaultId, parentPath, folderName) {
        return ensureVaultFolder(vaultId, parentPath, folderName);
      },
      renamePath(vaultId, path, newName) {
        return renameVaultPath(vaultId, path, newName);
      },
      deletePath(vaultId, path) {
        return deleteVaultPath(vaultId, path);
      },
      movePath(vaultId, fromPath, toFolderPath) {
        return moveVaultPath(vaultId, fromPath, toFolderPath);
      },
      languageFromPath(path) {
        return vaultFileLanguageFromPath(path);
      },
    },

    lifecycle: {
      hasPasswordInSession(vaultId) {
        return vaultPasswordInRam.has(vaultId);
      },
      setPasswordInSession(vaultId, password) {
        vaultPasswordInRam.set(vaultId, password.trim());
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
            throw new VaultPipelineError(VAULT_PIPELINE_ERROR_CODES.ARCHIVE_TEST_FAILED);
          }
        });
      },
      resolveWorkspacePath(displayName) {
        return `content://upriv.mock/workspace/${encodeURIComponent(displayName)}`;
      },
      validateLifecyclePassword(password) {
        const trimmed = password.trim();
        return trimmed.length >= 4 && trimmed !== "wrong";
      },
      isPipelineError(error: unknown): error is VaultPipelineErrorType {
        return isVaultPipelineError(error);
      },
      pipelineErrorCode(error) {
        return error.code;
      },
    },

    createVault: {
      testImportArchivePassword(password) {
        return password.length > 0;
      },
      selectImportArchiveForProbe() {
        return {
          path: "content://upriv.mock/import/demo.7z",
          fileName: "demo.7z",
        };
      },
    },
  };
}

/** Dev helper: force Gate NeedsSetup on next resolve. */
export function resetMobileMockVaultRoot() {
  runtimeRoot = {
    configured: false,
    rootPath: "",
    aliasActive: false,
  };
  settingsOnDisk = false;
}
