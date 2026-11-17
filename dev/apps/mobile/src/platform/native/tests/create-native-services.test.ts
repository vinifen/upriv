import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JOB_ERROR_CODES,
  RpcError,
  createDefaultAppSettings,
  type DataFolderChoice,
  type DataFolderListView,
  type DeviceGroups,
} from "@upriv/shared";

const HERE = "a".repeat(32);
const ROW = "content://com.android.externalstorage.documents/tree/1234-5678%3AUpriv";
const DOCUMENTS = "content://com.android.externalstorage.documents/tree/primary%3ADocuments";
const PICKED = "content://com.android.externalstorage.documents/tree/primary%3ADownload";

const state = {
  /** What the bridge serves at the data folder root. */
  root: null as string | null,
  documentsGrant: DOCUMENTS as string | null,
  /** Trees that are away: mounting one at the root throws. */
  away: new Set<string>(),
  list: { groups: {}, defaultFolder: null, explicit: null } as DataFolderListView,
};

/** This phone's group selecting `selected`, with the one row `ROW`. */
function phoneGroups(selected: 1 | "default"): DeviceGroups<DataFolderChoice> {
  return {
    [HERE]: {
      system: "android",
      selected,
      next_number: 2,
      rows: [{ number: 1, name: "SD card", path: ROW }],
    },
  };
}

const rpc = vi.hoisted(() => ({
  rpcAppSettingsGet: vi.fn(),
  rpcAppSettingsSave: vi.fn(),
  rpcDataFolderApply: vi.fn(),
  rpcDataFolderList: vi.fn(),
  rpcDataFolderSearch: vi.fn(),
  rpcDataFolderStatus: vi.fn(),
  rpcDeviceInfo: vi.fn(),
  rpcDeviceTrees: vi.fn(),
  rpcVaultRootResolve: vi.fn(),
  rpcVaultExportToFolder: vi.fn(),
  rpcVaultUnfinishedSweep: vi.fn(),
  rpcDataFolderExport: vi.fn(),
  rpcJobStatus: vi.fn(async () => null),
}));

const bridge = vi.hoisted(() => ({
  mountSafRoot: vi.fn(),
  unmountSafRoot: vi.fn(),
  mountTree: vi.fn((uri: string) => `/upriv-saf-tree/${uri.length}`),
  unmountTree: vi.fn(),
  checkTree: vi.fn(),
  safPersist: vi.fn(),
  safReleaseImportTree: vi.fn(),
  pickVaultRootFolder: vi.fn<(initial?: string | null) => Promise<string | null>>(),
}));

vi.mock("@/lib/rpc", () => rpc);

vi.mock("@/platform/native/pickVaultRootFolder", () => ({
  isAndroidSafUri: (path: string) => path.startsWith("content://"),
  pickVaultRootFolder: bridge.pickVaultRootFolder,
}));

vi.mock("@/platform/native/safVaultRoot", () => ({
  isSafTreeUri: (path: string) => path.startsWith("content://"),
  safPersist: bridge.safPersist,
  safReleaseImportTree: bridge.safReleaseImportTree,
  safDocumentsGrant: () => state.documentsGrant,
  safDocumentsInitialUri: () => DOCUMENTS,
  mountSafRoot: (uri: string) => {
    bridge.mountSafRoot(uri);
    if (state.away.has(uri)) throw new RpcError("vault_root_unreachable", "away");
    state.root = uri;
  },
  unmountSafRoot: () => {
    bridge.unmountSafRoot();
    state.root = null;
  },
  mountTree: bridge.mountTree,
  unmountTree: bridge.unmountTree,
  checkTree: bridge.checkTree,
}));

