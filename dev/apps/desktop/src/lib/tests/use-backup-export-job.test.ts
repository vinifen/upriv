/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JOB_ERROR_CODES,
  RpcError,
  type BackupService,
  type JobService,
  type VaultPathWriteResult,
} from "@upriv/shared";
import { useBackupExportJob, type BackupExportJobEvents } from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const KEYS = ["20260101000000-notes.zip"];
const WRITTEN: VaultPathWriteResult = { path: "/media/usb/20260101000000-notes.zip", size: 4096 };

function serviceExporting(exportTo: BackupService["exportTo"]): BackupService {
  return {
    listBackups: async () => [],
    deleteBackups: async () => undefined,
    promoteToSave: async () => undefined,
    saveNow: async () => ({ stamp: "", createdAt: "" }),
    exportTo,
  };
}

function jobs(): JobService & { cancel: ReturnType<typeof vi.fn> } {
  return { status: async () => null, cancel: vi.fn(async () => undefined) };
}

function events(): BackupExportJobEvents & {
  onExported: ReturnType<typeof vi.fn>;
  onFailed: ReturnType<typeof vi.fn>;
  onCancelled: ReturnType<typeof vi.fn>;
  onStopRefused: ReturnType<typeof vi.fn>;
} {
  return {
    onExported: vi.fn(),
    onFailed: vi.fn(),
    onCancelled: vi.fn(),
    onStopRefused: vi.fn(),
  };
}

describe("useBackupExportJob", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the job until the file lands, then reports it", async () => {
    const run = deferred<VaultPathWriteResult>();
    const exportTo = vi.fn<BackupService["exportTo"]>(() => run.promise);
    const on = events();
    const service = serviceExporting(exportTo);
    const runner = jobs();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      expect(result.current.start("vault-a", KEYS, "/media/usb")).toBe(true);
    });
    expect(result.current.job).toMatchObject({
      vaultId: "vault-a",
      keys: KEYS,
      stoppingSince: null,
    });
    expect(exportTo).toHaveBeenCalledWith("vault-a", KEYS, "/media/usb", result.current.job?.id);

    await act(async () => {
      run.resolve(WRITTEN);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onExported).toHaveBeenCalledWith(WRITTEN);
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("shows how far core got", async () => {
    const run = deferred<VaultPathWriteResult>();
    const service = serviceExporting(() => run.promise);
    const progress = { bytesDone: 1024, bytesTotal: 4096, stoppable: true };
    const runner: JobService = {
      status: async () => progress,
      cancel: async () => undefined,
    };
    const on = events();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      result.current.start("vault-a", KEYS, "/media/usb");
    });
    await waitFor(() => expect(result.current.job?.progress).toEqual(progress));
    await act(async () => {
      run.resolve(WRITTEN);
    });
  });

  it("runs one export at a time, of any vault", () => {
    const exportTo = vi.fn<BackupService["exportTo"]>(
      () => new Promise<VaultPathWriteResult>(() => undefined),
    );
    const service = serviceExporting(exportTo);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      expect(result.current.start("vault-a", KEYS, "/media/usb")).toBe(true);
    });
    act(() => {
      expect(result.current.start("vault-b", KEYS, "/media/usb")).toBe(false);
    });
    expect(exportTo).toHaveBeenCalledOnce();
    expect(result.current.job?.vaultId).toBe("vault-a");
  });

  it("starts nothing without a backup", () => {
    const exportTo = vi.fn<BackupService["exportTo"]>();
    const service = serviceExporting(exportTo);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      expect(result.current.start("vault-a", [], "/media/usb")).toBe(false);
    });
    expect(exportTo).not.toHaveBeenCalled();
  });

  it("asks core to stop, and the stopped call reports the stop", async () => {
    const run = deferred<VaultPathWriteResult>();
    const service = serviceExporting(() => run.promise);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      result.current.start("vault-a", KEYS, "/media/usb");
    });
    const id = result.current.job?.id;
    act(() => result.current.stop());
    expect(result.current.job?.stoppingSince).not.toBeNull();
    expect(runner.cancel).toHaveBeenCalledWith(id, "user");

    await act(async () => {
      run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped"));
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledOnce();
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("reports a failure and frees the job", async () => {
    const run = deferred<VaultPathWriteResult>();
    const service = serviceExporting(() => run.promise);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      result.current.start("vault-a", KEYS, "/media/usb");
    });
    const error = new Error("io_error");
    await act(async () => {
      run.reject(error);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onFailed).toHaveBeenCalledWith(error);
  });

  it("has no time limit: it keeps the export running however long it takes", async () => {
    vi.useFakeTimers();
    const run = deferred<VaultPathWriteResult>();
    const service = serviceExporting(() => run.promise);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      result.current.start("vault-a", KEYS, "/media/usb");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1_000);
    });
    expect(result.current.job).not.toBeNull();
    expect(runner.cancel).not.toHaveBeenCalled();

    await act(async () => {
      run.resolve(WRITTEN);
    });
    expect(on.onExported).toHaveBeenCalledWith(WRITTEN);
  });

  it("starts the clock when core first says the job runs, not when it was sent", async () => {
    let running = false;
    const run = deferred<VaultPathWriteResult>();
    const service = serviceExporting(() => run.promise);
    const runner: JobService = {
      status: async () => (running ? { bytesDone: 0, bytesTotal: 10, stoppable: true } : null),
      cancel: async () => undefined,
    };
    const on = events();
    const { result } = renderHook(() => useBackupExportJob(service, runner, on));

    act(() => {
      result.current.start("vault-a", KEYS, "/media/usb");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.job?.startedAt).toBeNull();

    running = true;
    await waitFor(() => expect(result.current.job?.startedAt).not.toBeNull(), { timeout: 3_000 });
    await act(async () => {
      run.resolve(WRITTEN);
    });
  });
});
