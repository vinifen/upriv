/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOADING_BUDGET_MS, type BackupService, type VaultBackupEntry } from "@upriv/shared";
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
    const saveNow = vi.fn(() => run.promise);
    const on = events();
    const service = serviceSaving(saveNow);
    const { result } = renderHook(() => useVaultBackupJob(service, on));

    act(() => {
      expect(result.current.start("vault-a")).toBe(true);
    });
    expect(result.current.job?.vaultId).toBe("vault-a");

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
    const { result } = renderHook(() => useVaultBackupJob(service, on));

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
    const { result } = renderHook(() => useVaultBackupJob(service, on));

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

  it("gives up after the budget and ignores a late result", async () => {
    vi.useFakeTimers();
    const run = deferred<VaultBackupEntry>();
    const service = serviceSaving(() => run.promise);
    const on = events();
    const { result } = renderHook(() => useVaultBackupJob(service, on));

    act(() => {
      result.current.start("vault-a");
    });
    act(() => {
      vi.advanceTimersByTime(LOADING_BUDGET_MS.vaultBackupSave);
    });
    expect(result.current.job).toBeNull();
    expect(on.onTimedOut).toHaveBeenCalledWith("vault-a");

    await act(async () => {
      run.resolve(saved);
    });
    expect(on.onSaved).not.toHaveBeenCalled();
    expect(result.current.job).toBeNull();
  });
});
