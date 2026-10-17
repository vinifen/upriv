/**
 * Idle lock shared by desktop and mobile.
 *
 * Idle is the device time since the last action inside Upriv. There is no
 * separate detector: when a vault's own minutes have passed, that vault closes.
 * Sleep and time away count unless the app is set to keep vaults open on wake.
 * Returning to the app is not activity. A vault that is already due keeps its
 * deadline. An `upriv_plain` session uses this same plan; the lock is the
 * normal close (wipe included), not the manual wipe confirm.
 */

/**
 * One notice this long before an idle lock, when idle is longer than this.
 * Fixed; not a vault setting.
 */
export const IDLE_AUTO_CLOSE_WARN_SECONDS = 60;

/** Settings control and the idle clock share this range. */
export const IDLE_AUTO_CLOSE_MINUTES_MIN = 1;
export const IDLE_AUTO_CLOSE_MINUTES_MAX = 1440;

/**
 * Browser timers store the delay in a signed 32-bit integer.
 * A larger delay overflows and fires on the next turn.
 */
export const IDLE_AUTO_CLOSE_MAX_TIMER_MS = 2_147_483_647;

const WARN_LEAD_MS = IDLE_AUTO_CLOSE_WARN_SECONDS * 1000;

export interface IdleAutoCloseTarget {
  id: string;
  enabled: boolean;
  idleMinutes: number;
}

export interface IdleVaultClock extends IdleAutoCloseTarget {
  lastActivityAtMs: number;
  /** This idle period already showed its one notice. */
  warned: boolean;
}

export interface IdleAutoCloseWarning {
  id: string;
  secondsLeft: number;
}

export type IdleAutoCloseDecision = { action: "wait"; nextWakeAtMs: number } | { action: "lock" };

export interface IdleAutoClosePlan {
  lockIds: string[];
  /** Vaults that just entered their warning window. One notice for the whole list. */
  warns: IdleAutoCloseWarning[];
  /** Next device time a waiting vault should be checked. Null when nothing is waiting. */
  nextWakeAtMs: number | null;
}

export type IdleLockResult = "started" | "wait" | "abort";

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function enteredWarnWindow(nowMs: number, clock: IdleVaultClock): boolean {
  const decision = decideIdleAutoClose({
    nowMs,
    lastActivityAtMs: clock.lastActivityAtMs,
    idleMinutes: clock.idleMinutes,
  });
  const leadMs = idleWarnLeadMs(clock.idleMinutes);
  return decision.action === "wait" && nowMs >= decision.nextWakeAtMs - leadMs;
}

/**
 * One sentence per remaining time, so several vaults share a single toast
 * instead of covering each other.
 */
export function idleWarningText(
  warnings: readonly IdleAutoCloseWarning[],
  nameOf: (id: string) => string,
  line: (name: string, secondsLeft: number) => string,
): string {
  const bySeconds = new Map<number, string[]>();
  for (const warning of warnings) {
    const names = bySeconds.get(warning.secondsLeft) ?? [];
    names.push(nameOf(warning.id));
    bySeconds.set(warning.secondsLeft, names);
  }
  return [...bySeconds.entries()]
    .map(([secondsLeft, names]) => line(names.join(", "), secondsLeft))
    .join(" ");
}

/** Idle outside 1..=1440 minutes is clamped so a bad config cannot lock immediately. */
export function idleLimitMs(idleMinutes: number): number | null {
  if (!finite(idleMinutes)) return null;
  const minutes = Math.min(
    IDLE_AUTO_CLOSE_MINUTES_MAX,
    Math.max(IDLE_AUTO_CLOSE_MINUTES_MIN, Math.floor(idleMinutes)),
  );
  return minutes * 60_000;
}

/** Keep one `setTimeout` delay inside a signed 32-bit integer. */
export function capIdleTimerMs(delayMs: number): number {
  if (!finite(delayMs) || delayMs <= 0) return 0;
  return Math.min(Math.floor(delayMs), IDLE_AUTO_CLOSE_MAX_TIMER_MS);
}

/**
 * How long before the lock the one notice appears.
 * A 1-minute idle is the whole 60-second window, so that notice would show on
 * every action. The minimum warns halfway through the minute.
 */
export function idleWarnLeadMs(idleMinutes: number): number {
  const limitMs = idleLimitMs(idleMinutes);
  if (limitMs == null || limitMs > WARN_LEAD_MS) return WARN_LEAD_MS;
  return Math.floor(limitMs / 2);
}

export function idleWarnLeadSeconds(idleMinutes: number): number {
  return Math.max(1, Math.round(idleWarnLeadMs(idleMinutes) / 1000));
}

