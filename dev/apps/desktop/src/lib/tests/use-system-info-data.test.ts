/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createDefaultAppSettings,
  RpcError,
  type DataFolderListView,
  type DeviceService,
  type VaultListItem,
  type VaultRootResolveResult,
  type VaultRootService,
} from "@upriv/shared";
import { useSystemInfoData } from "@upriv/shared/react";

function vaultItem(id: string, session: VaultListItem["session"] = null): VaultListItem {
  return {
    id,
    displayName: id,
    session,
    storageMode: "encrypted_dir",
    lastAccessedWhen: "—",
    lastAccessedAt: "2026-01-01T00:00:00.000Z",
    note: "",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function foundRoot(rootPath = "/data"): VaultRootResolveResult {
  return { status: "found", rootPath, source: "default" };
}

const DATA_FOLDERS: DataFolderListView = {
  groups: {},
  osNames: {},
  defaultFolder: "/home",
  explicit: null,
};

/** A data folder service that answers `resolve`, the list, and its size; Info calls nothing else. */
function rootService(
  resolve: VaultRootService["resolve"],
  size: VaultRootService["size"] = async () => 1024,
): VaultRootService {
  const unused = async (): Promise<never> => {
    throw new Error("Info does not call this");
  };
  return {
    resolve,
    list: async () => DATA_FOLDERS,
    size,
    status: unused,
    apply: unused,
    search: unused,
    suggestedCustomRootPath: unused,
    pickFolder: unused,
  };
}

describe("useSystemInfoData", () => {
  const settings = createDefaultAppSettings();
  const getVersion = () => ({
    version: "0.1.0-beta",
    distribution: "dev" as const,
    versionOffline: true,
  });
  const deviceService: DeviceService = {
    info: async () => ({ id: "a".repeat(32), system: "linux", os: "Ubuntu 24.04.5 LTS" }),
  };

  it("does not refetch when vaults is a new array with the same inventory counts", async () => {
    let resolveCount = 0;
    const vaultRootService = rootService(async () => {
      resolveCount += 1;
      return foundRoot();
    });

    const { result, rerender } = renderHook(
      ({ vaults }: { vaults: VaultListItem[] }) =>
        useSystemInfoData({
          open: true,
          vaults,
          groups: [],
          settings,
          vaultRootService,
          deviceService,
          osNames: {},
          getVersion,
        }),
      { initialProps: { vaults: [vaultItem("a")] } },
    );

    await waitFor(() => {
      expect(result.current.snapshot?.dataFolders?.defaultFolder).toBe("/home");
    });
    expect(resolveCount).toBe(1);
    expect(result.current.snapshot?.root).toEqual(foundRoot());

    rerender({ vaults: [{ ...vaultItem("a"), note: "touched" }] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveCount).toBe(1);
    expect(result.current.snapshot?.inventory.vaultsTotal).toBe(1);
  });

  it("shows the version and the device before the data folder answers", async () => {
    const root = deferred<VaultRootResolveResult>();
    const vaultRootService = rootService(() => root.promise);

    const { result } = renderHook(() =>
      useSystemInfoData({
        open: true,
        vaults: [vaultItem("a")],
        groups: [],
        settings,
        vaultRootService,
        deviceService,
        osNames: {},
        getVersion,
      }),
    );

    // The list and the settings show at once; each read fills its part.
    expect(result.current.snapshot?.inventory.vaultsTotal).toBe(1);
    await waitFor(() => {
      expect(result.current.snapshot?.app?.version).toBe("0.1.0-beta");
      expect(result.current.snapshot?.device?.system).toBe("linux");
    });
    expect(result.current.snapshot?.root).toBeNull();

    await act(async () => {
      root.resolve(foundRoot());
    });
    await waitFor(() => {
      expect(result.current.snapshot?.root).toEqual(foundRoot());
    });
  });

  /** Info open or closed on `service`, as the window drives it. */
  function infoOn(service: VaultRootService) {
    return renderHook(
      ({ open }: { open: boolean }) =>
        useSystemInfoData({
          open,
          vaults: [vaultItem("a")],
          groups: [],
          settings,
          vaultRootService: service,
          deviceService,
          osNames: {},
          getVersion,
        }),
      { initialProps: { open: true } },
    );
  }

  it("measures the data folder on its own: a slow walk holds back its row alone", async () => {
    const walk = deferred<number>();
    const { result } = infoOn(
      rootService(
        async () => foundRoot(),
        () => walk.promise,
      ),
    );

    await waitFor(() => {
      expect(result.current.snapshot?.root).toEqual(foundRoot());
      expect(result.current.snapshot?.dataFolders).toEqual(DATA_FOLDERS);
    });
    expect(result.current.snapshot?.dataFolderBytes).toBe("measuring");

    await act(async () => {
      walk.resolve(5 * 1024 * 1024 * 1024);
    });
    await waitFor(() => {
      expect(result.current.snapshot?.dataFolderBytes).toBe(5 * 1024 * 1024 * 1024);
    });
  });

  it("joins the walk still running when the window opens again", async () => {
    const walk = deferred<number>();
    let walks = 0;
    const { result, rerender } = infoOn(
      rootService(
        async () => foundRoot(),
        () => {
          walks += 1;
          return walk.promise;
        },
      ),
    );
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => {
      expect(result.current.snapshot?.root).toEqual(foundRoot());
    });
    expect(walks).toBe(1);

    await act(async () => {
      walk.resolve(2048);
    });
    await waitFor(() => {
      expect(result.current.snapshot?.dataFolderBytes).toBe(2048);
    });
  });

  it("shows a measure that failed as a dash, and fails nothing else", async () => {
    const { result } = infoOn(
      rootService(
        async () => foundRoot(),
        async () => {
          throw new RpcError("io_error", "unreadable");
        },
      ),
    );
    await waitFor(() => {
      expect(result.current.snapshot?.dataFolderBytes).toBeNull();
    });
    expect(result.current.loadError).toBe(false);
    expect(result.current.snapshot?.root).toEqual(foundRoot());
  });

  it("follows the list at once, with no new read", async () => {
    let resolveCount = 0;
    const vaultRootService = rootService(async () => {
      resolveCount += 1;
      return foundRoot();
    });

    const { result, rerender } = renderHook(
      ({ vaults }: { vaults: VaultListItem[] }) =>
        useSystemInfoData({
          open: true,
          vaults,
          groups: [],
          settings,
          vaultRootService,
          deviceService,
          osNames: {},
          getVersion,
        }),
      { initialProps: { vaults: [vaultItem("a")] } },
    );

    await waitFor(() => {
      expect(result.current.snapshot?.root).not.toBeNull();
    });
    expect(result.current.snapshot?.inventory.vaultsOpen).toBe(0);

    rerender({ vaults: [vaultItem("a", "open")] });
    expect(result.current.snapshot?.inventory.vaultsOpen).toBe(1);
    expect(resolveCount).toBe(1);
  });

  it("excludes hidden vaults from vaultsOpen and lastOpenedVault when show-hidden is off", async () => {
    const vaultRootService = rootService(async () => foundRoot());

    const hiddenOpen: VaultListItem = { ...vaultItem("secret", "open"), hidden: true };
    const visibleOpen = vaultItem("notes", "open");
    const settingsWithLast = {
      ...settings,
      app: { ...settings.app, last_opened_vault: "secret" },
    };

    const { result, rerender } = renderHook(
      ({ showHiddenVaults }: { showHiddenVaults: boolean }) =>
        useSystemInfoData({
          open: true,
          vaults: [hiddenOpen, visibleOpen],
          groups: [],
          settings: settingsWithLast,
          vaultRootService,
          deviceService,
          osNames: {},
          getVersion,
          showHiddenVaults,
        }),
      { initialProps: { showHiddenVaults: false } },
    );

    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull();
    });
    expect(result.current.snapshot?.inventory.vaultsTotal).toBe(1);
    expect(result.current.snapshot?.inventory.vaultsOpen).toBe(1);
    expect(result.current.snapshot?.lastOpenedVault).toBe("");

    rerender({ showHiddenVaults: true });
    await waitFor(() => {
      expect(result.current.snapshot?.lastOpenedVault).toBe("secret");
    });
    expect(result.current.snapshot?.inventory.vaultsOpen).toBe(1);
  });

  it("clears the snapshot on vault-root A/B so Info does not keep stale found paths", async () => {
    let resolveCount = 0;
    const vaultRootService = rootService(() => {
      resolveCount += 1;
      if (resolveCount === 1) {
        return Promise.resolve(foundRoot());
      }
      return Promise.reject(new RpcError("vault_root_not_found", "gone"));
    });

    const { result } = renderHook(() =>
      useSystemInfoData({
        open: true,
        vaults: [vaultItem("a")],
        groups: [],
        settings,
        vaultRootService,
        deviceService,
        osNames: {},
        getVersion,
      }),
    );

    await waitFor(() => {
      expect(result.current.snapshot?.root?.status).toBe("found");
    });

    act(() => result.current.retryLoad());
    await waitFor(() => {
      expect(result.current.loadError).toBe(true);
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loadFailure).toMatchObject({ code: "vault_root_not_found" });
  });

  it("clears the snapshot on SAF epoch codes the same way as vault-root A/B", async () => {
    const vaultRootService = rootService(async () =>
      Promise.reject(new RpcError("saf_unauthorized", "grant gone")),
    );

    const { result } = renderHook(() =>
      useSystemInfoData({
        open: true,
        vaults: [vaultItem("a")],
        groups: [],
        settings,
        vaultRootService,
        deviceService,
        osNames: {},
        getVersion,
      }),
    );

    await waitFor(() => {
      expect(result.current.loadError).toBe(true);
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loadFailure).toMatchObject({ code: "saf_unauthorized" });
  });

  it("treats a selected data folder that does not answer as gone (not a stale Info snapshot)", async () => {
    const vaultRootService = rootService(async () => ({
      status: "selected_failed",
      choice: { kind: "row", number: 1, name: "USB" },
      reason: "missing",
      ended: [],
    }));

    const { result } = renderHook(() =>
      useSystemInfoData({
        open: true,
        vaults: [vaultItem("a")],
        groups: [],
        settings,
        vaultRootService,
        deviceService,
        osNames: {},
        getVersion,
      }),
    );

    await waitFor(() => {
      expect(result.current.loadError).toBe(true);
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loadFailure).toMatchObject({ code: "vault_root_not_found" });
  });

  it("does not refetch when settings is a new object with the same Info fields", async () => {
    let resolveCount = 0;
    const vaultRootService = rootService(async () => {
      resolveCount += 1;
      return foundRoot();
    });

    const { result, rerender } = renderHook(
      ({ nextSettings }: { nextSettings: typeof settings }) =>
        useSystemInfoData({
          open: true,
          vaults: [vaultItem("a")],
          groups: [],
          settings: nextSettings,
          vaultRootService,
          deviceService,
          osNames: {},
          getVersion,
        }),
      { initialProps: { nextSettings: settings } },
    );

    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull();
    });
    expect(resolveCount).toBe(1);

    rerender({
      nextSettings: {
        ...settings,
        ui: { ...settings.ui },
        logging: { ...settings.logging },
        app: { ...settings.app, last_opened_vault: settings.app.last_opened_vault },
      },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveCount).toBe(1);
  });
});
