import { describe, expect, it } from "vitest";
import {
  applyIdleActivity,
  capIdleTimerMs,
  decideIdleAutoClose,
  IDLE_AUTO_CLOSE_MAX_TIMER_MS,
  IDLE_AUTO_CLOSE_MINUTES_MAX,
  idleLimitMs,
  idleWarningText,
  planIdleAutoClose,
  restartIdleClock,
  shiftIdleClocksForWake,
  syncIdleClocks,
  type IdleVaultClock,
} from "../idleAutoClose";

const MINUTE = 60_000;

function clock(overrides: Partial<IdleVaultClock> = {}): IdleVaultClock {
  return {
    id: "notes",
    enabled: true,
    idleMinutes: 15,
    lastActivityAtMs: 0,
    warned: false,
    ...overrides,
  };
}

describe("decideIdleAutoClose", () => {
  it("locks when the vault's own minutes have passed", () => {
    expect(
      decideIdleAutoClose({ nowMs: 15 * MINUTE - 1, lastActivityAtMs: 0, idleMinutes: 15 }).action,
    ).toBe("wait");
    expect(
      decideIdleAutoClose({ nowMs: 15 * MINUTE, lastActivityAtMs: 0, idleMinutes: 15 }).action,
    ).toBe("lock");
  });

  it("locks after a clock jump that skipped the deadline", () => {
    expect(
      decideIdleAutoClose({ nowMs: 60 * MINUTE, lastActivityAtMs: 0, idleMinutes: 15 }).action,
    ).toBe("lock");
  });

  it("waits when the device clock steps backward", () => {
    const decision = decideIdleAutoClose({
      nowMs: -5_000,
      lastActivityAtMs: 0,
      idleMinutes: 15,
    });
    expect(decision.action).toBe("wait");
    if (decision.action === "wait") expect(decision.nextWakeAtMs).toBe(15 * MINUTE);
  });

  it("clamps an idle below 1 minute instead of locking immediately", () => {
    const decision = decideIdleAutoClose({ nowMs: 0, lastActivityAtMs: 0, idleMinutes: 0 });
    expect(decision.action).toBe("wait");
    if (decision.action === "wait") expect(decision.nextWakeAtMs).toBe(MINUTE);
  });

  it("caps a huge idle at 1440 minutes instead of locking on the next turn", () => {
    const decision = decideIdleAutoClose({
      nowMs: 0,
      lastActivityAtMs: 0,
      idleMinutes: 35_792,
    });
    expect(decision.action).toBe("wait");
    if (decision.action === "wait") {
      expect(decision.nextWakeAtMs).toBe(IDLE_AUTO_CLOSE_MINUTES_MAX * MINUTE);
    }
    expect(idleLimitMs(35_792)).toBe(IDLE_AUTO_CLOSE_MINUTES_MAX * MINUTE);
    expect(idleLimitMs(IDLE_AUTO_CLOSE_MINUTES_MAX)).toBe(IDLE_AUTO_CLOSE_MINUTES_MAX * MINUTE);
  });
});

describe("capIdleTimerMs", () => {
  it("keeps a scheduled delay inside a signed 32-bit integer", () => {
    expect(capIdleTimerMs(3_000_000_000)).toBe(IDLE_AUTO_CLOSE_MAX_TIMER_MS);
    expect(capIdleTimerMs(IDLE_AUTO_CLOSE_MINUTES_MAX * MINUTE)).toBe(
      IDLE_AUTO_CLOSE_MINUTES_MAX * MINUTE,
    );
    expect(capIdleTimerMs(0)).toBe(0);
  });
});

describe("syncIdleClocks", () => {
  it("starts a newly seen vault at the current time and keeps an existing deadline", () => {
    const synced = syncIdleClocks(
      5_000,
      [clock({ lastActivityAtMs: 1_000 })],
      [
        { id: "notes", enabled: true, idleMinutes: 15 },
        { id: "tax", enabled: true, idleMinutes: 30 },
      ],
    );
    expect(synced).toEqual([
      clock({ lastActivityAtMs: 1_000 }),
      clock({ id: "tax", idleMinutes: 30, lastActivityAtMs: 5_000 }),
    ]);
  });

  it("keeps the deadline when the idle minutes change", () => {
    const synced = syncIdleClocks(
      5_000,
      [clock({ lastActivityAtMs: 1_000, idleMinutes: 15 })],
      [{ id: "notes", enabled: true, idleMinutes: 60 }],
    );
    expect(synced[0]).toMatchObject({ idleMinutes: 60, lastActivityAtMs: 1_000 });
  });

  it("drops a vault that disabled idle lock or closed", () => {
    const synced = syncIdleClocks(
      5_000,
      [clock(), clock({ id: "tax" })],
      [{ id: "notes", enabled: false, idleMinutes: 15 }],
    );
    expect(synced).toEqual([]);
  });
});

describe("applyIdleActivity", () => {
  it("resets a vault that is still inside its idle time", () => {
    const [next] = applyIdleActivity(1_000, [clock({ warned: true })]);
    expect(next?.lastActivityAtMs).toBe(1_000);
    expect(next?.warned).toBe(false);
  });

  it("keeps the deadline of a vault the clock already marked due", () => {
    const due = clock({ idleMinutes: 15 });
    const fresh = clock({ id: "tax", lastActivityAtMs: 20 * MINUTE });
    const next = applyIdleActivity(20 * MINUTE, [due, fresh]);
    expect(next[0]?.lastActivityAtMs).toBe(0);
    expect(next[1]?.lastActivityAtMs).toBe(20 * MINUTE);
  });
});

