/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  JOB_ERROR_CODES,
  RpcError,
  type JobProgress,
  type JobService,
  type PasswordChangeFinishResult,
  type PasswordChangeResult,
  type StorageChangeResult,
  type UnlockRamChangeResult,
  type VaultSecurityService,
} from "@upriv/shared";
import {
  usePasswordChangeJob,
  useStorageChangeJob,
  useUnlockRamChangeJob,
  type PasswordChangeJobEvents,
  type StorageChangeJobEvents,
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

/** A password change as the settings window starts it. */
const CHANGE = {
  currentPassword: "old",
  newPassword: "new",
  backUpFirst: true,
  passwordHint: "",
};

function jobs(): JobService & { cancel: ReturnType<typeof vi.fn> } {
  return { status: async () => null, cancel: vi.fn(async () => undefined), skipBackup: vi.fn() };
}

/** A security service whose other calls are never asked for here. */
function security(change: Partial<VaultSecurityService>): VaultSecurityService {
  return {
    changePassword: vi.fn(),
    finishPasswordChange: vi.fn(),
    changeKdfPreset: vi.fn(),
    changeStorage: vi.fn(),
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
      expect(result.current.changePassword("notes", CHANGE)).toBe(true);
    });
    const job = result.current.job;
    expect(job).toMatchObject({ vaultId: "notes", kind: "change" });
    expect(service.changePassword).toHaveBeenCalledWith("notes", { ...CHANGE, job: job?.id });

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
      expect(result.current.changePassword("notes", { ...CHANGE, backUpFirst: false })).toBe(true);
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
      result.current.changePassword("notes", CHANGE);
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
      result.current.changePassword("notes", CHANGE);
    });
    act(() => result.current.stop());
    await waitFor(() => expect(on.onStopRefused).toHaveBeenCalled());
    expect(on.onStopRefused.mock.calls[0]?.[0]).toBe(refused);
    expect(result.current.job?.stoppingSince).toBeNull();
  });

  /** A change that never ends, whose `job_status` answers `step`. */
  function changeIn(step: JobProgress["step"], skipped: boolean) {
    const service = {
      status: vi.fn(async () => ({ bytesDone: 1, bytesTotal: 4, stoppable: true, step })),
      cancel: vi.fn(async () => undefined),
      skipBackup: vi.fn(async () => skipped),
    } satisfies JobService;
    const change = security({
      changePassword: vi.fn(() => new Promise<PasswordChangeResult>(() => undefined)),
    });
    const hook = renderHook(() => usePasswordChangeJob(change, service, passwordEvents()));
    act(() => {
      hook.result.current.changePassword("notes", CHANGE);
    });
    return { service, result: hook.result };
  }

  it("shows Back up first as its own step, whose stop ends only the backup", async () => {
    const { service, result } = changeIn("backing_up", true);
    await waitFor(() =>
      expect(result.current.backupStep).toMatchObject({ vaultId: "notes", stoppingSince: null }),
    );

    act(() => result.current.skipBackup());
    expect(service.skipBackup).toHaveBeenCalledWith(result.current.job?.id);
    expect(result.current.backupStep?.stoppingSince).not.toBeNull();
    expect(service.cancel).not.toHaveBeenCalled();
    expect(result.current.job?.stoppingSince).toBeNull();
  });

  it("shows Stop again when the backup had already ended", async () => {
    const { service, result } = changeIn("backing_up", false);
    await waitFor(() => expect(result.current.backupStep).not.toBeNull());

    act(() => result.current.skipBackup());
    await waitFor(() => expect(service.skipBackup).toHaveBeenCalled());
    await waitFor(() => expect(result.current.backupStep?.stoppingSince).toBeNull());
  });

  it("has no backup step while the change rewrites the files", async () => {
    const { service, result } = changeIn("rewriting_files", true);
    await waitFor(() => expect(result.current.job?.progress).not.toBeNull());
    expect(result.current.backupStep).toBeNull();

    act(() => result.current.skipBackup());
    expect(service.skipBackup).not.toHaveBeenCalled();
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

describe("useStorageChangeJob", () => {
  const PLAIN = { mode: "upriv_plain", plain_files: "whole" } as const;

  function storageEvents() {
    return {
      onChanged: vi.fn(),
      onFailed: vi.fn(),
      onCancelled: vi.fn(),
      onStopRefused: vi.fn(),
    } satisfies StorageChangeJobEvents;
  }

  it("sends the chosen value and the password as a job and reports what it stored", async () => {
    const run = deferred<StorageChangeResult>();
    const service = security({ changeStorage: vi.fn(() => run.promise) });
    const on = storageEvents();
    const { result } = renderHook(() => useStorageChangeJob(service, jobs(), on));

    act(() => {
      expect(result.current.changeStorage("notes", "pw", PLAIN)).toBe(true);
    });
    expect(service.changeStorage).toHaveBeenCalledWith("notes", {
      password: "pw",
      storage: PLAIN,
      job: result.current.job?.id,
    });
    await act(async () => run.resolve({ storage: PLAIN }));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onChanged).toHaveBeenCalledWith(
      { storage: PLAIN },
      { vaultId: "notes", storage: PLAIN },
    );
  });

  it("reports a stop during the unlock as a stop", async () => {
    const run = deferred<StorageChangeResult>();
    const on = storageEvents();
    const { result } = renderHook(() =>
      useStorageChangeJob(security({ changeStorage: vi.fn(() => run.promise) }), jobs(), on),
    );

    act(() => {
      result.current.changeStorage("notes", "pw", PLAIN);
    });
    act(() => result.current.stop());
    await act(async () => run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped")));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledWith({ vaultId: "notes", storage: PLAIN });
  });
});