async function services() {
  vi.resetModules();
  const { createNativeServices } = await import("../createNativeServices");
  return createNativeServices();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.root = null;
  state.documentsGrant = DOCUMENTS;
  state.away = new Set();
  state.list = { groups: phoneGroups(1), defaultFolder: null, explicit: null };
  rpc.rpcDeviceInfo.mockResolvedValue({ id: HERE, system: "android" });
  rpc.rpcDeviceTrees.mockResolvedValue([ROW]);
  rpc.rpcDataFolderList.mockImplementation(async (newList: boolean) =>
    newList ? { ...state.list, groups: {} } : state.list,
  );
  rpc.rpcVaultRootResolve.mockResolvedValue({
    status: "found",
    rootPath: "/upriv-saf-root",
    source: "row",
  });
  rpc.rpcDataFolderApply.mockResolvedValue({
    rootPath: "/upriv-saf-root",
    source: "row",
    switched: true,
    ended: [],
  });
  rpc.rpcAppSettingsGet.mockResolvedValue({
    settings: createDefaultAppSettings(),
    rootPath: "/upriv-saf-root",
    onDisk: true,
  });
  rpc.rpcAppSettingsSave.mockResolvedValue({ wrote: true, unchangedVaults: [], keptFolders: [] });
  rpc.rpcDataFolderStatus.mockResolvedValue({ state: "ok", content: "valid", details: null });
  rpc.rpcDataFolderSearch.mockResolvedValue({ found: false, switch: null, ended: [] });
});

