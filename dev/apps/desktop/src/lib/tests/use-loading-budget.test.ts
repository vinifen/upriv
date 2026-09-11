/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_APPEAR_DELAY_MS } from "@upriv/shared";
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
});
