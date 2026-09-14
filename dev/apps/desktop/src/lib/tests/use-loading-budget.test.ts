/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOADING_APPEAR_DELAY_MS,
  LOADING_BUDGET_MS,
  LOADING_LONG_HINT_APPEAR_DELAY_MS,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";

describe("useLoadingBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays visible until the appear budget, then times out", () => {
    const { result } = renderHook(() => useLoadingBudget(true, 5_000));
    expect(result.current.visible).toBe(false);
    expect(result.current.timedOut).toBe(false);

    act(() => {
      vi.advanceTimersByTime(LOADING_APPEAR_DELAY_MS);
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.timedOut).toBe(false);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.timedOut).toBe(true);
    expect(result.current.visible).toBe(true);
    expect(result.current.remainingMs).toBe(0);
  });

  it("resets when active becomes false", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useLoadingBudget(active, 5_000),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(LOADING_APPEAR_DELAY_MS);
    });
    expect(result.current.visible).toBe(true);

    rerender({ active: false });
    expect(result.current.visible).toBe(false);
    expect(result.current.timedOut).toBe(false);
    expect(result.current.remainingMs).toBe(5_000);
  });

  it("holds a 10-minute hint until the long appear delay", () => {
    const { result } = renderHook(() => useLoadingBudget(true, LOADING_BUDGET_MS.vaultPipeline));
    act(() => {
      vi.advanceTimersByTime(LOADING_APPEAR_DELAY_MS);
    });
    expect(result.current.visible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(LOADING_LONG_HINT_APPEAR_DELAY_MS - LOADING_APPEAR_DELAY_MS);
    });
    expect(result.current.visible).toBe(true);
  });

  it("shares remaining time when two consumers use the same startedAt", () => {
    const startedAt = Date.now();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    const first = renderHook(() =>
      useLoadingBudget(true, LOADING_BUDGET_MS.vaultPipeline, { startedAt }),
    );
    const second = renderHook(() =>
      useLoadingBudget(true, LOADING_BUDGET_MS.vaultPipeline, { startedAt }),
    );
    expect(first.result.current.visible).toBe(false);
    expect(second.result.current.remainingMs).toBe(first.result.current.remainingMs);

    act(() => {
      vi.advanceTimersByTime(LOADING_LONG_HINT_APPEAR_DELAY_MS - 2_000);
    });
    expect(first.result.current.visible).toBe(true);
    expect(second.result.current.visible).toBe(true);
    expect(second.result.current.remainingMs).toBe(first.result.current.remainingMs);
  });
});
