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
    expect(result.current.message).toBe("saved");

    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_MS);
    });
    expect(result.current.message).toBeNull();
  });

  it("dismisses immediately and ignores a late timer", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.show("saved");
      result.current.dismiss();
    });
    expect(result.current.message).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TOAST_DEFAULT_MS);
    });
    expect(result.current.message).toBeNull();
  });
});
