/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useValueAfterPaint } from "@upriv/shared/react";

describe("useValueAfterPaint", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const nextFrame = () =>
    act(() => {
      vi.advanceTimersToNextFrame();
    });
  const afterFrame = () =>
    act(() => {
      vi.advanceTimersByTime(1);
    });

  it("starts on the value", () => {
    const { result } = renderHook(() => useValueAfterPaint("a"));
    expect(result.current).toBe("a");
  });

  it("holds the previous value until the frame has painted", () => {
    const { result, rerender } = renderHook(({ value }) => useValueAfterPaint(value), {
      initialProps: { value: "a" },
    });
    rerender({ value: "b" });
    expect(result.current).toBe("a");

    nextFrame();
    expect(result.current).toBe("a");

    afterFrame();
    expect(result.current).toBe("b");
  });

  it("settles on the last of several quick changes", () => {
    const { result, rerender } = renderHook(({ value }) => useValueAfterPaint(value), {
      initialProps: { value: "a" },
    });
    const seen: string[] = [];
    rerender({ value: "b" });
    seen.push(result.current);
    rerender({ value: "c" });
    seen.push(result.current);

    nextFrame();
    afterFrame();
    expect(result.current).toBe("c");
    expect(seen).toEqual(["a", "a"]);
  });

  it("drops the pending change when the value goes back", () => {
    const { result, rerender } = renderHook(({ value }) => useValueAfterPaint(value), {
      initialProps: { value: "a" },
    });
    rerender({ value: "b" });
    rerender({ value: "a" });
    nextFrame();
    afterFrame();
    expect(result.current).toBe("a");
  });

  it("leaves nothing to run after unmount", () => {
    const { rerender, unmount } = renderHook(({ value }) => useValueAfterPaint(value), {
      initialProps: { value: "a" },
    });
    rerender({ value: "b" });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
