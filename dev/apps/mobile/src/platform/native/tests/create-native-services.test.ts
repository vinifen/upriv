import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError, createDefaultAppSettings } from "@upriv/shared";

const safState = {
  activeUri: "content://tree/old",
  inspectQueue: [] as Array<"absent" | "valid" | "incomplete" | "unauthorized" | "unreadable">,
  readSettings: '[package]\nlabel = "Upriv"\n',
};

const safRelease = vi.fn();
const safSetupRoot = vi.fn();
const toSafRpcError = vi.fn((error: unknown, treeUri: string) => {
  return new RpcError("io_error", `setup failed: ${String(error)} @ ${treeUri}`);
});

const mockServices = {
  vault: {
    listVaults: vi.fn(async () => []),
    getSettings: vi.fn(async () => undefined),
    registerSettings: vi.fn(async () => undefined),
    unregisterSettings: vi.fn(async () => undefined),
    getUnlockPreset: vi.fn(async () => undefined),
    setUnlockPreset: vi.fn(async () => undefined),
    getExportBytes: vi.fn(async () => new Uint8Array()),
  },
  vaultGroups: {},
  vaultRoot: {},
  appSettings: {},
  backups: {},
  logs: {},
  filesystem: {},
  lifecycle: {
    hasPasswordInSession: vi.fn(() => false),
    setPasswordInSession: vi.fn(),
    clearPasswordInSession: vi.fn(),
    openingStepCount: 1,
    closingStepCount: 1,
    runOpeningPipeline: vi.fn(async () => undefined),
    runClosingPipeline: vi.fn(async () => undefined),
    resolveWorkspacePath: vi.fn(() => "/tmp/workspace"),
    validateLifecyclePassword: vi.fn(() => true),
    isPipelineError: vi.fn(() => false),
    pipelineErrorCode: vi.fn(() => "unknown"),
  },
  createVault: {
    testImportPackagePassword: vi.fn(async () => true),
    selectImportPackageForProbe: vi.fn(() => ({ path: "/tmp/x.7z", fileName: "x.7z" })),
  },
  vaultSecurity: {},
};

vi.mock("@/platform/mocks", () => ({
  createMobileMockServices: () => mockServices,
}));

vi.mock("@/lib/rpc", () => ({
  rpcAppSettingsGet: vi.fn(async () => ({
    settings: createDefaultAppSettings(),
    rootPath: "/tmp/root",
    onDisk: true,
  })),
  rpcAppSettingsSave: vi.fn(async () => ({ wrote: true })),
  rpcAppSettingsParseToml: vi.fn(async () => createDefaultAppSettings()),
  rpcAppSettingsSerializeToml: vi.fn(async () => '[package]\nlabel = "Upriv"\n'),
  rpcLogDelete: vi.fn(async () => undefined),
  rpcLogEvent: vi.fn(async () => undefined),
  rpcLogGet: vi.fn(async () => undefined),
  rpcLogList: vi.fn(async () => []),
  rpcVaultRootDeactivateAlias: vi.fn(async () => undefined),
  rpcVaultRootDefaultRootStatus: vi.fn(async () => ({
    status: "valid",
    defaultRootAnchor: "/tmp",
  })),
  rpcVaultRootInspectPath: vi.fn(async () => ({ status: "valid", path: "/tmp" })),
  rpcVaultRootReadAlias: vi.fn(async () => null),
  rpcVaultRootResolve: vi.fn(async () => ({
    status: "found",
    rootPath: "/tmp",
    source: "default_root",
  })),
  rpcVaultRootSetupDefaultRoot: vi.fn(async () => ({ rootPath: "/tmp" })),
  rpcVaultRootSetupPath: vi.fn(async () => ({ rootPath: "/tmp", aliasPath: "/tmp/.upriv-root" })),
  rpcVaultRootSuggestedCustomPath: vi.fn(async () => "/tmp"),
}));

vi.mock("@/platform/native/pickVaultRootFolder", () => ({
  isAndroidSafUri: (path: string) => path.startsWith("content://"),
  pickVaultRootFolder: vi.fn(async () => "content://picked"),
}));

vi.mock("@/platform/native/safVaultRoot", () => ({
  isSafTreeUri: (path: string) => path.startsWith("content://"),
  safGetActiveUri: () => safState.activeUri,
  safInspectRoot: () => safState.inspectQueue.shift() ?? "valid",
  safPersist: vi.fn(),
  safRelease,
  safReadSettings: () => safState.readSettings,
  safSetActiveUri: (uri: string | null) => {
    safState.activeUri = uri ?? "";
  },
  safSetupRoot,
  safWriteSettings: vi.fn(),
  toSafRpcError,
}));

