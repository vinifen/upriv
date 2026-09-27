/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LOADING_BUDGET_MS, type I18nKey } from "@upriv/shared";
import { useVaultPipelineRun } from "@upriv/shared/react";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
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

  it("invalidates a create when its budget elapses and ignores the late result", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const hang = deferred();
    const queued = deferred();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onTimeout = vi.fn();
    const onAbandoned = vi.fn();
    const queuedComplete = vi.fn();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "create",
        stepCount: 1,
        presentation: "background",
        budgetMs: LOADING_BUDGET_MS.vaultCreate,
        failureMode: "advance",
        invalidateOnTimeout: true,
        runPipeline: async () => hang.promise,
        onComplete,
        onError,
        onTimeout,
        onAbandoned,
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "create",
        stepCount: 1,
        presentation: "background",
        failureMode: "advance",
        invalidateOnTimeout: true,
        runPipeline: async () => queued.promise,
        onComplete: queuedComplete,
        onError: () => undefined,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(LOADING_BUDGET_MS.vaultCreate);
    });

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(result.current.run).toBeNull();
    expect(result.current.isVaultPipelineBusy("vault-a")).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(queuedComplete).not.toHaveBeenCalled();
    expect(
      result.current.start({
        vaultId: "vault-a",
        kind: "create",
        stepCount: 1,
        runPipeline: async () => undefined,
        onComplete: () => undefined,
        onError: () => undefined,
      }),
    ).toBe(false);

    hang.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onAbandoned).toHaveBeenCalledWith(true);
    expect(result.current.isVaultPipelineBusy("vault-a")).toBe(false);

    await act(async () => {
      queued.resolve();
      await Promise.resolve();
    });
    expect(queuedComplete).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("stays busy after a create timeout until the failed rpc settles", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVaultPipelineRun(toI18n));
    const hang = deferred();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onAbandoned = vi.fn();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "create",
        stepCount: 1,
        presentation: "background",
        budgetMs: LOADING_BUDGET_MS.vaultCreate,
        failureMode: "advance",
        invalidateOnTimeout: true,
        runPipeline: async () => hang.promise,
        onComplete,
        onError,
        onAbandoned,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(LOADING_BUDGET_MS.vaultCreate);
    });

    expect(result.current.run).toBeNull();
    expect(result.current.isRunningNow()).toBe(true);
    expect(result.current.isVaultPipelineBusy("vault-a")).toBe(true);

    hang.reject(new Error("create failed"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAbandoned).toHaveBeenCalledWith(false);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.isRunningNow()).toBe(false);
    expect(result.current.isVaultPipelineBusy("vault-a")).toBe(false);
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
