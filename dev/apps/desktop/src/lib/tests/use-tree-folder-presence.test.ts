/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileTreeNode } from "@upriv/shared";
import { useTreeFolderPresence } from "@upriv/shared/react";

const chosen: FileTreeNode = {
  name: "Notes",
  type: "folder",
  inFolder: true,
  children: [{ name: "a.txt", type: "file", inFolder: true }],
};
const whole: FileTreeNode = {
  name: "Notes",
  type: "folder",
  children: [{ name: "a.txt", type: "file" }],
};

describe("useTreeFolderPresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("polls while the tree has marks and stops when it unmounts", () => {
    const syncTree = vi.fn(async () => undefined);
    const { result, unmount } = renderHook(() => useTreeFolderPresence(chosen, syncTree));
    expect(result.current?.get("/a.txt")).toBe("all");

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(syncTree).toHaveBeenCalledTimes(2);

    unmount();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(syncTree).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for a tree without marks", () => {
    const syncTree = vi.fn(async () => undefined);
    const { result } = renderHook(() => useTreeFolderPresence(whole, syncTree));
    expect(result.current).toBeNull();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(syncTree).not.toHaveBeenCalled();
  });

  it("keeps polling after one fails", async () => {
    const syncTree = vi.fn(async () => {
      throw new Error("vault closing");
    });
    renderHook(() => useTreeFolderPresence(chosen, syncTree));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(syncTree).toHaveBeenCalledTimes(2);
  });
});