async function importModule(dev: boolean) {
  vi.resetModules();
  (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  return import("../createNativeServices");
}

describe("createNativeServices", () => {
  beforeEach(() => {
    safState.activeUri = "content://tree/old";
    safState.inspectQueue = [];
    safState.readSettings = '[package]\nlabel = "Upriv"\n';
    safRelease.mockReset();
    safSetupRoot.mockReset();
    toSafRpcError.mockClear();
  });

  it("releases previous SAF URI when leaving SAF mode", async () => {
    const { createNativeServices } = await importModule(true);
    const services = createNativeServices();
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "default_root";
    settings.app.upriv_root_path = "";
    await services.appSettings.save(settings);
    expect(safRelease).toHaveBeenCalledWith("content://tree/old");
  });

  it("does not swallow setup errors when SAF schema is incomplete", async () => {
    const { createNativeServices } = await importModule(true);
    safState.inspectQueue = ["absent", "valid"];
    safState.readSettings = "";
    safSetupRoot.mockImplementation(() => {
      throw new Error("create failed");
    });
    const services = createNativeServices();
    await expect(
      services.vaultRoot.setupAtPath("content://tree/new", {
        bootstrap: { locale: "en" },
      }),
    ).rejects.toBeInstanceOf(RpcError);
    expect(toSafRpcError).toHaveBeenCalled();
  });

  it("fails loud for vault and lifecycle in release mode", async () => {
    const { createNativeServices } = await importModule(false);
    const services = createNativeServices();
    await expect(services.vault.getSettings("vault-1")).rejects.toMatchObject({
      code: "not_implemented",
    });
    await expect(
      services.lifecycle.runOpeningPipeline("vault-1", () => undefined),
    ).rejects.toMatchObject({
      code: "not_implemented",
    });
    await expect(services.createVault.testImportPackagePassword("x")).rejects.toMatchObject({
      code: "not_implemented",
    });
    await expect(services.backups.listBackups("vault-1")).rejects.toMatchObject({
      code: "not_implemented",
    });
  });

  it("does not release SAF when leaving SAF if rustSave fails", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcAppSettingsSave).mockRejectedValueOnce(new RpcError("io_error", "disk"));
    const services = createNativeServices();
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "default_root";
    settings.app.upriv_root_path = "";
    await expect(services.appSettings.save(settings)).rejects.toMatchObject({ code: "io_error" });
    expect(safRelease).not.toHaveBeenCalled();
  });

  it("releases SAF when leaving SAF even if rustSave returns wrote: false", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcAppSettingsSave).mockResolvedValueOnce({ wrote: false });
    const services = createNativeServices();
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "default_root";
    settings.app.upriv_root_path = "";
    await expect(services.appSettings.save(settings)).resolves.toBe(false);
    expect(safRelease).toHaveBeenCalledWith("content://tree/old");
  });

  it("refuses SAF save when the tree is incomplete", async () => {
    const { createNativeServices } = await importModule(true);
    safState.activeUri = "content://tree/x";
    safState.inspectQueue = ["incomplete"];
    const services = createNativeServices();
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "custom_root";
    settings.app.upriv_root_path = "content://tree/x";
    await expect(services.appSettings.save(settings)).rejects.toMatchObject({
      code: "vault_root_incomplete",
    });
  });

  it("fails SAF inspect on unknown_method in release even when TOML looks like a marker", async () => {
    const { createNativeServices } = await importModule(false);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcAppSettingsParseToml).mockRejectedValueOnce(
      new RpcError("unknown_method", "stale ffi"),
    );
    safState.activeUri = "content://tree/x";
    safState.inspectQueue = ["valid"];
    safState.readSettings = '[package]\nlabel = "Upriv"\nvaults_dir = ".upriv/vaults"\n[app]\n';
    const services = createNativeServices();
    await expect(
      services.vaultRoot.resolve({ vaultRootMode: "custom_root" }),
    ).rejects.toMatchObject({
      code: "unknown_method",
    });
  });

  it("allows a strong-marker unknown_method fallback only in __DEV__", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcAppSettingsParseToml).mockRejectedValueOnce(
      new RpcError("unknown_method", "stale ffi"),
    );
    safState.activeUri = "content://tree/x";
    safState.inspectQueue = ["valid"];
    safState.readSettings = '[package]\nlabel = "Upriv"\nvaults_dir = ".upriv/vaults"\n[app]\n';
    const services = createNativeServices();
    await expect(
      services.vaultRoot.resolve({ vaultRootMode: "custom_root" }),
    ).resolves.toMatchObject({
      status: "found",
      rootPath: "content://tree/x",
    });
  });
});
