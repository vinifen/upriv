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

const DATA_FOLDER = "default_root\0";
const ZIP = "upriv-2026-10-19-101500";

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
    const { result } = renderHook(() => useDataFolderExportJob(service(exportTo), on, DATA_FOLDER));

    act(() => {
      expect(result.current.start("/media/usb", ZIP)).toBe(true);
    });
    expect(exportTo).toHaveBeenCalledWith("/media/usb", ZIP);
    expect(result.current.job).not.toBeNull();
    act(() => {
      expect(result.current.start("/elsewhere", ZIP)).toBe(false);
    });
    expect(exportTo).toHaveBeenCalledTimes(1);

    await act(async () => {
      run.resolve(written);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onExported).toHaveBeenCalledWith(written);
    expect(on.onFailed).not.toHaveBeenCalled();
    expect(result.current.written).toEqual({ result: written, destDir: "/media/usb" });
  });

  it("drops the written zip when the next export starts", async () => {
    const first = deferred<VaultPathWriteResult>();
    const second = deferred<VaultPathWriteResult>();
    const exportTo = vi
      .fn<DataFolderService["exportTo"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const backend = service(exportTo);
    const { result } = renderHook(() => useDataFolderExportJob(backend, events(), DATA_FOLDER));

    act(() => {
      result.current.start("/media/usb", ZIP);
    });
    await act(async () => {
      first.resolve(written);
    });
    await waitFor(() => expect(result.current.written).not.toBeNull());

    act(() => {
      result.current.start("/media/other", ZIP);
    });
    expect(result.current.written).toBeNull();
  });

  it("shows the written zip only while the same data folder is in use", async () => {
    const run = deferred<VaultPathWriteResult>();
    const backend = service(() => run.promise);
    const { result, rerender } = renderHook(
      ({ folder }) => useDataFolderExportJob(backend, events(), folder),
      { initialProps: { folder: DATA_FOLDER } },
    );

    act(() => {
      result.current.start("/media/usb", ZIP);
    });
    await act(async () => {
      run.resolve(written);
    });
    await waitFor(() => expect(result.current.written).not.toBeNull());

    rerender({ folder: "custom_root\0/media/other" });
    expect(result.current.written).toBeNull();
    rerender({ folder: DATA_FOLDER });
    expect(result.current.written?.result).toEqual(written);
  });

  it("shows the progress core reports while it runs", async () => {
    vi.useFakeTimers();
    const progress = { bytesDone: 10, bytesTotal: 40 };
    const backend = service(() => new Promise<VaultPathWriteResult>(() => undefined), progress);
    const { result } = renderHook(() => useDataFolderExportJob(backend, events(), DATA_FOLDER));

    act(() => {
      result.current.start("/media/usb", ZIP);
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
    const { result } = renderHook(() => useDataFolderExportJob(backend, on, DATA_FOLDER));

    act(() => {
      result.current.start("/media/usb", ZIP);
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
    expect(result.current.written).toBeNull();
  });

  it("reports a failure and frees the job", async () => {
    const run = deferred<VaultPathWriteResult>();
    const on = events();
    const backend = service(() => run.promise);
    const { result } = renderHook(() => useDataFolderExportJob(backend, on, DATA_FOLDER));

    act(() => {
      result.current.start("/media/usb", ZIP);
    });
    const error = new RpcError(DATA_FOLDER_EXPORT_ERROR_CODES.SPACE_SHORT, "space");
    await act(async () => {
      run.reject(error);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onFailed).toHaveBeenCalledWith(error);
    expect(on.onCancelled).not.toHaveBeenCalled();
    expect(result.current.written).toBeNull();
  });

  it("gives up after the budget, stops core, and ignores a late result", async () => {
    vi.useFakeTimers();
    const run = deferred<VaultPathWriteResult>();
    const backend = service(() => run.promise);
    const on = events();
    const { result } = renderHook(() => useDataFolderExportJob(backend, on, DATA_FOLDER));

    act(() => {
      result.current.start("/media/usb", ZIP);
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
    expect(result.current.written).toBeNull();
  });

  it("does nothing without a service", () => {
    const { result } = renderHook(() => useDataFolderExportJob(undefined, events(), DATA_FOLDER));
    act(() => {
      expect(result.current.start("/media/usb", ZIP)).toBe(false);
    });
    expect(result.current.job).toBeNull();
  });
});
