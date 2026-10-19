/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATA_FOLDER_EXPORT_ERROR_CODES,
  LOADING_BUDGET_MS,
  RpcError,
  type DataFolderExportProgress,
  type DataFolderService,
  type VaultPathWriteResult,
} from "@upriv/shared";
import {
  DATA_FOLDER_EXPORT_POLL_MS,
  useDataFolderExportJob,
  type DataFolderExportJobEvents,
} from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const written: VaultPathWriteResult = {
  path: "/media/usb/upriv-2026-10-19-101500.zip",
  size: 4096,
};

function service(
  exportTo: DataFolderService["exportTo"],
  progress: DataFolderExportProgress | null = null,
): DataFolderService & {
  exportProgress: ReturnType<typeof vi.fn>;
  cancelExport: ReturnType<typeof vi.fn>;
} {
  return {
    exportTo,
    exportProgress: vi.fn(async () => progress),
    cancelExport: vi.fn(async () => true),
  };
}

function events(): DataFolderExportJobEvents & {
  onExported: ReturnType<typeof vi.fn>;
  onFailed: ReturnType<typeof vi.fn>;
  onCancelled: ReturnType<typeof vi.fn>;
  onTimedOut: ReturnType<typeof vi.fn>;
} {
  return {
    onExported: vi.fn(),
    onFailed: vi.fn(),
    onCancelled: vi.fn(),
    onTimedOut: vi.fn(),
  };
}

describe("useDataFolderExportJob", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the job until the zip is written, then reports it", async () => {
    const run = deferred<VaultPathWriteResult>();
    const exportTo = vi.fn(() => run.promise);
    const on = events();
    const { result } = renderHook(() => useDataFolderExportJob(service(exportTo), on));

    act(() => {
      expect(result.current.start("/media/usb")).toBe(true);
    });
    expect(exportTo).toHaveBeenCalledWith("/media/usb");
    expect(result.current.job).not.toBeNull();
    act(() => {
      expect(result.current.start("/elsewhere")).toBe(false);
    });
    expect(exportTo).toHaveBeenCalledTimes(1);

    await act(async () => {
      run.resolve(written);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onExported).toHaveBeenCalledWith(written);
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("shows the progress core reports while it runs", async () => {
    vi.useFakeTimers();
    const progress = { bytesDone: 10, bytesTotal: 40 };
    const backend = service(() => new Promise<VaultPathWriteResult>(() => undefined), progress);
    const { result } = renderHook(() => useDataFolderExportJob(backend, events()));

    act(() => {
      result.current.start("/media/usb");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DATA_FOLDER_EXPORT_POLL_MS);
    });
    expect(result.current.job?.progress).toEqual(progress);
    expect(backend.exportProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("asks core to stop, then reports a stop rather than a failure", async () => {
    const run = deferred<VaultPathWriteResult>();
    const backend = service(() => run.promise);
    const on = events();
    const { result } = renderHook(() => useDataFolderExportJob(backend, on));

    act(() => {
      result.current.start("/media/usb");
    });
    act(() => {
      result.current.stop();
    });
    expect(result.current.job?.stopping).toBe(true);
    expect(backend.cancelExport).toHaveBeenCalledTimes(1);

    await act(async () => {
      run.reject(new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.CANCELLED, "cancelled"));
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledTimes(1);
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("reports a failure and frees the job", async () => {
    const run = deferred<VaultPathWriteResult>();
    const on = events();
    const backend = service(() => run.promise);
    const { result } = renderHook(() => useDataFolderExportJob(backend, on));

    act(() => {
      result.current.start("/media/usb");
    });
    const error = new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.SPACE_SHORT, "space");
    await act(async () => {
      run.reject(error);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onFailed).toHaveBeenCalledWith(error);
    expect(on.onCancelled).not.toHaveBeenCalled();
  });

  it("gives up after the budget, stops core, and ignores a late result", async () => {
    vi.useFakeTimers();
    const run = deferred<VaultPathWriteResult>();
    const backend = service(() => run.promise);
    const on = events();
    const { result } = renderHook(() => useDataFolderExportJob(backend, on));

    act(() => {
      result.current.start("/media/usb");
    });
    act(() => {
      vi.advanceTimersByTime(LOADING_BUDGET_MS.dataFolderExport);
    });
    expect(result.current.job).toBeNull();
    expect(on.onTimedOut).toHaveBeenCalledTimes(1);
    expect(backend.cancelExport).toHaveBeenCalledTimes(1);

    await act(async () => {
      run.resolve(written);
    });
    expect(on.onExported).not.toHaveBeenCalled();
    expect(result.current.job).toBeNull();
  });

  it("does nothing without a service", () => {
    const { result } = renderHook(() => useDataFolderExportJob(undefined, events()));
    act(() => {
      expect(result.current.start("/media/usb")).toBe(false);
    });
    expect(result.current.job).toBeNull();
  });
});
