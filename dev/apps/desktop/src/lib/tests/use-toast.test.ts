/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_DEFAULT_MS, useToast } from "@upriv/shared/react";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a message and clears after the default duration", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.show("saved");
    });
    expect(result.current.toast).toMatchObject({
      message: "saved",
      durationMs: TOAST_DEFAULT_MS,
    });

    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_MS);
    });
    expect(result.current.toast).toBeNull();
  });

  it("dismisses immediately and ignores a late timer", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.show("saved");
      result.current.dismiss();
    });
    expect(result.current.toast).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_MS);
    });
    expect(result.current.toast).toBeNull();
  });

  it("restarts the timer and changes the id when the same message repeats", () => {
    const { result } = renderHook(() => useToast(1000));
    act(() => {
      result.current.show("saved");
    });
    const firstId = result.current.toast?.id;
    act(() => {
      vi.advanceTimersByTime(600);
      result.current.show("saved");
    });
    expect(result.current.toast?.id).not.toBe(firstId);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.toast?.message).toBe("saved");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.toast).toBeNull();
  });

  it("keeps a zero-duration toast until dismissed", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.show("sticky", 0);
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_MS * 10);
    });
    expect(result.current.toast).toMatchObject({ message: "sticky", durationMs: 0 });
  });
});
