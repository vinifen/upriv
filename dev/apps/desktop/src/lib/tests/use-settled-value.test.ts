/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettledValue } from "@upriv/shared/react";

describe("useSettledValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows the value once it holds still for the delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useSettledValue(value, 300, "/a.md"),
      { initialProps: { value: "a" } },
    );
    const wait = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    rerender({ value: "ab" });
    wait(200);
    rerender({ value: "abc" });
    wait(200);
    expect(result.current).toBe("a");

    wait(100);
    expect(result.current).toBe("abc");
  });

  it("takes the value at once for a new key", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value, key }: { value: string; key: string }) => useSettledValue(value, 300, key),
      { initialProps: { value: "first file", key: "/a.md" } },
    );
    rerender({ value: "second file", key: "/b.md" });
    expect(result.current).toBe("second file");
  });
});
