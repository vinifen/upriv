/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOADING_BUDGET_MS,
  RPC_TIMEOUT_CODE,
  RpcError,
  type BackupService,
  type JobService,
  type VaultBackupEntry,
} from "@upriv/shared";
import { useVaultBackupJob, type VaultBackupJobEvents } from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const saved: VaultBackupEntry = {
  stamp: "20260101000000",
  createdAt: "2026-01-01T00:00:00.000Z",
  saved: true,
};

function serviceSaving(saveNow: BackupService["saveNow"]): BackupService {
  return {
    listBackups: async () => [],
    deleteBackups: async () => undefined,
    promoteToSave: async () => undefined,
    saveNow,
    getBackupBytes: async () => new Uint8Array(),
    exportToPath: async (_vaultId, _entry, destPath) => ({ path: destPath, size: 0 }),
    exportSnapshotsToPath: async (_vaultId, _stamps, destPath) => ({ path: destPath, size: 0 }),
  };
}

function jobs(): JobService & { cancel: ReturnType<typeof vi.fn> } {
  return { status: async () => null, cancel: vi.fn(async () => undefined) };
}

function events(): VaultBackupJobEvents & {
  onSaved: ReturnType<typeof vi.fn>;
  onFailed: ReturnType<typeof vi.fn>;
  onTimedOut: ReturnType<typeof vi.fn>;
} {
  return { onSaved: vi.fn(), onFailed: vi.fn(), onTimedOut: vi.fn() };
}

describe("useVaultBackupJob", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the job until the backup lands, then reports it", async () => {
    const run = deferred<VaultBackupEntry>();
    const saveNow = vi.fn<BackupService["saveNow"]>(() => run.promise);
    const on = events();
    const service = serviceSaving(saveNow);
    const { result } = renderHook(() => useVaultBackupJob(service, jobs(), on));

    act(() => {
      expect(result.current.start("vault-a")).toBe(true);
    });
    expect(result.current.job?.vaultId).toBe("vault-a");
    expect(saveNow).toHaveBeenCalledWith("vault-a", result.current.job?.id);

    await act(async () => {
      run.resolve(saved);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onSaved).toHaveBeenCalledWith("vault-a", saved);
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("refuses a second backup while one runs", () => {
    const saveNow = vi.fn(() => new Promise<VaultBackupEntry>(() => undefined));
    const service = serviceSaving(saveNow);
    const on = events();
    const { result } = renderHook(() => useVaultBackupJob(service, jobs(), on));

    act(() => {
      expect(result.current.start("vault-a")).toBe(true);
    });
    act(() => {
      expect(result.current.start("vault-b")).toBe(false);
    });
    expect(saveNow).toHaveBeenCalledTimes(1);
    expect(result.current.job?.vaultId).toBe("vault-a");
  });

  it("reports a failure and frees the job", async () => {
    const run = deferred<VaultBackupEntry>();
    const service = serviceSaving(() => run.promise);
    const on = events();
    const { result } = renderHook(() => useVaultBackupJob(service, jobs(), on));

    act(() => {
      result.current.start("vault-a");
    });
    const error = new Error("vault_busy");
    await act(async () => {
      run.reject(error);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onFailed).toHaveBeenCalledWith("vault-a", error);
    expect(on.onSaved).not.toHaveBeenCalled();
  });

  it("stops its job in core when the call times out before the budget", async () => {
    const run = deferred<VaultBackupEntry>();
    const saveNow = vi.fn<BackupService["saveNow"]>(() => run.promise);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useVaultBackupJob(serviceSaving(saveNow), runner, on));

    act(() => {
      result.current.start("vault-a");
    });
    await act(async () => {
      run.reject(new RpcError(RPC_TIMEOUT_CODE, "invoke timeout"));
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(runner.cancel).toHaveBeenCalledWith(saveNow.mock.calls[0][1], "timeout");
    expect(on.onTimedOut).toHaveBeenCalledWith("vault-a");
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("gives up after the budget, stops its job in core, and ignores a late result", async () => {
    vi.useFakeTimers();
    const run = deferred<VaultBackupEntry>();
    const saveNow = vi.fn<BackupService["saveNow"]>(() => run.promise);
    const service = serviceSaving(saveNow);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useVaultBackupJob(service, runner, on));

    act(() => {
      result.current.start("vault-a");
    });
    act(() => {
      vi.advanceTimersByTime(LOADING_BUDGET_MS.vaultBackupSave);
    });
    expect(result.current.job).toBeNull();
    expect(on.onTimedOut).toHaveBeenCalledWith("vault-a");
    expect(runner.cancel).toHaveBeenCalledTimes(1);
    expect(runner.cancel).toHaveBeenCalledWith(saveNow.mock.calls[0][1], "timeout");

    await act(async () => {
      run.resolve(saved);
    });
    expect(on.onSaved).not.toHaveBeenCalled();
    expect(result.current.job).toBeNull();
  });
});
