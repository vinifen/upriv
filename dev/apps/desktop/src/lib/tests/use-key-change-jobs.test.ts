/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  JOB_ERROR_CODES,
  RpcError,
  type JobService,
  type PasswordChangeFinishResult,
  type PasswordChangeResult,
  type UnlockRamChangeResult,
  type VaultSecurityService,
} from "@upriv/shared";
import {
  usePasswordChangeJob,
  useUnlockRamChangeJob,
  type PasswordChangeJobEvents,
  type UnlockRamChangeJobEvents,
} from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function jobs(): JobService & { cancel: ReturnType<typeof vi.fn> } {
  return { status: async () => null, cancel: vi.fn(async () => undefined) };
}

/** A security service whose other calls are never asked for here. */
function security(change: Partial<VaultSecurityService>): VaultSecurityService {
  return {
    changePassword: vi.fn(),
    finishPasswordChange: vi.fn(),
    changeKdfPreset: vi.fn(),
    updateKeyCopies: vi.fn(),
    keyStatus: vi.fn(),
    rebuildIndex: vi.fn(),
    ...change,
  };
}

function passwordEvents() {
  return {
    onChanged: vi.fn(),
    onFinished: vi.fn(),
    onFailed: vi.fn(),
    onCancelled: vi.fn(),
    onStopRefused: vi.fn(),
  } satisfies PasswordChangeJobEvents;
}

function unlockRamEvents() {
  return {
    onChanged: vi.fn(),
    onFailed: vi.fn(),
    onCancelled: vi.fn(),
    onStopRefused: vi.fn(),
  } satisfies UnlockRamChangeJobEvents;
}

const CHANGED: PasswordChangeResult = {
  backup: "20261117120000-notes.zip",
  backupSkipped: null,
  unreadable: 0,
  keyCopies: "done",
};

describe("usePasswordChangeJob", () => {
  it("sends the change with Back up first as a job and reports what it did", async () => {
    const run = deferred<PasswordChangeResult>();
    const service = security({ changePassword: vi.fn(() => run.promise) });
    const on = passwordEvents();
    const { result } = renderHook(() => usePasswordChangeJob(service, jobs(), on));

    act(() => {
      expect(result.current.changePassword("notes", "old", "new", true)).toBe(true);
    });
    const job = result.current.job;
    expect(job).toMatchObject({ vaultId: "notes", kind: "change" });
    expect(service.changePassword).toHaveBeenCalledWith("notes", {
      currentPassword: "old",
      newPassword: "new",
      backUpFirst: true,
      job: job?.id,
    });

    await act(async () => run.resolve(CHANGED));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onChanged).toHaveBeenCalledWith(CHANGED, { vaultId: "notes", kind: "change" });
    expect(on.onFinished).not.toHaveBeenCalled();
  });

  it("runs Finish with one password and reports it finished", async () => {
    const run = deferred<PasswordChangeFinishResult>();
    const service = security({ finishPasswordChange: vi.fn(() => run.promise) });
    const on = passwordEvents();
    const { result } = renderHook(() => usePasswordChangeJob(service, jobs(), on));

    act(() => {
      expect(result.current.finish("notes", "new")).toBe(true);
    });
    expect(service.finishPasswordChange).toHaveBeenCalledWith("notes", {
      password: "new",
      job: result.current.job?.id,
    });
    const finished: PasswordChangeFinishResult = { unreadable: 2, keyCopies: "waiting" };
    await act(async () => run.resolve(finished));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onFinished).toHaveBeenCalledWith(finished, { vaultId: "notes", kind: "finish" });
    expect(on.onChanged).not.toHaveBeenCalled();
  });

  it("refuses a second change while one runs", () => {
    const service = security({
      changePassword: vi.fn(() => new Promise<PasswordChangeResult>(() => undefined)),
    });
    const { result } = renderHook(() => usePasswordChangeJob(service, jobs(), passwordEvents()));

    act(() => {
      expect(result.current.changePassword("notes", "old", "new", false)).toBe(true);
    });
    act(() => {
      expect(result.current.finish("other", "pw")).toBe(false);
    });
    expect(service.finishPasswordChange).not.toHaveBeenCalled();
  });

  it("stops through job_cancel and reports a stop, not a failure", async () => {
    const run = deferred<PasswordChangeResult>();
    const service = jobs();
    const on = passwordEvents();
    const { result } = renderHook(() =>
      usePasswordChangeJob(security({ changePassword: vi.fn(() => run.promise) }), service, on),
    );

    act(() => {
      result.current.changePassword("notes", "old", "new", true);
    });
    const id = result.current.job?.id;
    act(() => result.current.stop());
    expect(service.cancel).toHaveBeenCalledWith(id, "user");
    expect(result.current.job?.stoppingSince).not.toBeNull();

    await act(async () => run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped")));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledWith({ vaultId: "notes", kind: "change" });
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("keeps running when core refuses the stop in the header write", async () => {
    const change = security({
      changePassword: vi.fn(() => new Promise<PasswordChangeResult>(() => undefined)),
    });
    const refused = new RpcError(JOB_ERROR_CODES.NOT_STOPPABLE, "finishing");
    const service = jobs();
    service.cancel.mockRejectedValueOnce(refused);
    const on = passwordEvents();
    const { result } = renderHook(() => usePasswordChangeJob(change, service, on));

    act(() => {
      result.current.changePassword("notes", "old", "new", true);
    });
    act(() => result.current.stop());
    await waitFor(() => expect(on.onStopRefused).toHaveBeenCalled());
    expect(on.onStopRefused.mock.calls[0]?.[0]).toBe(refused);
    expect(result.current.job?.stoppingSince).toBeNull();
  });
});

describe("useUnlockRamChangeJob", () => {
  it("sends the new preset as a job and reports where the key copies stand", async () => {
    const run = deferred<UnlockRamChangeResult>();
    const service = security({ changeKdfPreset: vi.fn(() => run.promise) });
    const on = unlockRamEvents();
    const { result } = renderHook(() => useUnlockRamChangeJob(service, jobs(), on));

    act(() => {
      expect(result.current.changeKdf("notes", "pw", "1gib")).toBe(true);
    });
    expect(service.changeKdfPreset).toHaveBeenCalledWith("notes", {
      currentPassword: "pw",
      nextPreset: "1gib",
      job: result.current.job?.id,
    });
    await act(async () => run.resolve({ keyCopies: "waiting" }));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onChanged).toHaveBeenCalledWith(
      { keyCopies: "waiting" },
      { vaultId: "notes", nextPreset: "1gib" },
    );
  });

  it("reports a stop before the header write as a stop", async () => {
    const run = deferred<UnlockRamChangeResult>();
    const on = unlockRamEvents();
    const { result } = renderHook(() =>
      useUnlockRamChangeJob(security({ changeKdfPreset: vi.fn(() => run.promise) }), jobs(), on),
    );

    act(() => {
      result.current.changeKdf("notes", "pw", "64mib");
    });
    act(() => result.current.stop());
    await act(async () => run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped")));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledWith({ vaultId: "notes", nextPreset: "64mib" });
  });
});
