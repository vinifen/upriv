import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseVaultClosePhase, watchClosePhase, type VaultClosePhase } from "../closePhase";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("parseVaultClosePhase", () => {
  it("accepts known phases only", () => {
    expect(parseVaultClosePhase({ phase: "flush" })).toBe("flush");
    expect(parseVaultClosePhase({ phase: "backup" })).toBe("backup");
    expect(parseVaultClosePhase({ phase: null })).toBeNull();
    expect(parseVaultClosePhase({ phase: "other" })).toBeNull();
    expect(parseVaultClosePhase(null)).toBeNull();
  });
});

describe("watchClosePhase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports backup once when core enters the backup phase", async () => {
    const work = deferred<string>();
    const phases: (VaultClosePhase | null)[] = ["flush", "backup", "backup"];
    const readPhase = vi.fn(async () => phases.shift() ?? null);
    const onBackup = vi.fn();

    const watched = watchClosePhase(work.promise, readPhase, onBackup, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBackup).not.toHaveBeenCalled();
    expect(readPhase).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(onBackup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(readPhase).toHaveBeenCalledTimes(2);

    work.resolve("closed");
    await expect(watched).resolves.toBe("closed");
  });

  it("does not report backup after the close settled", async () => {
    const work = deferred<void>();
    const phase = deferred<VaultClosePhase | null>();
    const onBackup = vi.fn();

    const watched = watchClosePhase(work.promise, () => phase.promise, onBackup, 100);
    await vi.advanceTimersByTimeAsync(100);
    work.resolve();
    await watched;
    phase.resolve("backup");
    await vi.advanceTimersByTimeAsync(0);
    expect(onBackup).not.toHaveBeenCalled();
  });

  it("retries a read failure and still reports backup", async () => {
    const work = deferred<number>();
    let calls = 0;
    const readPhase = vi.fn(async (): Promise<VaultClosePhase | null> => {
      calls += 1;
      if (calls === 1) throw new Error("unknown method");
      return "backup";
    });
    const onBackup = vi.fn();

    const watched = watchClosePhase(work.promise, readPhase, onBackup, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBackup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onBackup).toHaveBeenCalledTimes(1);
    work.resolve(7);
    await expect(watched).resolves.toBe(7);
  });

  it("propagates the close error", async () => {
    const work = deferred<void>();
    const watched = watchClosePhase(work.promise, async () => null, vi.fn(), 100);
    work.reject(new Error("flush failed"));
    await expect(watched).rejects.toThrow("flush failed");
  });
});
