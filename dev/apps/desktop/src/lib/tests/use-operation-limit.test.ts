/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_APPEAR_DELAY_MS, OPERATION_LIMIT_MS } from "@upriv/shared";
import { useElapsed, useOperationLimit } from "@upriv/shared/react";

describe("useOperationLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows after the appear delay and times out at the one limit", () => {
    const { result } = renderHook(() => useOperationLimit(true));
    expect(result.current).toEqual({ visible: false, timedOut: false });

    act(() => {
      vi.advanceTimersByTime(LOADING_APPEAR_DELAY_MS);
    });
    expect(result.current).toEqual({ visible: true, timedOut: false });

    act(() => {
      vi.advanceTimersByTime(OPERATION_LIMIT_MS);
    });
    expect(result.current.timedOut).toBe(true);
  });

  it("resets when the work ends", () => {
    const { result, rerender } = renderHook(({ active }) => useOperationLimit(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(LOADING_APPEAR_DELAY_MS);
    });
    rerender({ active: false });
    expect(result.current).toEqual({ visible: false, timedOut: false });
  });
});

describe("useElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is null while queued, then counts from the start", () => {
    const { result, rerender } = renderHook(({ startedAt }) => useElapsed(startedAt), {
      initialProps: { startedAt: null as number | null },
    });
    expect(result.current).toBeNull();

    rerender({ startedAt: Date.now() });
    expect(result.current?.visible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current?.visible).toBe(true);
    expect(result.current?.elapsedMs).toBeGreaterThanOrEqual(2_000);
    expect(result.current?.elapsedMs).toBeLessThanOrEqual(3_000);
  });
});
