import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRpcTimeout } from "../../core-rpc/errors";
import { SIZED_WORK, sizedBudgetMs } from "../../loading/sizedBudget";
import {
  askCloseToHurry,
  parseVaultCloseHurry,
  parseVaultCloseProgress,
  waitForClose,
  type VaultCloseProgress,
} from "../closePhase";

const flush: VaultCloseProgress = { phase: "flush", backupBytesTotal: 0 };
const backupUnmeasured: VaultCloseProgress = { phase: "backup", backupBytesTotal: 0 };
const backupMeasured: VaultCloseProgress = { phase: "backup", backupBytesTotal: 4096 };

describe("parseVaultCloseHurry", () => {
  it("is true only when a running close heard it", () => {
    expect(parseVaultCloseHurry({ running: true })).toBe(true);
    expect(parseVaultCloseHurry({ running: false })).toBe(false);
    expect(parseVaultCloseHurry(null)).toBe(false);
  });
});

describe("askCloseToHurry", () => {
  it("stops once a running close hears it", async () => {
    const hurry = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    await askCloseToHurry(hurry, () => true, 0);
    expect(hurry).toHaveBeenCalledTimes(1);
  });

  it("asks again while the close has not started, and a failed call is not heard", async () => {
    const hurry = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("rpc"))
      .mockResolvedValueOnce(true);
    await askCloseToHurry(hurry, () => true, 0);
    expect(hurry).toHaveBeenCalledTimes(3);
  });

  it("gives up when it is no longer wanted", async () => {
    const hurry = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    let wanted = true;
    hurry.mockImplementationOnce(async () => {
      wanted = false;
      return false;
    });
    await askCloseToHurry(hurry, () => wanted, 0);
    expect(hurry).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("parseVaultCloseProgress", () => {
  it("accepts known phases only", () => {
    expect(parseVaultCloseProgress({ phase: "flush" })).toEqual(flush);
    expect(parseVaultCloseProgress({ phase: "backup", backupBytesTotal: 4096 })).toEqual(
      backupMeasured,
    );
    expect(parseVaultCloseProgress({ phase: null })).toBeNull();
    expect(parseVaultCloseProgress({ phase: "other" })).toBeNull();
    expect(parseVaultCloseProgress(null)).toBeNull();
  });

  it("reads a missing or broken backup size as not measured", () => {
    for (const backupBytesTotal of [undefined, -1, Number.NaN, "4096"]) {
      expect(parseVaultCloseProgress({ phase: "backup", backupBytesTotal })).toEqual(
        backupUnmeasured,
      );
    }
  });
});

describe("waitForClose", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const watchers = () => ({ onBackup: vi.fn(), onMeasured: vi.fn() });

  it("reports backup and its size once each, then stops asking", async () => {
    const work = deferred<string>();
    const answers: (VaultCloseProgress | null)[] = [flush, backupUnmeasured, backupMeasured];
    const readProgress = vi.fn(async () => answers.shift() ?? backupMeasured);
    const events = watchers();

    const watched = waitForClose(work.promise, readProgress, events, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.onBackup).not.toHaveBeenCalled();
    expect(readProgress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(events.onBackup).toHaveBeenCalledTimes(1);
    expect(events.onMeasured).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(events.onMeasured).toHaveBeenCalledWith(4096);
    await vi.advanceTimersByTimeAsync(500);
    expect(readProgress).toHaveBeenCalledTimes(3);
    expect(events.onBackup).toHaveBeenCalledTimes(1);

    work.resolve("closed");
    await expect(watched).resolves.toBe("closed");
  });

  it("does not report backup after the close settled", async () => {
    const work = deferred<void>();
    const answer = deferred<VaultCloseProgress | null>();
    const events = watchers();

    const watched = waitForClose(work.promise, () => answer.promise, events, 100);
    await vi.advanceTimersByTimeAsync(100);
    work.resolve();
    await watched;
    answer.resolve(backupMeasured);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.onBackup).not.toHaveBeenCalled();
    expect(events.onMeasured).not.toHaveBeenCalled();
  });

  it("retries a read failure and still reports backup", async () => {
    const work = deferred<number>();
    let calls = 0;
    const readProgress = vi.fn(async (): Promise<VaultCloseProgress | null> => {
      calls += 1;
      if (calls === 1) throw new Error("unknown method");
      return backupMeasured;
    });
    const events = watchers();

    const watched = waitForClose(work.promise, readProgress, events, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.onBackup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(events.onBackup).toHaveBeenCalledTimes(1);
    expect(events.onMeasured).toHaveBeenCalledWith(4096);
    work.resolve(7);
    await expect(watched).resolves.toBe(7);
  });

  it("propagates the close error", async () => {
    const work = deferred<void>();
    const watched = waitForClose(work.promise, async () => null, watchers(), 100);
    work.reject(new Error("flush failed"));
    await expect(watched).rejects.toThrow("flush failed");
  });

  it("gives up at the floor while the backup is never measured", async () => {
    const work = deferred<void>();
    const watched = waitForClose(work.promise, async () => flush, watchers(), 100);
    const outcome = expect(watched).rejects.toSatisfy(isRpcTimeout);
    await vi.advanceTimersByTimeAsync(SIZED_WORK.vaultClose.floorMs);
    await outcome;
  });

  it("waits as long as the measured backup needs, then gives up", async () => {
    const bytes = 8 * 1024 * 1024 * 1024;
    const work = deferred<string>();
    const big: VaultCloseProgress = { phase: "backup", backupBytesTotal: bytes };
    const events = watchers();
    const watched = waitForClose(work.promise, async () => big, events, 100);
    let ended = false;
    watched.then(
      () => (ended = true),
      () => (ended = true),
    );

    await vi.advanceTimersByTimeAsync(SIZED_WORK.vaultClose.floorMs);
    expect(events.onMeasured).toHaveBeenCalledWith(bytes);
    expect(ended).toBe(false);

    const outcome = expect(watched).rejects.toSatisfy(isRpcTimeout);
    await vi.advanceTimersByTimeAsync(sizedBudgetMs("vaultClose", bytes));
    await outcome;
  });

  it("keeps a close that answers just before its grown budget", async () => {
    const bytes = 8 * 1024 * 1024 * 1024;
    const work = deferred<string>();
    const big: VaultCloseProgress = { phase: "backup", backupBytesTotal: bytes };
    const watched = waitForClose(work.promise, async () => big, watchers(), 100);
    await vi.advanceTimersByTimeAsync(sizedBudgetMs("vaultClose", bytes) - 1_000);
    work.resolve("closed");
    await expect(watched).resolves.toBe("closed");
  });
});
