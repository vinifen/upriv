/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VAULT_ROOT_PATH_CHECK_DELAY_MS,
  type BackupFolderStatus,
  type BackupService,
} from "@upriv/shared";
import { useBackupFolderCheck } from "@upriv/shared/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function serviceChecking(checkFolder: BackupService["checkFolder"]): BackupService {
  return { checkFolder } as BackupService;
}

async function passDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(VAULT_ROOT_PATH_CHECK_DELAY_MS);
  });
}

describe("useBackupFolderCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has nothing to check for an empty path", async () => {
    const checkFolder = vi.fn<BackupService["checkFolder"]>(async () => "ok");
    const { result } = renderHook(() =>
      useBackupFolderCheck(serviceChecking(checkFolder), "   ", null),
    );
    await passDelay();
    expect(checkFolder).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
    expect(result.current.checking).toBe(false);
  });

  it("reads checking from the first key, and asks once the typing stops", async () => {
    const checkFolder = vi.fn<BackupService["checkFolder"]>(async () => "no_room");
    const service = serviceChecking(checkFolder);
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useBackupFolderCheck(service, path, "notes"),
      { initialProps: { path: "/mnt/u" } },
    );
    expect(result.current.checking).toBe(true);

    rerender({ path: " /mnt/usb " });
    await passDelay();

    expect(checkFolder).toHaveBeenCalledTimes(1);
    expect(checkFolder).toHaveBeenCalledWith("/mnt/usb", "notes");
    expect(result.current.status).toBe("no_room");
    expect(result.current.checking).toBe(false);
  });

  it("drops a late answer for an earlier path", async () => {
    const first = deferred<BackupFolderStatus>();
    const second = deferred<BackupFolderStatus>();
    const checkFolder = vi.fn<BackupService["checkFolder"]>((path) =>
      path === "/mnt/a" ? first.promise : second.promise,
    );
    const service = serviceChecking(checkFolder);
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useBackupFolderCheck(service, path, null),
      { initialProps: { path: "/mnt/a" } },
    );
    await passDelay();
    rerender({ path: "/mnt/b" });
    await passDelay();

    await act(async () => {
      second.resolve("ok");
    });
    await act(async () => {
      first.resolve("missing");
    });
    expect(result.current.status).toBe("ok");
  });

  it("shows a check that failed as other", async () => {
    const service = serviceChecking(async () => Promise.reject(new Error("io")));
    const { result } = renderHook(() => useBackupFolderCheck(service, "/mnt/usb", null));
    await passDelay();
    expect(result.current.status).toBe("other");
    expect(result.current.checking).toBe(false);
  });

  it("asks again on retry", async () => {
    const answers: BackupFolderStatus[] = ["missing", "ok"];
    const checkFolder = vi.fn<BackupService["checkFolder"]>(async () => answers.shift() ?? "other");
    const service = serviceChecking(checkFolder);
    const { result } = renderHook(() => useBackupFolderCheck(service, "/mnt/usb", null));
    await passDelay();
    expect(result.current.status).toBe("missing");

    act(() => result.current.retry());
    expect(result.current.checking).toBe(true);
    await passDelay();
    expect(result.current.status).toBe("ok");
    expect(checkFolder).toHaveBeenCalledTimes(2);
  });
});
