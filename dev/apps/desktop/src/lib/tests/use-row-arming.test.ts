/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROW_ARM_CONFIRM_AFTER_MS, ROW_ARM_WINDOW_MS, ROW_ROLE_GUARD_MS } from "@upriv/shared";
import { disarmRowButton, useArmedRowButton, useRowArming } from "@upriv/shared/react";

describe("useRowArming", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      disarmRowButton();
    });
    vi.useRealTimers();
  });

  it("arms on the first press and runs on a second one", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRowArming("notes", "stop", true));

    act(() => result.current.press(action));
    expect(result.current.armed).toBe(true);
    expect(action).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ROW_ARM_CONFIRM_AFTER_MS);
    });
    act(() => result.current.press(action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);
  });

  it("runs at once when the button asks once", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useRowArming("notes", "unlock", false));
    act(() => result.current.press(action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);
  });

  it("goes back to normal when the window passes", () => {
    const { result } = renderHook(() => useRowArming("notes", "stop", true));
    act(() => result.current.press(() => undefined));
    act(() => {
      vi.advanceTimersByTime(ROW_ARM_WINDOW_MS);
    });
    expect(result.current.armed).toBe(false);
  });

  it("keeps one armed button in the app", () => {
    const { result } = renderHook(() => ({
      a: useRowArming("a", "stop", true),
      b: useRowArming("b", "stop", true),
      armed: useArmedRowButton(),
    }));
    act(() => result.current.a.press(() => undefined));
    expect(result.current.armed).toBe("a");
    act(() => result.current.b.press(() => undefined));
    expect(result.current.armed).toBe("b");
    expect(result.current.a.armed).toBe(false);
  });

  it("disarms when the button changes what it does, and ignores presses for a moment", () => {
    const action = vi.fn();
    const { result, rerender } = renderHook(({ role }) => useRowArming("notes", role, false), {
      initialProps: { role: "stop" },
    });
    rerender({ role: "unlock" });
    act(() => result.current.press(action));
    expect(action).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ROW_ROLE_GUARD_MS);
    });
    act(() => result.current.press(action));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
