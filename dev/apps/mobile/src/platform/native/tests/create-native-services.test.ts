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
  rpcVaultList: vi.fn(async () => []),
  rpcVaultCreate: vi.fn(),
  rpcVaultOpen: vi.fn(),
  rpcVaultClose: vi.fn(),
  rpcVaultConfigGet: vi.fn(),
  rpcVaultConfigSave: vi.fn(),
  rpcVaultRename: vi.fn(),
  rpcVaultDelete: vi.fn(),
  rpcVaultExport: vi.fn(),
  rpcVaultExportToPath: vi.fn(),
  rpcVaultExportCapabilities: vi.fn(async () => ({ sevenZip: true })),
  rpcVaultExportProbe: vi.fn(async () => true),
  rpcVaultImportZip: vi.fn(),
  rpcVaultImport7z: vi.fn(),
  rpcVaultImportProbe: vi.fn(async () => ({ ok: true, kind: "seven_zip" })),
  rpcVaultRecoverAck: vi.fn(),
  rpcVaultFsList: vi.fn(),
  rpcVaultFsRevision: vi.fn(),
  rpcVaultFsRead: vi.fn(),
  rpcVaultFsReadRange: vi.fn(),
  rpcVaultFsWrite: vi.fn(),
  rpcVaultFsWriteRange: vi.fn(),
  rpcVaultFsTruncate: vi.fn(),
  rpcVaultFsCreateFile: vi.fn(),
  rpcVaultFsCreateFolder: vi.fn(),
  rpcVaultFsEnsureFolder: vi.fn(),
  rpcVaultFsDelete: vi.fn(),
  rpcVaultFsRename: vi.fn(),
  rpcVaultFsMove: vi.fn(),
  rpcVaultFsOsPath: vi.fn(),
  rpcBackupList: vi.fn(async () => []),
  rpcBackupDelete: vi.fn(),
  rpcBackupPromote: vi.fn(),
  rpcBackupGet: vi.fn(),
  rpcBackupExportToPath: vi.fn(),
  rpcVaultGroupList: vi.fn(async () => ({ groups: [], invalid: false })),
  rpcVaultGroupCreate: vi.fn(),
  rpcVaultGroupUpdate: vi.fn(),
  rpcVaultGroupDelete: vi.fn(),
  rpcVaultGroupSetCollapsed: vi.fn(),
  rpcVaultGroupReorder: vi.fn(),
  rpcVaultGroupReorderGroupedVaults: vi.fn(),
  rpcVaultGroupRepair: vi.fn(),
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

  it("uses live vault list/open adapters in native builds", async () => {
    safState.activeUri = "";
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcVaultList).mockClear();
    const services = createNativeServices();
    await services.vault.listVaults();
    expect(rpc.rpcVaultList).toHaveBeenCalled();
    expect(services.lifecycle.validateLifecyclePassword("  secret  ")).toBe(true);
    expect(services.lifecycle.validateLifecyclePassword("   ")).toBe(false);
  });

  it("does not call path vault RPCs while a SAF tree is active", async () => {
    safState.activeUri = "content://tree/old";
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcVaultList).mockClear();
    vi.mocked(rpc.rpcVaultOpen).mockClear();
    vi.mocked(rpc.rpcVaultGroupList).mockClear();
    const services = createNativeServices();
    await expect(services.vault.listVaults()).resolves.toEqual([]);
    expect(rpc.rpcVaultList).not.toHaveBeenCalled();
    await expect(services.vaultGroups.list()).resolves.toEqual({ groups: [], invalid: false });
    expect(rpc.rpcVaultGroupList).not.toHaveBeenCalled();
    await expect(
      services.lifecycle.runOpeningPipeline("notes", () => undefined),
    ).rejects.toMatchObject({ code: "vault_saf_unavailable" });
    expect(rpc.rpcVaultOpen).not.toHaveBeenCalled();
  });

  it("skips the SAF assertion for zip and backup import probes", async () => {
    const { createNativeServices } = await importModule(false);
    const services = createNativeServices();
    await expect(
      services.createVault.testImportPackagePassword("x", {
        path: "/tmp/notes.zip",
        fileName: "notes.zip",
      }),
    ).resolves.toBe(true);
    await expect(
      services.createVault.testImportPackagePassword("x", {
        path: "vaults/notes/backups/20260528T120000",
        fileName: "20260528T120000",
        kind: "backup",
      }),
    ).resolves.toBe(true);
  });

  it("refuses path vault RPCs for import and backups while a SAF tree is active", async () => {
    const { createNativeServices } = await importModule(false);
    const services = createNativeServices();
    await expect(services.createVault.testImportPackagePassword("x")).rejects.toMatchObject({
      code: "vault_saf_unavailable",
    });
    await expect(services.backups.listBackups("vault-1")).rejects.toMatchObject({
      code: "vault_saf_unavailable",
    });
  });

  it("uses live backups when the vault-root is a filesystem path", async () => {
    safState.activeUri = "";
    const { createNativeServices } = await importModule(false);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcBackupList).mockClear();
    const services = createNativeServices();
    await expect(services.backups.listBackups("vault-1")).resolves.toEqual([]);
    expect(rpc.rpcBackupList).toHaveBeenCalledWith("vault-1");
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
