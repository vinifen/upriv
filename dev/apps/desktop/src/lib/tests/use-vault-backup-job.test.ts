/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JOB_ERROR_CODES,
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
    exportTo: async (_vaultId, _keys, destDir) => ({ path: destDir, size: 0 }),
  };
}

function jobs(): JobService & { cancel: ReturnType<typeof vi.fn> } {
  return { status: async () => null, cancel: vi.fn(async () => undefined) };
}

function events(): VaultBackupJobEvents & {
  onSaved: ReturnType<typeof vi.fn>;
  onFailed: ReturnType<typeof vi.fn>;
  onCancelled: ReturnType<typeof vi.fn>;
  onStopRefused: ReturnType<typeof vi.fn>;
} {
  return { onSaved: vi.fn(), onFailed: vi.fn(), onCancelled: vi.fn(), onStopRefused: vi.fn() };
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

  it("has no time limit: a backup an hour long still lands", async () => {
    vi.useFakeTimers();
    const run = deferred<VaultBackupEntry>();
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() =>
      useVaultBackupJob(
        serviceSaving(() => run.promise),
        runner,
        on,
      ),
    );

    act(() => {
      result.current.start("vault-a");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
    });
    expect(result.current.job?.vaultId).toBe("vault-a");
    expect(runner.cancel).not.toHaveBeenCalled();

    await act(async () => {
      run.resolve(saved);
    });
    expect(on.onSaved).toHaveBeenCalledWith("vault-a", saved);
  });

  it("stops in core when asked, and reports the stop, not a failure", async () => {
    const run = deferred<VaultBackupEntry>();
    const saveNow = vi.fn<BackupService["saveNow"]>(() => run.promise);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useVaultBackupJob(serviceSaving(saveNow), runner, on));

    act(() => {
      result.current.start("vault-a");
    });
    act(() => result.current.stop());
    expect(runner.cancel).toHaveBeenCalledWith(saveNow.mock.calls[0][1], "user");
    expect(result.current.job?.stoppingSince).not.toBeNull();

    await act(async () => {
      run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped"));
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledWith("vault-a");
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("keeps running when core refuses the stop in its last step", async () => {
    const refusal = new RpcError(JOB_ERROR_CODES.NOT_STOPPABLE, "finishing");
    const runner: JobService = {
      status: async () => null,
      cancel: vi.fn(async () => Promise.reject(refusal)),
    };
    const on = events();
    const service = serviceSaving(() => new Promise<VaultBackupEntry>(() => undefined));
    const { result } = renderHook(() => useVaultBackupJob(service, runner, on));

    act(() => {
      result.current.start("vault-a");
    });
    await act(async () => {
      result.current.stop();
    });
    expect(on.onStopRefused).toHaveBeenCalledWith("vault-a", refusal);
    expect(result.current.job?.stoppingSince).toBeNull();
  });
});