describe("shiftIdleClocksForWake", () => {
  it("ignores time the app was not running when that vault was not yet due", () => {
    const [next] = shiftIdleClocksForWake([clock({ lastActivityAtMs: 0 })], 1_000, 60 * MINUTE);
    expect(next?.lastActivityAtMs).toBe(60 * MINUTE - 1_000);
    expect(
      decideIdleAutoClose({
        nowMs: 60 * MINUTE,
        lastActivityAtMs: next?.lastActivityAtMs ?? 0,
        idleMinutes: 15,
      }).action,
    ).toBe("wait");
  });

  it("keeps a mark recorded during the pause at wake instead of past it", () => {
    const [next] = shiftIdleClocksForWake(
      [clock({ lastActivityAtMs: 30 * MINUTE, idleMinutes: 15 })],
      10 * MINUTE,
      40 * MINUTE,
    );
    expect(next?.lastActivityAtMs).toBe(40 * MINUTE);
    expect(
      decideIdleAutoClose({
        nowMs: 40 * MINUTE,
        lastActivityAtMs: next?.lastActivityAtMs ?? 0,
        idleMinutes: 15,
      }).action,
    ).toBe("wait");
  });

  it("keeps a vault that was already due when the pause began", () => {
    const [next] = shiftIdleClocksForWake(
      [clock({ lastActivityAtMs: 0, idleMinutes: 15 })],
      20 * MINUTE,
      80 * MINUTE,
    );
    expect(next?.lastActivityAtMs).toBe(0);
  });
});

describe("restartIdleClock", () => {
  it("starts one vault over and leaves the others on their deadline", () => {
    const next = restartIdleClock(
      [clock({ id: "due" }), clock({ id: "other", lastActivityAtMs: 10 })],
      "due",
      5_000,
    );
    expect(next[0]?.lastActivityAtMs).toBe(5_000);
    expect(next[1]?.lastActivityAtMs).toBe(10);
  });
});

describe("planIdleAutoClose", () => {
  it("locks every due vault and wakes for the soonest of the rest", () => {
    const plan = planIdleAutoClose(15 * MINUTE, [
      clock({ id: "due", idleMinutes: 15 }),
      clock({ id: "later", lastActivityAtMs: MINUTE, idleMinutes: 30 }),
    ]);
    expect(plan.lockIds).toEqual(["due"]);
    expect(plan.warns).toEqual([]);
    expect(plan.nextWakeAtMs).toBe(MINUTE + 30 * MINUTE - 60_000);
  });

  it("has no wake when every vault is ready to lock", () => {
    const plan = planIdleAutoClose(15 * MINUTE, [clock(), clock({ id: "tax" })]);
    expect(plan.lockIds).toEqual(["notes", "tax"]);
    expect(plan.warns).toEqual([]);
    expect(plan.nextWakeAtMs).toBeNull();
  });

  it("warns halfway through a 1-minute idle, not when the clock has just started", () => {
    const justActed = planIdleAutoClose(0, [clock({ idleMinutes: 1, lastActivityAtMs: 0 })]);
    expect(justActed.lockIds).toEqual([]);
    expect(justActed.warns).toEqual([]);
    expect(justActed.nextWakeAtMs).toBe(30_000);

    const due = planIdleAutoClose(30_000, [clock({ idleMinutes: 1, lastActivityAtMs: 0 })]);
    expect(due.warns).toEqual([{ id: "notes", secondsLeft: 30 }]);
    expect(due.nextWakeAtMs).toBe(60_000);
  });

  it("warns once, 60 seconds before the lock, and skips a clock jump past the deadline", () => {
    const early = planIdleAutoClose(14 * MINUTE - 1_000, [clock()]);
    expect(early.lockIds).toEqual([]);
    expect(early.warns).toEqual([]);
    expect(early.nextWakeAtMs).toBe(14 * MINUTE);

    const due = planIdleAutoClose(14 * MINUTE, [clock()]);
    expect(due.warns).toEqual([{ id: "notes", secondsLeft: 60 }]);
    expect(due.nextWakeAtMs).toBe(15 * MINUTE);

    const again = planIdleAutoClose(14 * MINUTE + 1_000, [clock({ warned: true })]);
    expect(again.warns).toEqual([]);

    const jumped = planIdleAutoClose(60 * MINUTE, [clock()]);
    expect(jumped.lockIds).toEqual(["notes"]);
    expect(jumped.warns).toEqual([]);
  });

  it("puts several vaults into one notice, grouped by the time they have left", () => {
    const text = idleWarningText(
      [
        { id: "notes", secondsLeft: 60 },
        { id: "tax", secondsLeft: 60 },
        { id: "photos", secondsLeft: 30 },
      ],
      (id) => id,
      (name, seconds) => `${name} in ${seconds}`,
    );
    expect(text).toBe("notes, tax in 60 photos in 30");
  });
});
