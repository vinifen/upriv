import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askCloseToHurry,
  parseVaultCloseHurry,
  parseVaultCloseState,
  waitForClose,
  type VaultCloseState,
} from "../closePhase";

const flush: VaultCloseState = { state: "closing", phase: "flush" };
const backup: VaultCloseState = { state: "closing", phase: "backup" };

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

describe("parseVaultCloseState", () => {
  it("reads open, closing at its step, and closed", () => {
    expect(parseVaultCloseState({ state: "open", phase: null })).toEqual({ state: "open" });
    expect(parseVaultCloseState({ state: "closing", phase: "flush" })).toEqual(flush);
    expect(parseVaultCloseState({ state: "closing", phase: "backup" })).toEqual(backup);
    expect(parseVaultCloseState({ state: "closed", phase: null })).toEqual({ state: "closed" });
  });

  it("refuses anything else", () => {
    expect(parseVaultCloseState({ state: "closing", phase: null })).toBeNull();
    expect(parseVaultCloseState({ state: "closing", phase: "other" })).toBeNull();
    expect(parseVaultCloseState({ phase: "flush" })).toBeNull();
    expect(parseVaultCloseState(null)).toBeNull();
  });
});

describe("waitForClose", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports backup once, then stops asking", async () => {
    const work = deferred<string>();
    const answers: (VaultCloseState | null)[] = [flush, backup];
    const readProgress = vi.fn(async () => answers.shift() ?? backup);
    const onBackup = vi.fn();

    const watched = waitForClose(work.promise, readProgress, { onBackup }, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBackup).not.toHaveBeenCalled();
    expect(readProgress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(onBackup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(readProgress).toHaveBeenCalledTimes(2);

    work.resolve("closed");
    await expect(watched).resolves.toBe("closed");
  });

  it("does not report backup after the close settled", async () => {
    const work = deferred<void>();
    const answer = deferred<VaultCloseState | null>();
    const onBackup = vi.fn();

    const watched = waitForClose(work.promise, () => answer.promise, { onBackup }, 100);
    await vi.advanceTimersByTimeAsync(100);
    work.resolve();
    await watched;
    answer.resolve(backup);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBackup).not.toHaveBeenCalled();
  });

  it("retries a read failure and still reports backup", async () => {
    const work = deferred<number>();
    let calls = 0;
    const readProgress = vi.fn(async (): Promise<VaultCloseState | null> => {
      calls += 1;
      if (calls === 1) throw new Error("unknown method");
      return backup;
    });
    const onBackup = vi.fn();

    const watched = waitForClose(work.promise, readProgress, { onBackup }, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBackup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onBackup).toHaveBeenCalledTimes(1);
    work.resolve(7);
    await expect(watched).resolves.toBe(7);
  });

  it("propagates the close error", async () => {
    const work = deferred<void>();
    const watched = waitForClose(work.promise, async () => null, { onBackup: vi.fn() }, 100);
    work.reject(new Error("flush failed"));
    await expect(watched).rejects.toThrow("flush failed");
  });

  it("has no time limit: a close that takes a day still resolves", async () => {
    const work = deferred<string>();
    const watched = waitForClose(work.promise, async () => flush, { onBackup: vi.fn() }, 1_000);
    let ended = false;
    void watched.then(
      () => (ended = true),
      () => (ended = true),
    );
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(ended).toBe(false);
    work.resolve("closed");
    await expect(watched).resolves.toBe("closed");
  });
});
