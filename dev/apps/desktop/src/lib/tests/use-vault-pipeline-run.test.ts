/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LOADING_BUDGET_MS, type I18nKey } from "@upriv/shared";
import { useVaultPipelineRun } from "@upriv/shared/react";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const toI18n = (): I18nKey => "error.unexpected";

describe("useVaultPipelineRun", () => {
  it("returns false when the same vault is already running or queued", () => {
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const hang = deferred();

    act(() => {
      expect(
        result.current.start({
          vaultId: "vault-a",
          kind: "open",
          stepCount: 1,
          runPipeline: async () => hang.promise,
          onComplete: () => undefined,
          onError: () => undefined,
        }),
      ).toBe(true);
    });

    act(() => {
      expect(
        result.current.start({
          vaultId: "vault-a",
          kind: "close",
          stepCount: 1,
          runPipeline: async () => undefined,
          onComplete: () => undefined,
          onError: () => undefined,
        }),
      ).toBe(false);
    });
  });

  it("runs open/close jobs in FIFO order", async () => {
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const first = deferred();
    const completed: string[] = [];

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => first.promise,
        onComplete: () => completed.push("a"),
        onError: () => undefined,
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "close",
        stepCount: 1,
        runPipeline: async () => undefined,
        onComplete: () => completed.push("b"),
        onError: () => undefined,
      });
    });

    expect(result.current.run?.vaultId).toBe("vault-a");
    expect(result.current.queued).toEqual([{ vaultId: "vault-b", kind: "close" }]);

    await act(async () => {
      first.resolve();
    });

    await waitFor(() => {
      expect(completed).toEqual(["a", "b"]);
      expect(result.current.run).toBeNull();
      expect(result.current.queued).toEqual([]);
    });
  });

  it("starts with foreground false when presentation is background", () => {
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const hang = deferred();

    act(() => {
      expect(
        result.current.start({
          vaultId: "vault-a",
          kind: "close",
          stepCount: 1,
          presentation: "background",
          runPipeline: async () => hang.promise,
          onComplete: () => undefined,
          onError: () => undefined,
        }),
      ).toBe(true);
    });

    expect(result.current.run).toMatchObject({
      vaultId: "vault-a",
      kind: "close",
      foreground: false,
    });
  });

  it("keeps a late RPC success after the pipeline budget elapses", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const hang = deferred();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onTimeout = vi.fn();

    act(() => {
      expect(
        result.current.start({
          vaultId: "vault-a",
          kind: "open",
          stepCount: 1,
          runPipeline: async () => hang.promise,
          onComplete,
          onError,
          onTimeout,
        }),
      ).toBe(true);
    });

    await act(async () => {
      vi.advanceTimersByTime(LOADING_BUDGET_MS.vaultPipeline);
    });

    expect(result.current.run?.errorKey).toBe("loading.timed_out");
    expect(result.current.run?.foreground).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalledOnce();

    act(() => {
      result.current.dismissFailure();
    });
    expect(result.current.run?.foreground).toBe(false);
    expect(result.current.run?.errorKey).toBe("loading.timed_out");

    hang.resolve();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onComplete).toHaveBeenCalled();
    expect(result.current.run).toBeNull();
    vi.useRealTimers();
  });

  it("does not park an advance-mode job on a timeout overlay", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const hang = deferred();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onTimeout = vi.fn();

    act(() => {
      expect(
        result.current.start({
          vaultId: "vault-a",
          kind: "open",
          stepCount: 2,
          presentation: "background",
          failureMode: "advance",
          runPipeline: async () => hang.promise,
          onComplete,
          onError,
          onTimeout,
        }),
      ).toBe(true);
    });

    await act(async () => {
      vi.advanceTimersByTime(LOADING_BUDGET_MS.vaultPipeline);
    });

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(result.current.run?.errorKey).toBeUndefined();
    expect(result.current.run?.vaultId).toBe("vault-a");
    expect(onError).not.toHaveBeenCalled();

    hang.resolve();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(result.current.run).toBeNull();
    vi.useRealTimers();
  });

  it("queues create behind open; waiting create stays creating (not queued badge)", async () => {
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const first = deferred();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => first.promise,
        onComplete: () => undefined,
        onError: () => undefined,
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "create",
        stepCount: 1,
        presentation: "background",
        failureMode: "advance",
        runPipeline: async () => undefined,
        onComplete: () => undefined,
        onError: () => undefined,
      });
    });

    expect(result.current.openingVaultIds).toEqual(["vault-a"]);
    expect(result.current.creatingVaultIds).toEqual(["vault-b"]);
    expect(result.current.queuedVaultIds).toEqual([]);
    expect(result.current.getVaultPipelineListStatus("vault-a")).toBe("opening");
    expect(result.current.getVaultPipelineListStatus("vault-b")).toBe("creating");
    expect(result.current.queued).toEqual([{ vaultId: "vault-b", kind: "create" }]);

    await act(async () => {
      first.resolve();
    });
    await waitFor(() => {
      expect(result.current.run).toBeNull();
      expect(result.current.creatingVaultIds).toEqual([]);
      expect(result.current.queuedVaultIds).toEqual([]);
    });
  });

  it("lists a waiting open as queued while another vault is opening", async () => {
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const first = deferred();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => first.promise,
        onComplete: () => undefined,
        onError: () => undefined,
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => undefined,
        onComplete: () => undefined,
        onError: () => undefined,
      });
    });

    expect(result.current.openingVaultIds).toEqual(["vault-a"]);
    expect(result.current.queuedVaultIds).toEqual(["vault-b"]);
    expect(result.current.queuedOpenVaultIds).toEqual(["vault-b"]);
    expect(result.current.closingVaultIds).toEqual([]);
    expect(result.current.getVaultPipelineListStatus("vault-b")).toBe("queued");

    await act(async () => {
      first.resolve();
    });
    await waitFor(() => {
      expect(result.current.queuedVaultIds).toEqual([]);
    });
  });

  it("lists a waiting close as queued, not closing, until it starts", async () => {
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const first = deferred();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => first.promise,
        onComplete: () => undefined,
        onError: () => undefined,
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "close",
        stepCount: 1,
        presentation: "background",
        failureMode: "advance",
        runPipeline: async () => undefined,
        onComplete: () => undefined,
        onError: () => undefined,
      });
    });

    expect(result.current.closingVaultIds).toEqual([]);
    expect(result.current.queuedVaultIds).toEqual(["vault-b"]);
    expect(result.current.queuedOpenVaultIds).toEqual([]);
    expect(result.current.getVaultPipelineListStatus("vault-b")).toBe("queued");

    await act(async () => {
      first.resolve();
    });
    await waitFor(() => {
      expect(result.current.queuedVaultIds).toEqual([]);
      expect(result.current.run).toBeNull();
    });
  });

  it("advances the queue when a create job fails", async () => {
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    const completed: string[] = [];
    const errors: string[] = [];

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "create",
        stepCount: 1,
        presentation: "background",
        failureMode: "advance",
        runPipeline: async () => first,
        onComplete: () => undefined,
        onError: (key) => errors.push(key),
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => undefined,
        onComplete: () => completed.push("b"),
        onError: () => undefined,
      });
    });

    await act(async () => {
      rejectFirst(new Error("create failed"));
    });

    await waitFor(() => {
      expect(errors).toEqual(["error.unexpected"]);
      expect(completed).toEqual(["b"]);
      expect(result.current.run).toBeNull();
    });
  });
});
