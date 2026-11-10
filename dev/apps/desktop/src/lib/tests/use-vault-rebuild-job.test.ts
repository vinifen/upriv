/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  JOB_ERROR_CODES,
  RpcError,
  VAULT_ERROR_CODES,
  vaultRebuildSpaceShort,
  type JobService,
  type VaultRebuildResult,
  type VaultSecurityService,
} from "@upriv/shared";
import { useVaultRebuildJob, type VaultRebuildJobEvents } from "@upriv/shared/react";

function deferred() {
  let resolve!: (result: VaultRebuildResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<VaultRebuildResult>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function jobs(): JobService & { cancel: ReturnType<typeof vi.fn> } {
  return { status: async () => null, cancel: vi.fn(async () => undefined) };
}

function security(rebuildIndex: VaultSecurityService["rebuildIndex"]): VaultSecurityService {
  return { changePassword: vi.fn(), changeKdfPreset: vi.fn(), rebuildIndex };
}

function events() {
  return {
    onRebuilt: vi.fn(),
    onFailed: vi.fn(),
    onCancelled: vi.fn(),
    onStopRefused: vi.fn(),
  } satisfies VaultRebuildJobEvents;
}

describe("useVaultRebuildJob", () => {
  it("sends the rebuild as a job with the typed password and reports what came back", async () => {
    const run = deferred();
    const service = security(vi.fn(() => run.promise));
    const on = events();
    const { result } = renderHook(() => useVaultRebuildJob(service, jobs(), on));

    act(() => {
      expect(result.current.rebuild("notes", "pass-word-ok")).toBe(true);
    });
    const job = result.current.job;
    expect(job).toMatchObject({ vaultId: "notes" });
    expect(service.rebuildIndex).toHaveBeenCalledWith("notes", {
      password: "pass-word-ok",
      job: job?.id,
    });

    await act(async () => run.resolve({ files: 12, setAside: 1 }));
    await waitFor(() => expect(result.current.job).toBeNull());
    // The password comes back once, to open the vault, and is not kept.
    expect(on.onRebuilt).toHaveBeenCalledWith(
      { files: 12, setAside: 1 },
      { vaultId: "notes" },
      "pass-word-ok",
    );
    const second = deferred();
    vi.mocked(service.rebuildIndex).mockImplementationOnce(() => second.promise);
    act(() => {
      result.current.rebuild("notes", "another-password");
    });
    await act(async () => second.reject(new RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD, "no")));
    await waitFor(() => expect(on.onFailed).toHaveBeenCalled());
    expect(on.onRebuilt).toHaveBeenCalledTimes(1);
  });

  it("refuses a second rebuild while one runs", () => {
    const service = security(vi.fn(() => new Promise<VaultRebuildResult>(() => undefined)));
    const { result } = renderHook(() => useVaultRebuildJob(service, jobs(), events()));

    act(() => {
      expect(result.current.rebuild("notes", "pw")).toBe(true);
    });
    act(() => {
      expect(result.current.rebuild("other", "pw")).toBe(false);
    });
    expect(service.rebuildIndex).toHaveBeenCalledTimes(1);
  });

  it("stops through job_cancel and reports a stop, not a failure", async () => {
    const run = deferred();
    const service = jobs();
    const on = events();
    const { result } = renderHook(() =>
      useVaultRebuildJob(security(vi.fn(() => run.promise)), service, on),
    );

    act(() => {
      result.current.rebuild("notes", "pw");
    });
    const id = result.current.job?.id;
    act(() => result.current.stop());
    expect(service.cancel).toHaveBeenCalledWith(id, "user");

    await act(async () => run.reject(new RpcError(JOB_ERROR_CODES.CANCELLED, "stopped")));
    await waitFor(() => expect(result.current.job).toBeNull());
    expect(on.onCancelled).toHaveBeenCalledWith({ vaultId: "notes" });
    expect(on.onFailed).not.toHaveBeenCalled();
  });

  it("hands a refusal for want of room to the failure, with its sizes", async () => {
    const run = deferred();
    const on = events();
    const { result } = renderHook(() =>
      useVaultRebuildJob(security(vi.fn(() => run.promise)), jobs(), on),
    );

    act(() => {
      result.current.rebuild("notes", "pw");
    });
    const short = new RpcError(VAULT_ERROR_CODES.REBUILD_SPACE_SHORT, "no room", {
      needed: 4096,
      available: 1024,
    });
    await act(async () => run.reject(short));
    await waitFor(() => expect(on.onFailed).toHaveBeenCalled());
    expect(vaultRebuildSpaceShort(on.onFailed.mock.calls[0]?.[0])).toEqual({
      needed: 4096,
      available: 1024,
    });
    expect(vaultRebuildSpaceShort(new RpcError(VAULT_ERROR_CODES.WRONG_PASSWORD, "no"))).toBeNull();
  });
});
