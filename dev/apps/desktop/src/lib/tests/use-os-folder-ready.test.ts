/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OsFolderAnswer } from "@upriv/shared";
import { useOsFolderReady } from "@upriv/shared/react";

const READY: OsFolderAnswer = { state: "ready", osPath: "/mnt/upriv-unlocked/Notes" };

/** Lets `ms` pass and every answer land. */
async function pass(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOsFolderReady", () => {
  it("is ready only when core says the folder is there", async () => {
    const osPath = vi.fn(async (): Promise<OsFolderAnswer> => READY);
    const { result } = renderHook(() => useOsFolderReady(osPath, "notes", true));
    await pass(0);
    expect(result.current.ready).toBe(true);
    expect(osPath).toHaveBeenCalledWith("notes", "/");

    osPath.mockResolvedValue({ state: "none" });
    act(() => result.current.recheck());
    await pass(0);
    expect(result.current.ready).toBe(false);
  });

  it("asks again each second while the folder attaches", async () => {
    const osPath = vi.fn(async (): Promise<OsFolderAnswer> => ({ state: "attaching" }));
    const { result } = renderHook(() => useOsFolderReady(osPath, "notes", true));
    await pass(0);
    expect(result.current.ready).toBe(false);

    osPath.mockResolvedValue(READY);
    await pass(1_000);
    expect(result.current.ready).toBe(true);
    expect(osPath).toHaveBeenCalledTimes(2);
  });

  it("hides the folder once its mount stops answering, until the next ask", async () => {
    const osPath = vi.fn(async (): Promise<OsFolderAnswer> => READY);
    const { result } = renderHook(() => useOsFolderReady(osPath, "notes", true));
    await pass(0);
    act(() => result.current.lost());
    expect(result.current.ready).toBe(false);
    act(() => result.current.recheck());
    await pass(0);
    expect(result.current.ready).toBe(true);
  });

  it("asks nothing while the vault is not open, and a failed ask is no folder", async () => {
    const osPath = vi.fn(async (): Promise<OsFolderAnswer> => {
      throw new Error("no answer");
    });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useOsFolderReady(osPath, "notes", enabled),
      { initialProps: { enabled: false } },
    );
    await pass(0);
    expect(osPath).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await pass(0);
    expect(result.current.ready).toBe(false);
  });
});
