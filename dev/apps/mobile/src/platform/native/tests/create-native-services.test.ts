import { beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError, createDefaultAppSettings } from "@upriv/shared";

const safState = {
  activeUri: "content://tree/old",
  documentsUri: "content://documents/Upriv" as string | null,
  inspectQueue: [] as Array<"absent" | "valid" | "incomplete" | "unauthorized" | "unreadable">,
  readSettings: '[package]\nlabel = "Upriv"\n',
};

const safRelease = vi.fn();
const safSetupRoot = vi.fn();
const safPersist = vi.fn();
const mountSafRoot = vi.fn();
const unmountSafRoot = vi.fn();
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
  rpcVaultStoreSize: vi.fn(async () => 0),
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
  safPersist,
  mountSafRoot,
  unmountSafRoot,
  safRelease,
  safDocumentsInitialUri: () => safState.documentsUri,
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
    safState.documentsUri = "content://documents/Upriv";
    safState.inspectQueue = [];
    safState.readSettings = '[package]\nlabel = "Upriv"\n';
    safRelease.mockReset();
    safSetupRoot.mockReset();
    safPersist.mockReset();
    mountSafRoot.mockReset();
    unmountSafRoot.mockReset();
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

  it("sets up a filesystem path through rust", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcVaultRootSetupPath).mockClear();
    vi.mocked(rpc.rpcVaultRootDeactivateAlias).mockClear();
    vi.mocked(rpc.rpcVaultRootResolve).mockResolvedValueOnce({
      status: "found",
      rootPath: "/storage/emulated/0/Download",
      source: "custom_root",
    });
    const services = createNativeServices();
    await expect(
      services.vaultRoot.resolve({ vaultRootMode: "custom_root" }),
    ).resolves.toMatchObject({
      status: "found",
      rootPath: "/storage/emulated/0/Download",
      source: "custom_root",
    });
    expect(rpc.rpcVaultRootResolve).toHaveBeenCalledTimes(1);
    expect(rpc.rpcVaultRootDeactivateAlias).not.toHaveBeenCalled();
    await services.vaultRoot.setupAtPath("/storage/emulated/0/Download");
    expect(rpc.rpcVaultRootSetupPath).toHaveBeenCalledWith(
      "/storage/emulated/0/Download",
      undefined,
    );
  });

  it("creates a data folder on a storage-access tree", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcVaultRootSetupPath).mockClear();
    const services = createNativeServices();
    await expect(
      services.vaultRoot.setupAtPath("content://tree/new", {
        bootstrap: { locale: "en" },
      }),
    ).resolves.toMatchObject({ rootPath: "content://tree/new" });
    expect(safPersist).toHaveBeenCalledWith("content://tree/new");
    expect(mountSafRoot).toHaveBeenCalledWith("content://tree/new");
    expect(rpc.rpcVaultRootSetupPath).toHaveBeenCalledWith("/upriv-saf-root", {
      bootstrap: { locale: "en" },
      adoptPrivateRoot: true,
    });
    expect(safSetupRoot).not.toHaveBeenCalled();
    expect(safState.activeUri).toBe("content://tree/new");
    expect(safRelease).toHaveBeenCalledWith("content://tree/old");
  });

  it("starts the folder confirmation on Documents", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcVaultRootSuggestedCustomPath).mockClear();
    const services = createNativeServices();
    await expect(services.vaultRoot.suggestedCustomRootPath()).resolves.toBe(
      "content://documents/Upriv",
    );
    expect(rpc.rpcVaultRootSuggestedCustomPath).not.toHaveBeenCalled();

    safState.documentsUri = null;
    await expect(services.vaultRoot.suggestedCustomRootPath()).resolves.toBe("/tmp");
    expect(rpc.rpcVaultRootSuggestedCustomPath).toHaveBeenCalledTimes(1);
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

  it("calls path vault RPCs while a SAF tree is active", async () => {
    safState.activeUri = "content://tree/old";
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcVaultList).mockClear();
    vi.mocked(rpc.rpcVaultOpen).mockClear();
    vi.mocked(rpc.rpcVaultGroupList).mockClear();
    const services = createNativeServices();
    await services.vault.listVaults();
    expect(rpc.rpcVaultList).toHaveBeenCalled();
    await services.vaultGroups.list();
    expect(rpc.rpcVaultGroupList).toHaveBeenCalled();
    await services.lifecycle.runOpeningPipeline("notes", () => undefined);
    expect(rpc.rpcVaultOpen).toHaveBeenCalled();
  });

  it("skips the SAF assertion for zip and backup import probes", async () => {
    const { createNativeServices } = await importModule(false);
    const services = createNativeServices();
    await expect(
      services.createVault.testImportPackagePassword("x", {
        path: "/tmp/notes.zip",
        fileName: "notes.zip",
      }),
    ).resolves.toEqual({ ok: true, embedded: null });
    await expect(
      services.createVault.testImportPackagePassword("x", {
        path: "vaults/notes/backups/20260528T120000",
        fileName: "20260528T120000",
        kind: "backup",
      }),
    ).resolves.toEqual({ ok: true, embedded: null });
  });

  it("calls import and backup RPCs while a SAF tree is active", async () => {
    const { createNativeServices } = await importModule(false);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcBackupList).mockClear();
    const services = createNativeServices();
    await expect(services.createVault.testImportPackagePassword("x")).resolves.toEqual({
      ok: false,
      embedded: null,
    });
    await expect(services.backups.listBackups("vault-1")).resolves.toEqual([]);
    expect(rpc.rpcBackupList).toHaveBeenCalledWith("vault-1");
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

  it("remounts the previous folder when a storage-access save fails", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    safState.activeUri = "content://tree/old";
    vi.mocked(rpc.rpcAppSettingsSave).mockRejectedValueOnce(new Error("disk"));
    const services = createNativeServices();
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "custom_root";
    settings.app.upriv_root_path = "content://tree/new";
    await expect(services.appSettings.save(settings)).rejects.toThrow("disk");
    expect(mountSafRoot).toHaveBeenNthCalledWith(1, "content://tree/new");
    expect(mountSafRoot).toHaveBeenNthCalledWith(2, "content://tree/old");
    expect(safState.activeUri).toBe("content://tree/old");
    expect(safRelease).not.toHaveBeenCalled();
  });

  it("remounts the previous folder when a storage-access save does not write", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    safState.activeUri = "content://tree/old";
    vi.mocked(rpc.rpcAppSettingsSave).mockResolvedValueOnce({ wrote: false });
    const services = createNativeServices();
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "custom_root";
    settings.app.upriv_root_path = "content://tree/new";
    await expect(services.appSettings.save(settings)).resolves.toBe(false);
    expect(mountSafRoot).toHaveBeenNthCalledWith(2, "content://tree/old");
    expect(safState.activeUri).toBe("content://tree/old");
    expect(safRelease).not.toHaveBeenCalled();
  });

  it("saves a storage-access path as the logical data folder", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    vi.mocked(rpc.rpcAppSettingsSave).mockClear();
    safState.activeUri = "content://tree/x";
    const services = createNativeServices();
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "custom_root";
    settings.app.upriv_root_path = "content://tree/x";
    await expect(services.appSettings.save(settings)).resolves.toBe(true);
    expect(mountSafRoot).toHaveBeenCalledWith("content://tree/x");
    expect(rpc.rpcAppSettingsSave).toHaveBeenCalledWith(
      expect.objectContaining({
        app: expect.objectContaining({
          vault_root_mode: "custom_root",
          upriv_root_path: "/upriv-saf-root",
        }),
      }),
      expect.anything(),
    );
    expect(safState.activeUri).toBe("content://tree/x");
  });

  it("drops a stale storage-access grant when the alias is not the saf root", async () => {
    const { createNativeServices } = await importModule(true);
    safState.activeUri = "content://tree/x";
    const services = createNativeServices();
    await expect(
      services.vaultRoot.resolve({ vaultRootMode: "custom_root" }),
    ).resolves.toMatchObject({
      status: "found",
      rootPath: "/tmp",
      source: "default_root",
    });
    expect(safState.activeUri).toBe("");
    safState.activeUri = "content://tree/x";
    const loaded = await services.appSettings.load();
    expect(safState.activeUri).toBe("");
    expect(loaded.rootPath).toBe("/tmp/root");
    expect(loaded.settings.app.upriv_root_path.startsWith("content://")).toBe(false);
  });

  it("presents the picked folder when rust is on the logical saf root", async () => {
    const { createNativeServices } = await importModule(true);
    const rpc = await import("@/lib/rpc");
    safState.activeUri = "content://tree/kept";
    vi.mocked(rpc.rpcVaultRootResolve).mockResolvedValueOnce({
      status: "found",
      rootPath: "/upriv-saf-root",
      source: "custom_root",
    });
    vi.mocked(rpc.rpcAppSettingsGet).mockResolvedValueOnce({
      settings: {
        ...createDefaultAppSettings(),
        app: {
          ...createDefaultAppSettings().app,
          vault_root_mode: "default_root",
          upriv_root_path: "/upriv-saf-root",
        },
      },
      rootPath: "/upriv-saf-root",
      onDisk: true,
    });
    const services = createNativeServices();
    await expect(
      services.vaultRoot.resolve({ vaultRootMode: "custom_root" }),
    ).resolves.toMatchObject({
      status: "found",
      rootPath: "content://tree/kept",
    });
    expect(safState.activeUri).toBe("content://tree/kept");
    const loaded = await services.appSettings.load();
    expect(loaded.rootPath).toBe("content://tree/kept");
    expect(loaded.settings.app.vault_root_mode).toBe("custom_root");
    expect(loaded.settings.app.upriv_root_path).toBe("content://tree/kept");
    expect(safRelease).not.toHaveBeenCalled();
  });
});
