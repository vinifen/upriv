/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  JOB_ERROR_CODES,
  RpcError,
  type JobService,
  type VaultSecurityService,
} from "@upriv/shared";
import { useVaultRewrapJob, type VaultRewrapJobEvents } from "@upriv/shared/react";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function jobs(): JobService & { cancel: ReturnType<typeof vi.fn> } {
  return { status: async () => null, cancel: vi.fn(async () => undefined) };
}

function events() {
  return {
    onChanged: vi.fn(),
    onFailed: vi.fn(),
    onCancelled: vi.fn(),
    onStopRefused: vi.fn(),
  } satisfies VaultRewrapJobEvents;
}

describe("useVaultRewrapJob", () => {
  it("sends the password change as a job and reports it changed", async () => {
    const run = deferred();
    const security: VaultSecurityService = {
      changePassword: vi.fn(() => run.promise),
      changeKdfPreset: vi.fn(),
    };
    const on = events();
    const { result } = renderHook(() => useVaultRewrapJob(security, jobs(), on));

    act(() => {
      expect(result.current.changePassword("notes", "old", "new")).toBe(true);
    });
    const job = result.current.job;
    expect(job).toMatchObject({ vaultId: "notes", kind: "password", nextPreset: null });
    expect(security.changePassword).toHaveBeenCalledWith("notes", {
      currentPassword: "old",
      newPassword: "new",
      job: job?.id,
    });

    await act(async () => run.resolve());
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onChanged).toHaveBeenCalledWith({
      vaultId: "notes",
      kind: "password",
      nextPreset: null,
    });
  });

  it("refuses a second change while one runs", () => {
    const security: VaultSecurityService = {
      changePassword: vi.fn(() => new Promise<void>(() => undefined)),
      changeKdfPreset: vi.fn(() => new Promise<void>(() => undefined)),
    };
    const { result } = renderHook(() => useVaultRewrapJob(security, jobs(), events()));

    act(() => {
      expect(result.current.changePassword("notes", "old", "new")).toBe(true);
    });
    act(() => {
      expect(result.current.changeKdf("other", "pw", "1gib")).toBe(false);
    });
    expect(security.changeKdfPreset).not.toHaveBeenCalled();
  });

  it("stops through job_cancel and reports a stop, not a failure", async () => {
    const run = deferred();
    const security: VaultSecurityService = {
      changePassword: vi.fn(),
      changeKdfPreset: vi.fn(() => run.promise),
    };
    const service = jobs();
    const on = events();
    const { result } = renderHook(() => useVaultRewrapJob(security, service, on));

    act(() => {
      result.current.changeKdf("notes", "pw", "1gib");
    });
    const id = result.current.job?.id;
    act(() => result.current.stop());
    expect(service.cancel).toHaveBeenCalledWith(id, "user");
    expect(result.current.job?.stoppingSince).not.toBeNull();

    await act(async () => run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped")));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledWith({
      vaultId: "notes",
      kind: "kdf",
      nextPreset: "1gib",
    });
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("keeps running when core refuses the stop in the header write", async () => {
    const security: VaultSecurityService = {
      changePassword: vi.fn(() => new Promise<void>(() => undefined)),
      changeKdfPreset: vi.fn(),
    };
    const refused = new RpcError(JOB_ERROR_CODES.NOT_STOPPABLE, "finishing");
    const service = jobs();
    service.cancel.mockRejectedValueOnce(refused);
    const on = events();
    const { result } = renderHook(() => useVaultRewrapJob(security, service, on));

    act(() => {
      result.current.changePassword("notes", "old", "new");
    });
    act(() => result.current.stop());
    await waitFor(() => expect(on.onStopRefused).toHaveBeenCalled());
    expect(on.onStopRefused.mock.calls[0]?.[0]).toBe(refused);
    expect(result.current.job?.stoppingSince).toBeNull();
  });
});