export function decideIdleAutoClose(input: {
  nowMs: number;
  lastActivityAtMs: number;
  idleMinutes: number;
}): IdleAutoCloseDecision {
  const limitMs = idleLimitMs(input.idleMinutes);
  if (limitMs == null || !finite(input.nowMs) || !finite(input.lastActivityAtMs)) {
    const fallback = finite(input.nowMs) ? input.nowMs + 60_000 : 60_000;
    return { action: "wait", nextWakeAtMs: fallback };
  }

  const elapsed = input.nowMs - input.lastActivityAtMs;
  const lockAtMs = input.lastActivityAtMs + limitMs;
  // The device clock stepped backward. Wait until the original deadline.
  if (elapsed < 0) return { action: "wait", nextWakeAtMs: lockAtMs };
  if (elapsed >= limitMs) return { action: "lock" };
  return { action: "wait", nextWakeAtMs: lockAtMs };
}

export function syncIdleClocks(
  nowMs: number,
  previous: readonly IdleVaultClock[],
  targets: readonly IdleAutoCloseTarget[],
): IdleVaultClock[] {
  const prevById = new Map(previous.map((clock) => [clock.id, clock]));
  const next: IdleVaultClock[] = [];
  for (const target of targets) {
    if (!target.enabled) continue;
    const existing = prevById.get(target.id);
    if (!existing) {
      next.push({ ...target, enabled: true, lastActivityAtMs: nowMs, warned: false });
      continue;
    }
    const kept = {
      ...target,
      enabled: true,
      lastActivityAtMs: existing.lastActivityAtMs,
      warned: existing.warned,
    };
    next.push({
      ...kept,
      warned: existing.warned && enteredWarnWindow(nowMs, kept),
    });
  }
  return next;
}

/** Activity resets every vault that is not already due. */
export function applyIdleActivity(
  nowMs: number,
  clocks: readonly IdleVaultClock[],
): IdleVaultClock[] {
  return clocks.map((clock) => {
    const decision = decideIdleAutoClose({
      nowMs,
      lastActivityAtMs: clock.lastActivityAtMs,
      idleMinutes: clock.idleMinutes,
    });
    if (decision.action === "lock") return clock;
    return { ...clock, lastActivityAtMs: nowMs, warned: false };
  });
}

/**
 * Time the app was not running (sleep, or a frozen phone).
 * A vault already due when the pause began keeps that deadline.
 * A mark recorded during the pause stays at wake — it is not pushed past it.
 */
export function shiftIdleClocksForWake(
  clocks: readonly IdleVaultClock[],
  pausedAtMs: number,
  resumedAtMs: number,
): IdleVaultClock[] {
  if (!finite(pausedAtMs) || !finite(resumedAtMs) || resumedAtMs <= pausedAtMs) return [...clocks];
  const frozenMs = resumedAtMs - pausedAtMs;
  return clocks.map((clock) => {
    const atPause = decideIdleAutoClose({
      nowMs: pausedAtMs,
      lastActivityAtMs: clock.lastActivityAtMs,
      idleMinutes: clock.idleMinutes,
    });
    if (atPause.action === "lock") return clock;
    let lastActivityAtMs = clock.lastActivityAtMs;
    if (lastActivityAtMs < pausedAtMs) lastActivityAtMs += frozenMs;
    else if (lastActivityAtMs < resumedAtMs) lastActivityAtMs = resumedAtMs;
    const shifted = { ...clock, lastActivityAtMs };
    return {
      ...shifted,
      warned: enteredWarnWindow(resumedAtMs, shifted) ? clock.warned : false,
    };
  });
}

/** One vault's close failed. Its count starts over; the others stay. */
export function restartIdleClock(
  clocks: readonly IdleVaultClock[],
  vaultId: string,
  nowMs: number,
): IdleVaultClock[] {
  return clocks.map((clock) =>
    clock.id === vaultId ? { ...clock, lastActivityAtMs: nowMs, warned: false } : clock,
  );
}

export function planIdleAutoClose(
  nowMs: number,
  clocks: readonly IdleVaultClock[],
): IdleAutoClosePlan {
  const lockIds: string[] = [];
  const warns: IdleAutoCloseWarning[] = [];
  let nextWakeAtMs: number | null = null;
  for (const clock of clocks) {
    if (!clock.enabled) continue;
    const decision = decideIdleAutoClose({
      nowMs,
      lastActivityAtMs: clock.lastActivityAtMs,
      idleMinutes: clock.idleMinutes,
    });
    if (decision.action === "lock") {
      lockIds.push(clock.id);
      continue;
    }
    let wakeAt = decision.nextWakeAtMs;
    if (!clock.warned) {
      const warnAt = decision.nextWakeAtMs - idleWarnLeadMs(clock.idleMinutes);
      if (nowMs >= warnAt) {
        warns.push({
          id: clock.id,
          secondsLeft: Math.max(1, Math.ceil((decision.nextWakeAtMs - nowMs) / 1000)),
        });
      } else {
        wakeAt = warnAt;
      }
    }
    if (nextWakeAtMs == null || wakeAt < nextWakeAtMs) nextWakeAtMs = wakeAt;
  }
  return { lockIds, warns, nextWakeAtMs };
}
