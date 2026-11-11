/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATA_FOLDER_EXPORT_ERROR_CODES,
  JOB_ERROR_CODES,
  RpcError,
  type DataFolderService,
  type JobProgress,
  type JobService,
  type VaultPathWriteResult,
} from "@upriv/shared";
import {
  JOB_PROGRESS_POLL_MS,
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

const ZIP = "upriv-2026-10-19-101500";

function service(exportTo: DataFolderService["exportTo"]): DataFolderService {
  return { exportTo };
}

function jobs(progress: JobProgress | null = null): JobService & {
  status: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  return {
    status: vi.fn(async () => progress),
    cancel: vi.fn(async () => undefined),
  };
}

/** The job id the export ran as. */
function jobOf(exportTo: { mock: { calls: unknown[][] } }, call = 0): string {
  return exportTo.mock.calls[call][3] as string;
}

function events(): DataFolderExportJobEvents & {
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

describe("useDataFolderExportJob", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the job until the zip is written, then reports it", async () => {
    const run = deferred<VaultPathWriteResult>();
    const exportTo = vi.fn<DataFolderService["exportTo"]>(() => run.promise);
    const on = events();
    const { result } = renderHook(() => useDataFolderExportJob(service(exportTo), jobs(), on));

    act(() => {
      expect(result.current.start("/media/usb", ZIP, true)).toBe(true);
    });
    expect(exportTo).toHaveBeenCalledWith("/media/usb", ZIP, true, jobOf(exportTo));
    expect(result.current.job?.id).toBe(jobOf(exportTo));
    act(() => {
      expect(result.current.start("/elsewhere", ZIP, true)).toBe(false);
    });
    expect(exportTo).toHaveBeenCalledTimes(1);

    await act(async () => {
      run.resolve(written);
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onExported).toHaveBeenCalledWith(written);
    expect(on.onFailed).not.toHaveBeenCalled();
    expect(result.current.written).toEqual(written);
  });

  it("runs each export as its own job", async () => {
    const first = deferred<VaultPathWriteResult>();
    const second = deferred<VaultPathWriteResult>();
    const exportTo = vi
      .fn<DataFolderService["exportTo"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() =>
      useDataFolderExportJob(service(exportTo), jobs(), events()),
    );

    act(() => {
      result.current.start("/media/usb", ZIP, true);
    });
    await act(async () => {
      first.resolve(written);
    });
    await waitFor(() => expect(result.current.written).not.toBeNull());

    act(() => {
      result.current.start("/media/other", ZIP, true);
    });
    expect(result.current.written).toBeNull();
    expect(jobOf(exportTo, 1)).not.toBe(jobOf(exportTo, 0));
  });

  it("keeps the written zip until the window lets it go", async () => {
    const run = deferred<VaultPathWriteResult>();
    const { result } = renderHook(() =>
      useDataFolderExportJob(
        service(() => run.promise),
        jobs(),
        events(),
      ),
    );

    act(() => {
      result.current.start("/media/usb", ZIP, true);
    });
    await act(async () => {
      run.resolve(written);
    });
    await waitFor(() => expect(result.current.written).toEqual(written));

    act(() => {
      result.current.clearWritten();
    });
    expect(result.current.written).toBeNull();
  });

  it("shows the progress core reports for its job", async () => {
    vi.useFakeTimers();
    const progress = { bytesDone: 10, bytesTotal: 40, stoppable: true };
    const exportTo = vi.fn<DataFolderService["exportTo"]>(
      () => new Promise<VaultPathWriteResult>(() => undefined),
    );
    const runner = jobs(progress);
    const { result } = renderHook(() =>
      useDataFolderExportJob(service(exportTo), runner, events()),
    );

    act(() => {
      result.current.start("/media/usb", ZIP, true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS);
    });
    expect(result.current.job?.progress).toEqual(progress);
    expect(runner.status.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(runner.status).toHaveBeenCalledWith(jobOf(exportTo));
  });

  it("asks core to stop its job, then reports a stop rather than a failure", async () => {
    const run = deferred<VaultPathWriteResult>();
    const exportTo = vi.fn<DataFolderService["exportTo"]>(() => run.promise);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useDataFolderExportJob(service(exportTo), runner, on));

    act(() => {
      result.current.start("/media/usb", ZIP, true);
    });
    act(() => {
      result.current.stop();
    });
    act(() => {
      result.current.stop();
    });
    expect(result.current.job?.stoppingSince).not.toBeNull();
    expect(runner.cancel).toHaveBeenCalledTimes(1);
    expect(runner.cancel).toHaveBeenCalledWith(jobOf(exportTo), "user");

    await act(async () => {
      run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "cancelled"));
    });
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledTimes(1);
    expect(on.onFailed).not.toHaveBeenCalled();
    expect(result.current.written).toBeNull();
  });

  it("reports a failure and frees the job", async () => {
    const run = deferred<VaultPathWriteResult>();
    const on = events();
    const { result } = renderHook(() =>
      useDataFolderExportJob(
        service(() => run.promise),
        jobs(),
        on,
      ),
    );

    act(() => {
      result.current.start("/media/usb", ZIP, true);
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

  it("has no time limit: it waits for the zip however long it takes", async () => {
    vi.useFakeTimers();
    const run = deferred<VaultPathWriteResult>();
    const exportTo = vi.fn<DataFolderService["exportTo"]>(() => run.promise);
    const runner = jobs();
    const on = events();
    const { result } = renderHook(() => useDataFolderExportJob(service(exportTo), runner, on));

    act(() => {
      result.current.start("/media/usb", ZIP, true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1_000);
    });
    expect(result.current.job).not.toBeNull();
    expect(runner.cancel).not.toHaveBeenCalled();

    await act(async () => {
      run.resolve(written);
    });
    expect(on.onExported).toHaveBeenCalledWith(written);
  });

  it("keeps running when core refuses the stop while the zip is put in place", async () => {
    const refusal = new RpcError(JOB_ERROR_CODES.NOT_STOPPABLE, "finishing");
    const runner = jobs();
    runner.cancel.mockRejectedValueOnce(refusal);
    const on = events();
    const exportTo = vi.fn<DataFolderService["exportTo"]>(
      () => new Promise<VaultPathWriteResult>(() => undefined),
    );
    const { result } = renderHook(() => useDataFolderExportJob(service(exportTo), runner, on));

    act(() => {
      result.current.start("/media/usb", ZIP, true);
    });
    await act(async () => {
      result.current.stop();
    });
    expect(on.onStopRefused).toHaveBeenCalledWith(refusal);
    expect(result.current.job?.stoppingSince).toBeNull();
  });

  it("does nothing without a service", () => {
    const { result } = renderHook(() => useDataFolderExportJob(undefined, jobs(), events()));
    act(() => {
      expect(result.current.start("/media/usb", ZIP, true)).toBe(false);
    });
    expect(result.current.job).toBeNull();
  });
});
