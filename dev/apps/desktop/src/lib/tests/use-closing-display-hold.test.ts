/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_CLOSING_DISPLAY_MS } from "@upriv/shared";
import { useClosingDisplayHold } from "@upriv/shared/react";

describe("useClosingDisplayHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds a normal close on screen for the floor", () => {
    const { result } = renderHook(() => useClosingDisplayHold());
    const reveal = vi.fn();
    act(() => {
      result.current.begin("notes");
      result.current.settle("notes", reveal);
    });
    expect(reveal).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(MIN_CLOSING_DISPLAY_MS);
    });
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("reveals Close now at once", () => {
    const { result } = renderHook(() => useClosingDisplayHold());
    const reveal = vi.fn();
    act(() => {
      result.current.begin("notes");
      result.current.settle("notes", reveal, { immediate: true });
    });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(result.current.holdIds).toEqual([]);
  });
});
