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

const DATA_FOLDERS: DataFolderListView = { groups: {}, defaultFolder: "/home", explicit: null };

/** A data folder service that answers `resolve` and the list; Info calls nothing else. */
function rootService(resolve: VaultRootService["resolve"]): VaultRootService {
  const unused = async (): Promise<never> => {
    throw new Error("Info does not call this");
  };
  return {
    resolve,
    list: async () => DATA_FOLDERS,
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
    info: async () => ({ id: "a".repeat(32), system: "linux" }),
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
          getVersion,
        }),
      { initialProps: { vaults: [vaultItem("a")] } },
    );

    await waitFor(() => {
      expect(result.current.snapshot?.inventory.vaultsTotal).toBe(1);
    });
    expect(resolveCount).toBe(1);
    expect(result.current.snapshot?.paths.appHome).toBe("/home");
    expect(result.current.snapshot?.paths.logsDir).toBe("/data/.upriv/logs");

    rerender({ vaults: [{ ...vaultItem("a"), note: "touched" }] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveCount).toBe(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.snapshot?.inventory.vaultsTotal).toBe(1);
  });

  it("keeps the previous snapshot while a later load is in flight", async () => {
    const second = deferred<VaultRootResolveResult>();
    let resolveCount = 0;
    const vaultRootService = rootService(() => {
      resolveCount += 1;
      if (resolveCount === 1) {
        return Promise.resolve(foundRoot());
      }
      return second.promise;
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
          getVersion,
        }),
      { initialProps: { vaults: [vaultItem("a")] } },
    );

    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull();
    });

    rerender({ vaults: [vaultItem("a", "open")] });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
    expect(result.current.snapshot?.inventory.vaultsOpen).toBe(0);

    await act(async () => {
      second.resolve(foundRoot());
    });
    await waitFor(() => {
      expect(result.current.snapshot?.inventory.vaultsOpen).toBe(1);
      expect(result.current.loading).toBe(false);
    });
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

    const { result, rerender } = renderHook(
      ({ vaults }: { vaults: VaultListItem[] }) =>
        useSystemInfoData({
          open: true,
          vaults,
          groups: [],
          settings,
          vaultRootService,
          deviceService,
          getVersion,
        }),
      { initialProps: { vaults: [vaultItem("a")] } },
    );

    await waitFor(() => {
      expect(result.current.snapshot?.root.status).toBe("found");
    });

    rerender({ vaults: [vaultItem("a", "open")] });
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
    expect(result.current.loading).toBe(false);
  });
});
