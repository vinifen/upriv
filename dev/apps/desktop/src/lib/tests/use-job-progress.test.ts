/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobProgress, JobService } from "@upriv/shared";
import { JOB_PROGRESS_POLL_MS, useJobProgress } from "@upriv/shared/react";

/** Each job id answers with its own progress. */
function jobs(byId: Record<string, JobProgress | null>): JobService & {
  status: ReturnType<typeof vi.fn>;
} {
  return {
    status: vi.fn(async (job: string) => byId[job] ?? null),
    cancel: vi.fn(async () => undefined),
  };
}

describe("useJobProgress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks while a job is set, and stops once it is cleared", async () => {
    vi.useFakeTimers();
    const runner = jobs({ export: { bytesDone: 1, bytesTotal: 4 } });
    const { result, rerender } = renderHook(({ id }) => useJobProgress(runner, id), {
      initialProps: { id: null as string | null },
    });
    expect(result.current).toBeNull();
    expect(runner.status).not.toHaveBeenCalled();

    rerender({ id: "export" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS);
    });
    expect(result.current).toEqual({ bytesDone: 1, bytesTotal: 4 });

    rerender({ id: null });
    expect(result.current).toBeNull();
    const asked = runner.status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS * 3);
    });
    expect(runner.status.mock.calls.length).toBe(asked);
  });

  it("never shows one job's progress for the next", async () => {
    vi.useFakeTimers();
    const runner = jobs({ first: { bytesDone: 3, bytesTotal: 4 }, second: null });
    const { result, rerender } = renderHook(({ id }) => useJobProgress(runner, id), {
      initialProps: { id: "first" as string | null },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ bytesDone: 3, bytesTotal: 4 });

    // The next job has not answered yet: it starts measuring, not at 75%.
    rerender({ id: "second" });
    expect(result.current).toBeNull();
  });

  it("keeps the last answer when an ask fails", async () => {
    vi.useFakeTimers();
    const runner = jobs({ export: { bytesDone: 2, bytesTotal: 4 } });
    const { result } = renderHook(() => useJobProgress(runner, "export"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    runner.status.mockRejectedValueOnce(new Error("bridge busy"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS);
    });
    expect(result.current).toEqual({ bytesDone: 2, bytesTotal: 4 });
  });
});
