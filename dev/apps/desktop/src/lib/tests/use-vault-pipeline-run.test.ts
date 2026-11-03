/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JOB_ERROR_CODES, RpcError, type I18nKey, type JobService } from "@upriv/shared";
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

function jobStub(cancel: JobService["cancel"] = vi.fn(async () => undefined)): JobService {
  return { status: vi.fn(async () => null), cancel };
}

function renderPipeline(jobs: JobService = jobStub(), onStopRefused = vi.fn()) {
  const errorToI18nKey = (): I18nKey => "error.unexpected";
  return renderHook(() => useVaultPipelineRun({ errorToI18nKey, jobs, onStopRefused }));
}

const cancelled = () => new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped");

describe("useVaultPipelineRun", () => {
  it("returns false when the same vault is already running or queued", () => {
    const { result } = renderPipeline();
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
    const { result } = renderPipeline();
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
    const { result } = renderPipeline();
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

  it("sends each run with its own core job id", () => {
    const { result } = renderPipeline();
    const hang = deferred();
    const runPipeline = vi.fn(async () => hang.promise);

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "create",
        stepCount: 1,
        runPipeline,
        onComplete: () => undefined,
        onError: () => undefined,
      });
    });

    const job = result.current.run?.job;
    expect(job).toMatch(/\S/);
    expect(runPipeline).toHaveBeenCalledWith("vault-a", expect.any(Function), job);
  });

  it("has no time limit: a long open is still running an hour later", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderPipeline();
      const hang = deferred();
      const onError = vi.fn();

      act(() => {
        result.current.start({
          vaultId: "vault-a",
          kind: "open",
          stepCount: 1,
          runPipeline: async () => hang.promise,
          onComplete: () => undefined,
          onError,
        });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
      });
      expect(result.current.run?.vaultId).toBe("vault-a");
      expect(result.current.run?.errorKey).toBeUndefined();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an open still waiting in the queue at once", () => {
    const jobs = jobStub();
    const { result } = renderPipeline(jobs);
    const hang = deferred();
    const onStopped = vi.fn();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => hang.promise,
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
        onStopped,
      });
    });

    act(() => result.current.stop("vault-b"));

    expect(onStopped).toHaveBeenCalledOnce();
    expect(result.current.queued).toEqual([]);
    expect(jobs.cancel).not.toHaveBeenCalled();
  });

  it("asks core to stop a running open, and ends it as stopped, not failed", async () => {
    const jobs = jobStub();
    const { result } = renderPipeline(jobs);
    const hang = deferred();
    const onStopped = vi.fn();
    const onError = vi.fn();
    const next = vi.fn();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => hang.promise,
        onComplete: () => undefined,
        onError,
        onStopped,
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => undefined,
        onComplete: next,
        onError: () => undefined,
      });
    });
    const job = result.current.run?.job;

    act(() => result.current.stop("vault-a"));
    expect(jobs.cancel).toHaveBeenCalledWith(job, "user");
    expect(result.current.runWork?.stoppingSince).not.toBeNull();

    await act(async () => {
      hang.reject(cancelled());
    });

    await waitFor(() => {
      expect(onStopped).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledOnce();
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the run going when core refuses the stop", async () => {
    const refusal = new RpcError(JOB_ERROR_CODES.NOT_STOPPABLE, "finishing");
    const onStopRefused = vi.fn();
    const { result } = renderPipeline(
      jobStub(vi.fn(async () => Promise.reject(refusal))),
      onStopRefused,
    );
    const hang = deferred();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "create",
        stepCount: 1,
        runPipeline: async () => hang.promise,
        onComplete: () => undefined,
        onError: () => undefined,
      });
    });

    await act(async () => {
      result.current.stop("vault-a");
    });

    expect(onStopRefused).toHaveBeenCalledWith(refusal);
    expect(result.current.runWork?.stoppingSince).toBeNull();
    expect(result.current.run?.vaultId).toBe("vault-a");
  });

  it("never stops a close: Close now is its stop", () => {
    const jobs = jobStub();
    const { result } = renderPipeline(jobs);
    const hang = deferred();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "close",
        stepCount: 1,
        runPipeline: async () => hang.promise,
        onComplete: () => undefined,
        onError: () => undefined,
      });
    });

    act(() => result.current.stop("vault-a"));
    expect(jobs.cancel).not.toHaveBeenCalled();
    expect(result.current.runWork).toMatchObject({ stoppable: false, stoppingSince: null });
    expect(result.current.runWork?.startedAt).toBe(result.current.run?.sentAt);
  });

  it("keeps a waiting close in the queue when Stop names its vault", () => {
    const { result } = renderPipeline();
    const hang = deferred();
    const onStopped = vi.fn();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => hang.promise,
        onComplete: () => undefined,
        onError: () => undefined,
      });
      result.current.start({
        vaultId: "vault-b",
        kind: "close",
        stepCount: 1,
        runPipeline: async () => undefined,
        onComplete: () => undefined,
        onError: () => undefined,
        onStopped,
      });
    });

    act(() => result.current.stop("vault-b"));
    expect(onStopped).not.toHaveBeenCalled();
    expect(result.current.queuedVaultIds).toEqual(["vault-b"]);
  });

  it("counts a job from core's first answer, not from the request", () => {
    const { result } = renderPipeline();
    const hang = deferred();

    act(() => {
      result.current.start({
        vaultId: "vault-a",
        kind: "open",
        stepCount: 1,
        runPipeline: async () => hang.promise,
        onComplete: () => undefined,
        onError: () => undefined,
      });
    });

    // The stub's `job_status` never answers that it runs: the open is queued.
    expect(result.current.runWork?.startedAt).toBeNull();
  });

  it("queues create behind open; waiting create stays creating (not queued badge)", async () => {
    const { result } = renderPipeline();
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
    const { result } = renderPipeline();
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
    const { result } = renderPipeline();
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
    const { result } = renderPipeline();
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
