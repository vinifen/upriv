/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultGroupListResult, VaultListItem } from "@upriv/shared";
import { useAppRefresh } from "../hooks/useAppRefresh";

const listVaults = vi.fn<() => Promise<VaultListItem[]>>();
const listGroups = vi.fn<() => Promise<VaultGroupListResult>>();
const settings = vi.hoisted(() => ({
  reloadSettings: vi.fn(async () => undefined),
  vaultRootEpoch: 0,
}));

vi.mock("@/platform/services", () => ({
  useVaultService: () => ({ listVaults }),
  useVaultGroupService: () => ({ list: listGroups }),
}));
vi.mock("@/features/system/settings", () => ({ useAppSettingsContext: () => settings }));

const ROWS = [{ id: "notes" }] as VaultListItem[];
const GROUPS: VaultGroupListResult = { groups: [], invalid: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const applyVaultList = vi.fn();
  const applyGroups = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useAppRefresh({ applyVaultList, applyGroups, onError }));
  return { ...hook, applyVaultList, applyGroups, onError };
}

afterEach(() => {
  vi.useRealTimers();
  listVaults.mockReset();
  listGroups.mockReset();
  settings.reloadSettings.mockClear();
  settings.vaultRootEpoch = 0;
});

describe("useAppRefresh", () => {
  it("reloads settings, vaults, and groups together, and applies both", async () => {
    listVaults.mockResolvedValue(ROWS);
    listGroups.mockResolvedValue(GROUPS);
    const { result, applyVaultList, applyGroups, onError } = setup();

    await act(() => result.current.refresh());
    expect(settings.reloadSettings).toHaveBeenCalledOnce();
    expect(applyVaultList).toHaveBeenCalledWith(ROWS, expect.any(Number));
    expect(applyGroups).toHaveBeenCalledWith(GROUPS);
    expect(onError).not.toHaveBeenCalled();
  });

  it("runs one refresh at a time and spins until it settles", async () => {
    vi.useFakeTimers();
    const vaults = deferred<VaultListItem[]>();
    listVaults.mockReturnValue(vaults.promise);
    listGroups.mockResolvedValue(GROUPS);
    const { result, applyVaultList } = setup();

    let first!: Promise<void>;
    act(() => {
      first = result.current.refresh();
      void result.current.refresh();
    });
    expect(listVaults).toHaveBeenCalledOnce();
    expect(result.current.isRefreshing).toBe(true);
    // A slow folder keeps the spinner past its minimum turn.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      vaults.resolve(ROWS);
      await first;
    });
    expect(result.current.isRefreshing).toBe(false);
    expect(applyVaultList).toHaveBeenCalledOnce();
  });

  it("reports a failure once, and applies nothing", async () => {
    const gone = new Error("vault_root_not_found");
    listVaults.mockRejectedValue(gone);
    listGroups.mockRejectedValue(new Error("vault_root_not_found again"));
    const { result, applyVaultList, applyGroups, onError } = setup();

    await act(() => result.current.refresh());
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(gone);
    expect(applyVaultList).not.toHaveBeenCalled();
    expect(applyGroups).not.toHaveBeenCalled();
  });

  it("drops a refresh that outlives a data folder change", async () => {
    const vaults = deferred<VaultListItem[]>();
    listVaults.mockReturnValue(vaults.promise);
    listGroups.mockResolvedValue(GROUPS);
    const { result, rerender, applyVaultList, applyGroups, onError } = setup();

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refresh();
    });
    settings.vaultRootEpoch = 1;
    rerender();
    await act(async () => {
      vaults.reject(new Error("vault_root_not_found"));
      await pending;
    });
    expect(applyVaultList).not.toHaveBeenCalled();
    expect(applyGroups).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
