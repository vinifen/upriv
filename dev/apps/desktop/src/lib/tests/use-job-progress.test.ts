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

function running(bytesDone: number, bytesTotal: number): JobProgress {
  return { bytesDone, bytesTotal, stoppable: true };
}

describe("useJobProgress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks while a job is set, and stops once it is cleared", async () => {
    vi.useFakeTimers();
    const runner = jobs({ export: running(1, 4) });
    const { result, rerender } = renderHook(({ id }) => useJobProgress(runner, id), {
      initialProps: { id: null as string | null },
    });
    expect(result.current).toEqual({ progress: null, startedAt: null });
    expect(runner.status).not.toHaveBeenCalled();

    rerender({ id: "export" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS);
    });
    expect(result.current.progress).toEqual(running(1, 4));

    rerender({ id: null });
    expect(result.current.progress).toBeNull();
    const asked = runner.status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS * 3);
    });
    expect(runner.status.mock.calls.length).toBe(asked);
  });

  it("counts from the first running answer, not from the request", async () => {
    vi.useFakeTimers();
    const answers: Record<string, JobProgress | null> = { export: null };
    const runner = jobs(answers);
    const { result } = renderHook(() => useJobProgress(runner, "export"));
    // Waiting for its lane: queued, no start.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS * 5);
    });
    expect(result.current.startedAt).toBeNull();

    answers.export = running(0, 0);
    const before = Date.now();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS);
    });
    const startedAt = result.current.startedAt;
    expect(startedAt).not.toBeNull();
    expect(startedAt!).toBeGreaterThanOrEqual(before);

    answers.export = running(2, 4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS * 3);
    });
    expect(result.current.startedAt).toBe(startedAt);
  });

  it("never shows one job's progress for the next", async () => {
    vi.useFakeTimers();
    const runner = jobs({ first: running(3, 4), second: null });
    const { result, rerender } = renderHook(({ id }) => useJobProgress(runner, id), {
      initialProps: { id: "first" as string | null },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.progress).toEqual(running(3, 4));

    // The next job has not answered yet: it is queued, not at 75%.
    rerender({ id: "second" });
    expect(result.current).toEqual({ progress: null, startedAt: null });
  });

  it("keeps the last answer when an ask fails", async () => {
    vi.useFakeTimers();
    const runner = jobs({ export: running(2, 4) });
    const { result } = renderHook(() => useJobProgress(runner, "export"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    runner.status.mockRejectedValueOnce(new Error("bridge busy"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_PROGRESS_POLL_MS);
    });
    expect(result.current.progress).toEqual(running(2, 4));
  });
});
