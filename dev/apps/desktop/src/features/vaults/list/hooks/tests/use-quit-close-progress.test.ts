/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultCloseState, VaultListItem } from "@upriv/shared";

const mocks = vi.hoisted(() => ({
  answers: new Map<string, VaultCloseState[]>(),
  quitStarted: null as null | ((payload: unknown) => void),
}));

vi.mock("@/lib/rpc", () => ({
  rpcVaultClosePhase: vi.fn(async (id: string) => mocks.answers.get(id)?.shift() ?? null),
}));

vi.mock("@/lib/useDesktopEvent", () => ({
  useDesktopEvent: (name: string, handler: (payload: unknown) => void) => {
    if (name === "quit_closing") mocks.quitStarted = handler;
  },
}));

import { rpcVaultClosePhase } from "@/lib/rpc";
import { useQuitCloseProgress } from "../useQuitCloseProgress";

function vault(id: string, session: VaultListItem["session"]): VaultListItem {
  return { id, displayName: id, session } as VaultListItem;
}

const VAULTS = [vault("notes", "open"), vault("photos", null)];

async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
}

describe("useQuitCloseProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.answers.clear();
    mocks.quitStarted = null;
    vi.mocked(rpcVaultClosePhase).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks nothing before the quit starts", async () => {
    const { result } = renderHook(() => useQuitCloseProgress(VAULTS, vi.fn()));
    await poll();
    expect(rpcVaultClosePhase).not.toHaveBeenCalled();
    expect(result.current.closingVaultIds).toEqual([]);
  });

  it("follows each open vault through the quit's close, then marks its row closed", async () => {
    mocks.answers.set("notes", [
      { state: "open" },
      { state: "closing", phase: "flush" },
      { state: "closing", phase: "backup" },
      { state: "closed" },
    ]);
    const setRuntime = vi.fn();
    const { result } = renderHook(() => useQuitCloseProgress(VAULTS, setRuntime));

    act(() => mocks.quitStarted?.({ now: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Waiting for the quit to reach it: the row stays as it is.
    expect(result.current.closingVaultIds).toEqual([]);

    await poll();
    expect(result.current.closingVaultIds).toEqual(["notes"]);
    expect(result.current.backingUpVaultIds).toEqual([]);
    expect(result.current.rowWork.notes).toMatchObject({ stop: null, timed: true });

    await poll();
    expect(result.current.backingUpVaultIds).toEqual(["notes"]);

    await poll();
    expect(result.current.closingVaultIds).toEqual([]);
    expect(setRuntime).toHaveBeenCalledWith("notes", { session: null });

    // Only the vault that was open is asked about, and asking stops once it closed.
    const calls = vi.mocked(rpcVaultClosePhase).mock.calls.length;
    await poll();
    expect(vi.mocked(rpcVaultClosePhase).mock.calls.length).toBe(calls);
    expect(rpcVaultClosePhase).not.toHaveBeenCalledWith("photos");
  });

  it("follows a vault whose open ends after the quit started", async () => {
    mocks.answers.set("photos", [{ state: "closing", phase: "flush" }, { state: "closed" }]);
    const setRuntime = vi.fn();
    const { result, rerender } = renderHook(
      ({ vaults }) => useQuitCloseProgress(vaults, setRuntime),
      { initialProps: { vaults: [vault("photos", null)] } },
    );

    act(() => mocks.quitStarted?.({ now: false }));
    await poll();
    // Still opening: the quit waits for that open, so nothing to ask yet.
    expect(rpcVaultClosePhase).not.toHaveBeenCalled();

    rerender({ vaults: [vault("photos", "open")] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.closingVaultIds).toEqual(["photos"]);

    await poll();
    expect(result.current.closingVaultIds).toEqual([]);
    expect(setRuntime).toHaveBeenCalledWith("photos", { session: null });
  });
});