describe("the phone's data folder", () => {
  it("mounts the row the list selects at the data folder root, and shows its tree", async () => {
    const { vaultRoot } = await services();
    await expect(vaultRoot.resolve()).resolves.toEqual({
      status: "found",
      rootPath: ROW,
      source: "row",
    });
    expect(state.root).toBe(ROW);
    // Every row of this phone is reached at its tree's root.
    expect(bridge.mountTree).toHaveBeenCalledWith(ROW);
  });

  it("mounts Default's Documents grant, and nothing without one", async () => {
    state.list = { ...state.list, groups: phoneGroups("default") };
    const { vaultRoot } = await services();
    await vaultRoot.resolve();
    expect(state.root).toBe(DOCUMENTS);

    state.documentsGrant = null;
    await vaultRoot.resolve();
    expect(state.root).toBeNull();
  });

  it("leaves the root empty for a row that is away, so core reports it", async () => {
    state.away.add(ROW);
    rpc.rpcVaultRootResolve.mockResolvedValue({
      status: "selected_failed",
      choice: { kind: "row", number: 1, name: "SD card" },
      reason: "missing",
    });
    const { vaultRoot } = await services();
    await expect(vaultRoot.resolve()).resolves.toMatchObject({ status: "selected_failed" });
    expect(state.root).toBeNull();
  });

  it("reads the settings of the data folder the list selects", async () => {
    const { appSettings } = await services();
    await appSettings.load();
    expect(state.root).toBe(ROW);
  });

  it("applies a row by mounting its tree first, as a job that moves a private data folder", async () => {
    state.list = { ...state.list, groups: phoneGroups("default") };
    const { vaultRoot } = await services();
    await vaultRoot.resolve();
    const changes = { groups: { [HERE]: { selected: 1 as const } } };

    await expect(vaultRoot.apply({ changes, bootstrap: { locale: "en" } })).resolves.toMatchObject({
      rootPath: ROW,
      switched: true,
    });
    expect(bridge.safPersist).toHaveBeenCalledWith(ROW);
    expect(state.root).toBe(ROW);
    expect(rpc.rpcDataFolderApply).toHaveBeenCalledWith(
      expect.objectContaining({ changes, job: expect.any(String) }),
    );
  });

  it("puts the previous folder back when the apply fails", async () => {
    state.list = { ...state.list, groups: phoneGroups("default") };
    rpc.rpcDataFolderApply.mockRejectedValueOnce(new RpcError("vault_root_incomplete", "broken"));
    const { vaultRoot } = await services();
    await vaultRoot.resolve();

    await expect(
      vaultRoot.apply({
        changes: { groups: { [HERE]: { selected: 1 } } },
        bootstrap: { locale: "en" },
      }),
    ).rejects.toMatchObject({ code: "vault_root_incomplete" });
    expect(state.root).toBe(DOCUMENTS);
  });

  it("asks for Documents once when Default has no grant yet", async () => {
    state.documentsGrant = null;
    bridge.pickVaultRootFolder.mockResolvedValueOnce(DOCUMENTS);
    const { vaultRoot } = await services();

    await vaultRoot.apply({
      changes: { groups: { [HERE]: { selected: "default" } } },
      bootstrap: { locale: "en" },
    });
    expect(bridge.pickVaultRootFolder).toHaveBeenCalledWith(DOCUMENTS);
    expect(bridge.safPersist).toHaveBeenCalledWith(DOCUMENTS);
    expect(state.root).toBe(DOCUMENTS);
  });

  it("stops quietly when Documents is not confirmed, and refuses another folder", async () => {
    state.documentsGrant = null;
    const { vaultRoot } = await services();
    const request = {
      changes: { groups: { [HERE]: { selected: "default" as const } } },
      bootstrap: { locale: "en" },
    };

    bridge.pickVaultRootFolder.mockResolvedValueOnce(null);
    await expect(vaultRoot.apply(request)).rejects.toMatchObject({
      code: JOB_ERROR_CODES.CANCELLED,
    });

    bridge.pickVaultRootFolder.mockResolvedValueOnce(PICKED);
    await expect(vaultRoot.apply(request)).rejects.toMatchObject({
      code: "documents_grant_rejected",
    });
    expect(rpc.rpcDataFolderApply).not.toHaveBeenCalled();
  });

  it("searches with every row at its tree and Default at the root", async () => {
    const { vaultRoot } = await services();
    await vaultRoot.search("job-1");
    expect(bridge.mountTree).toHaveBeenCalledWith(ROW);
    expect(state.root).toBe(DOCUMENTS);
    expect(rpc.rpcDataFolderSearch).toHaveBeenCalledWith("job-1");
  });

  it("serves the selected row again once a search finds it answers", async () => {
    const { vaultRoot } = await services();
    await vaultRoot.resolve();
    expect(state.root).toBe(ROW);

    // The row stopped answering while Upriv ran; the search checks Default at the root.
    rpc.rpcDataFolderSearch.mockResolvedValue({ found: true, switch: null, ended: [] });
    await vaultRoot.search("job-1");
    expect(state.root).toBe(DOCUMENTS);

    // The row answers again and stays selected: the resolve after the search serves it.
    await vaultRoot.resolve();
    expect(state.root).toBe(ROW);
  });

  it("leaves the root empty for a search with no Documents grant", async () => {
    const { vaultRoot } = await services();
    await vaultRoot.resolve();
    state.documentsGrant = null;
    await vaultRoot.search("job-1");
    expect(state.root).toBeNull();
    await vaultRoot.resolve();
    expect(state.root).toBe(ROW);
  });

  it("does not check Default while a row is the data folder", async () => {
    const { vaultRoot } = await services();
    await vaultRoot.resolve();
    await expect(vaultRoot.status(null)).resolves.toEqual({
      state: "ok",
      content: null,
      details: null,
    });
    expect(rpc.rpcDataFolderStatus).not.toHaveBeenCalled();
  });

  it("checks a row at its tree's root", async () => {
    const { vaultRoot } = await services();
    await vaultRoot.status(ROW);
    expect(bridge.mountTree).toHaveBeenCalledWith(ROW);
    expect(rpc.rpcDataFolderStatus).toHaveBeenCalledWith(ROW);
  });
});

describe("the phone's exports", () => {
  it("writes the data folder zip and a vault export into the picked tree's root", async () => {
    rpc.rpcDataFolderExport.mockImplementation(async (dir: string) => ({
      path: `${dir}/copy.zip`,
      size: 1,
    }));
    const { dataFolder } = await services();
    const written = await dataFolder?.exportTo(PICKED, "copy", true, "job-1");
    expect(bridge.checkTree).toHaveBeenCalledWith(PICKED);
    expect(written?.path).toBe(`${bridge.mountTree.mock.results[0]?.value}/copy.zip`);
  });

  it("reaches each folder a crash left an unfinished file in, for a second sweep", async () => {
    rpc.rpcVaultUnfinishedSweep
      .mockResolvedValueOnce({ folders: [PICKED] })
      .mockResolvedValueOnce({ folders: [] });
    const { vault } = await services();
    await vault.sweepUnfinished();
    expect(bridge.mountTree).toHaveBeenCalledWith(PICKED);
    expect(rpc.rpcVaultUnfinishedSweep).toHaveBeenCalledTimes(2);
  });
});
