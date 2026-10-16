/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultListItem } from "@upriv/shared";
import { useIdleAutoClose, type IdleSessionEvent } from "@upriv/shared/react";

const start = new Date("2026-06-01T00:00:00.000Z");
const vault = { id: "notes", session: "open" } as VaultListItem;

describe("useIdleAutoClose pause", () => {
  let onSession: (event: IdleSessionEvent) => void;
  let onActivity: () => void;

  beforeEach(() => {
    onSession = () => {};
    onActivity = () => {};
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function mount(
    keepOpenOnWake: boolean,
    onLock: (vaultId: string) => Promise<"started" | "wait">,
    onWarn: () => boolean = () => true,
    options?: {
      vaults?: VaultListItem[];
      loadAutoClose?: (
        vaultId: string,
      ) => Promise<{ enabled: boolean; idle_minutes: number } | null>;
    },
  ) {
    const hook = renderHook(() =>
      useIdleAutoClose({
        vaults: options?.vaults ?? [vault],
        keepOpenOnWake,
        loadAutoClose:
          options?.loadAutoClose ?? (async () => ({ enabled: true, idle_minutes: 15 })),
        subscribeSession: (listener) => {
          onSession = listener;
          return () => {};
        },
        subscribeActivity: (listener) => {
          onActivity = listener;
          return () => {};
        },
        onLock,
        onWarn,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    return hook;
  }

  it("does not lock during a pause when that time does not count", async () => {
    const onLock = vi.fn(async () => "started" as const);
    const { unmount } = await mount(true, onLock);

    act(() => {
      onSession("pause");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    });
    expect(onLock).not.toHaveBeenCalled();

    act(() => {
      onSession("resume");
    });
    expect(onLock).not.toHaveBeenCalled();
    unmount();
  });

  it("treats a touch during the pause as activity when that time does not count", async () => {
    const onLock = vi.fn(async () => "started" as const);
    const onWarn = vi.fn(() => true);
    const { unmount } = await mount(true, onLock, onWarn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    act(() => {
      onSession("pause");
      vi.setSystemTime(start.getTime() + 30 * 60_000);
      onActivity();
      onSession("resume");
    });
    onWarn.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60_000);
    });
    expect(onWarn).not.toHaveBeenCalled();
    expect(onLock).not.toHaveBeenCalled();
    unmount();
  });

  it("locks on resume when the vault was already due as the pause began", async () => {
    const onLock = vi.fn(async () => "started" as const);
    const { unmount } = await mount(true, onLock);

    act(() => {
      vi.setSystemTime(start.getTime() + 15 * 60_000);
      onSession("pause");
    });
    expect(onLock).not.toHaveBeenCalled();
    act(() => {
      onSession("resume");
    });
    expect(onLock).toHaveBeenCalledWith("notes");
    unmount();
  });

  it("locks while paused when sleep counts", async () => {
    const onLock = vi.fn(async () => "started" as const);
    const { unmount } = await mount(false, onLock);

    act(() => {
      onSession("pause");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(onLock).toHaveBeenCalledWith("notes");
    unmount();
  });

  it("does not start another lock for each scroll while a close is still running", async () => {
    let release: (result: "wait") => void = () => {};
    const onLock = vi.fn(
      () =>
        new Promise<"wait">((resolve) => {
          release = resolve;
        }),
    );
    const { unmount } = await mount(false, onLock);

    // Move the deadline off the 15s settings ticks, then let those ticks finish
    // before the lock so a settings read cannot ask for another pass.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => {
      onActivity();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    });
    expect(onLock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(onLock).toHaveBeenCalledTimes(1);

    act(() => {
      for (let i = 0; i < 40; i += 1) onActivity();
    });
    await act(async () => {
      release("wait");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onLock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(4_999);
      await Promise.resolve();
    });
    expect(onLock).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(onLock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("keeps moving the deadline through a burst of activity", async () => {
    const onLock = vi.fn(async () => "started" as const);
    const { unmount } = await mount(false, onLock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000);
    });
    act(() => {
      onActivity();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => {
      onActivity();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000 - 500);
    });
    expect(onLock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(onLock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not stack a settings read on every tick while one is still running", async () => {
    const pending: Array<(value: { enabled: boolean; idle_minutes: number }) => void> = [];
    const loadAutoClose = vi.fn(
      () =>
        new Promise<{ enabled: boolean; idle_minutes: number }>((resolve) => {
          pending.push(resolve);
        }),
    );
    const onLock = vi.fn(async () => "started" as const);
    const photos = { id: "photos", session: "open" } as VaultListItem;
    const { unmount } = await mount(false, onLock, () => true, {
      vaults: [vault, photos],
      loadAutoClose,
    });

    expect(loadAutoClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(loadAutoClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.shift()?.({ enabled: true, idle_minutes: 15 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadAutoClose).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("does not poll settings while every vault is closed", async () => {
    const loadAutoClose = vi.fn(async () => ({ enabled: true, idle_minutes: 15 }));
    const onLock = vi.fn(async () => "started" as const);
    const { unmount } = await mount(false, onLock, () => true, {
      vaults: [{ id: "notes", session: null } as VaultListItem],
      loadAutoClose,
    });
    expect(loadAutoClose).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(loadAutoClose).not.toHaveBeenCalled();
    unmount();
  });

  it("skips a vault that left the plan while an earlier close was still running", async () => {
    let release: (result: "started") => void = () => {};
    let notesHeld = false;
    const onLock = vi.fn((id: string) => {
      if (id === "notes" && !notesHeld) {
        notesHeld = true;
        return new Promise<"started">((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve("started" as const);
    });
    let photosEnabled = true;
    const loadAutoClose = vi.fn(async (id: string) => {
      if (id === "photos" && !photosEnabled) return { enabled: false, idle_minutes: 15 };
      return { enabled: true, idle_minutes: 15 };
    });
    const photos = { id: "photos", session: "open" } as VaultListItem;
    const { unmount } = await mount(false, onLock, () => true, {
      vaults: [vault, photos],
      loadAutoClose,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onLock).toHaveBeenCalledWith("notes");

    photosEnabled = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      release("started");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onLock).not.toHaveBeenCalledWith("photos");
    unmount();
  });

  it("keeps a sooner wake when a retry is asked", async () => {
    const onLock = vi.fn(async () => "started" as const);
    const { result, unmount } = await mount(false, onLock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000 - 2_000);
    });
    expect(onLock).not.toHaveBeenCalled();
    act(() => {
      result.current.scheduleIdleRetry();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(onLock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not arm a lock after the screen unmounts during a close", async () => {
    let release: (result: "wait") => void = () => {};
    const onLock = vi.fn(
      () =>
        new Promise<"wait">((resolve) => {
          release = resolve;
        }),
    );
    const { unmount } = await mount(false, onLock);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(onLock).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      release("wait");
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    });
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});
