import { useEffect, useRef } from "react";
import {
  applyIdleActivity,
  capIdleTimerMs,
  planIdleAutoClose,
  restartIdleClock,
  resolveVaultDisplayStatus,
  shiftIdleClocksForWake,
  syncIdleClocks,
  type IdleAutoCloseTarget,
  type IdleAutoCloseWarning,
  type IdleLockResult,
  type IdleVaultClock,
  type VaultListItem,
  type VaultSettingsConfig,
} from "../domain";
import { scheduleInterval, scheduleTimeout } from "./schedule";

/** Re-read `[auto_close]` while a vault is open so a settings save takes effect. */
const IDLE_AUTO_CLOSE_SETTINGS_MS = 15_000;
/** Try again after an import, a busy pipeline, or a save that is still finishing. */
const IDLE_AUTO_CLOSE_RETRY_MS = 5_000;
/**
 * Scroll and key repeat would otherwise replan on every event, and a close
 * already running would be asked to start again for each one.
 * Every event still moves the clock. The next plan, within this window, catches up.
 */
const ACTIVITY_PLAN_MS = 1_000;

export type IdleSessionEvent = "pause" | "resume" | "check";

export interface UseIdleAutoCloseOptions {
  vaults: readonly VaultListItem[];
  /** App setting. Off: sleep and time away count. On: only time Upriv is running counts. */
  keepOpenOnWake: boolean;
  loadAutoClose: (vaultId: string) => Promise<VaultSettingsConfig["auto_close"] | null>;
  /**
   * `pause` when the computer sleeps or the phone freezes Upriv.
   * `resume` when that pause ends. `check` when the window is focused again
   * without a pause (another app on the desktop). Neither event is activity.
   */
  subscribeSession: (onSession: (event: IdleSessionEvent) => void) => () => void;
  /** Input inside Upriv. A vault that is already due keeps its deadline. */
  subscribeActivity: (onActivity: () => void) => () => void;
  onLock: (vaultId: string) => Promise<IdleLockResult>;
  /**
   * One notice for every vault that just entered its warning window.
   * Return false when another toast is still up, so this one waits instead of
   * covering it.
   */
  onWarn: (warnings: readonly IdleAutoCloseWarning[]) => boolean;
}

/**
 * Closes each opted-in vault from the device clock.
 * One vault's wait or failure does not move the others.
 */
export function useIdleAutoClose({
  vaults,
  keepOpenOnWake,
  loadAutoClose,
  subscribeSession,
  subscribeActivity,
  onLock,
  onWarn,
}: UseIdleAutoCloseOptions): {
  reportIdleCloseFailure: (vaultId: string) => void;
  scheduleIdleRetry: () => void;
} {
  const vaultsRef = useRef(vaults);
  const keepOpenRef = useRef(keepOpenOnWake);
  const loadRef = useRef(loadAutoClose);
  const onLockRef = useRef(onLock);
  const onWarnRef = useRef(onWarn);
  const subscribeSessionRef = useRef(subscribeSession);
  const subscribeActivityRef = useRef(subscribeActivity);
  vaultsRef.current = vaults;
  keepOpenRef.current = keepOpenOnWake;
  loadRef.current = loadAutoClose;
  onLockRef.current = onLock;
  onWarnRef.current = onWarn;
  subscribeSessionRef.current = subscribeSession;
  subscribeActivityRef.current = subscribeActivity;

  const clocksRef = useRef<IdleVaultClock[]>([]);
  const targetsRef = useRef<IdleAutoCloseTarget[]>([]);
  const pausedAtRef = useRef<number | null>(null);
  const cancelWakeRef = useRef<() => void>(() => {});
  const wakeAtRef = useRef<number | null>(null);
  /** Bumped when an effect cleans up so an in-flight pass cannot arm another timer. */
  const epochRef = useRef(0);
  const disposedRef = useRef(false);
  const reloadGenRef = useRef(0);
  const evaluateRef = useRef<() => void>(() => {});
  const runningRef = useRef(false);
  const againRef = useRef(false);
  /** A close deferred inside `onLock` still needs a short retry after this pass. */
  const retrySoonRef = useRef(false);
  /** One settings sweep at a time. A file read can hold the daemon past the next tick. */
  const reloadingRef = useRef(false);
  const reloadAgainRef = useRef(false);
  const lastActivityPlanAtRef = useRef(0);

  const openKey = vaults
    .filter((vault) => resolveVaultDisplayStatus(vault) === "open")
    .map((vault) => vault.id)
    .sort()
    .join("\0");

  const stopScheduledWake = () => {
    cancelWakeRef.current();
    wakeAtRef.current = null;
  };

  const scheduleWake = (delay: number | null) => {
    stopScheduledWake();
    if (delay == null || disposedRef.current) return;
    const bounded = capIdleTimerMs(delay);
    if (bounded <= 0) return;
    const epoch = epochRef.current;
    wakeAtRef.current = Date.now() + bounded;
    cancelWakeRef.current = scheduleTimeout(() => {
      if (disposedRef.current || epoch !== epochRef.current) return;
      wakeAtRef.current = null;
      evaluateRef.current();
    }, bounded);
  };

  /** Sleep / frozen time must not close a vault when that time does not count. */
  const pauseHoldsClock = () => pausedAtRef.current != null && keepOpenRef.current;

  evaluateRef.current = () => {
    if (disposedRef.current) return;
    if (runningRef.current) {
      againRef.current = true;
      return;
    }
    runningRef.current = true;
    void (async () => {
      const epoch = epochRef.current;
      const stale = () => disposedRef.current || epoch !== epochRef.current;
      try {
        do {
          if (stale()) return;
          againRef.current = false;
          const now = Date.now();
          const held = pauseHoldsClock();
          // Settings can change during the pause. Judge that read against the
          // pause start so frozen wall time does not clear a warning or start a clock.
          const clockNow = held ? (pausedAtRef.current ?? now) : now;
          clocksRef.current = syncIdleClocks(clockNow, clocksRef.current, targetsRef.current);
          if (held) {
            stopScheduledWake();
            break;
          }
          const plan = planIdleAutoClose(now, clocksRef.current);
          let blocked = false;
          for (const id of plan.lockIds) {
            if (stale()) return;
            const judgedAt = Date.now();
            clocksRef.current = syncIdleClocks(judgedAt, clocksRef.current, targetsRef.current);
            const fresh = planIdleAutoClose(judgedAt, clocksRef.current);
            if (!fresh.lockIds.includes(id)) continue;
            let result: IdleLockResult;
            try {
              result = await onLockRef.current(id);
            } catch {
              result = "abort";
            }
            if (stale()) return;
            if (result === "abort") {
              clocksRef.current = restartIdleClock(clocksRef.current, id, Date.now());
            } else if (result === "wait") {
              blocked = true;
            }
          }
          if (stale()) return;
          if (pauseHoldsClock()) {
            stopScheduledWake();
            break;
          }
          // Re-plan after the await. Another vault may have reached its deadline
          // while this pass was saving. Lock that vault before showing a notice,
          // so the notice is not replaced by the lock's own toast.
          const after = Date.now();
          const follow = planIdleAutoClose(after, clocksRef.current);
          if (follow.lockIds.some((id) => !plan.lockIds.includes(id))) {
            againRef.current = true;
          } else if (follow.warns.length > 0) {
            const shown = onWarnRef.current(follow.warns);
            if (shown) {
              const warnedIds = new Set(follow.warns.map((warning) => warning.id));
              clocksRef.current = clocksRef.current.map((clock) =>
                warnedIds.has(clock.id) ? { ...clock, warned: true } : clock,
              );
            } else {
              retrySoonRef.current = true;
            }
          }
          if (stale()) return;
          const retrySoon = blocked || retrySoonRef.current;
          retrySoonRef.current = false;
          let delay: number | null = retrySoon ? IDLE_AUTO_CLOSE_RETRY_MS : null;
          if (follow.nextWakeAtMs != null) {
            const until = follow.nextWakeAtMs - after;
            if (until > 0) delay = delay == null ? until : Math.min(delay, until);
          }
          scheduleWake(delay);
        } while (againRef.current);
      } finally {
        runningRef.current = false;
        const followUp = againRef.current && !disposedRef.current;
        againRef.current = false;
        if (followUp) evaluateRef.current();
      }
    })();
  };

  const reportIdleCloseFailure = (vaultId: string) => {
    clocksRef.current = restartIdleClock(clocksRef.current, vaultId, Date.now());
    evaluateRef.current();
  };

  const scheduleIdleRetry = () => {
    if (disposedRef.current) return;
    if (runningRef.current) {
      retrySoonRef.current = true;
      return;
    }
    const wakeAt = wakeAtRef.current;
    if (wakeAt != null && wakeAt - Date.now() <= IDLE_AUTO_CLOSE_RETRY_MS) return;
    scheduleWake(IDLE_AUTO_CLOSE_RETRY_MS);
  };

  const reportRef = useRef(reportIdleCloseFailure);
  const retryRef = useRef(scheduleIdleRetry);
  reportRef.current = reportIdleCloseFailure;
  retryRef.current = scheduleIdleRetry;

  const readAutoCloseRef = useRef<() => Promise<void>>(async () => {});
  readAutoCloseRef.current = async () => {
    const generation = ++reloadGenRef.current;
    const open = vaultsRef.current.filter((vault) => resolveVaultDisplayStatus(vault) === "open");
    if (open.length === 0) {
      if (generation !== reloadGenRef.current) return;
      targetsRef.current = [];
      clocksRef.current = [];
      stopScheduledWake();
      return;
    }
    const targets: IdleAutoCloseTarget[] = [];
    for (const vault of open) {
      try {
        const autoClose = await loadRef.current(vault.id);
        if (generation !== reloadGenRef.current) return;
        if (!autoClose?.enabled) continue;
        targets.push({
          id: vault.id,
          enabled: true,
          idleMinutes: autoClose.idle_minutes,
        });
      } catch {
        if (generation !== reloadGenRef.current) return;
        const previous = targetsRef.current.find((target) => target.id === vault.id);
        if (previous) targets.push(previous);
      }
    }
    if (generation !== reloadGenRef.current) return;
    targetsRef.current = targets;
    evaluateRef.current();
  };

  const reloadRef = useRef<() => Promise<void>>(async () => {});
  reloadRef.current = async () => {
    if (reloadingRef.current) {
      reloadAgainRef.current = true;
      return;
    }
    reloadingRef.current = true;
    try {
      do {
        reloadAgainRef.current = false;
        await readAutoCloseRef.current();
      } while (reloadAgainRef.current);
    } finally {
      reloadingRef.current = false;
    }
  };

  useEffect(() => {
    disposedRef.current = false;
    const retire = () => {
      disposedRef.current = true;
      epochRef.current += 1;
      cancelWakeRef.current();
      wakeAtRef.current = null;
    };
    // Nothing open: one clear, then no timer. The poll starts again with the next open vault.
    if (openKey.length === 0) {
      void reloadRef.current();
      return () => {
        retire();
        reloadGenRef.current += 1;
      };
    }
    const stopPoll = scheduleInterval(() => {
      void reloadRef.current();
    }, IDLE_AUTO_CLOSE_SETTINGS_MS);
    void reloadRef.current();
    return () => {
      stopPoll();
      retire();
      reloadGenRef.current += 1;
    };
  }, [openKey]);

  useEffect(() => {
    disposedRef.current = false;
    const retire = () => {
      disposedRef.current = true;
      epochRef.current += 1;
      cancelWakeRef.current();
      wakeAtRef.current = null;
    };
    const onSession = (event: IdleSessionEvent) => {
      if (event === "pause") {
        if (pausedAtRef.current == null) pausedAtRef.current = Date.now();
        if (keepOpenRef.current) {
          cancelWakeRef.current();
          wakeAtRef.current = null;
        }
        return;
      }
      const pausedAt = pausedAtRef.current;
      const waking = event === "resume" || pausedAt != null;
      if (waking) pausedAtRef.current = null;
      if (waking && keepOpenRef.current && pausedAt != null) {
        clocksRef.current = shiftIdleClocksForWake(clocksRef.current, pausedAt, Date.now());
      }
      evaluateRef.current();
    };
    const stopSession = subscribeSessionRef.current(onSession);
    const stopActivity = subscribeActivityRef.current(() => {
      if (clocksRef.current.length === 0) return;
      const pausedAt = pausedAtRef.current;
      // A touch while frozen still counts. Wall time would look "already due"
      // and the touch would be ignored.
      const now = pausedAt != null && keepOpenRef.current ? pausedAt : Date.now();
      clocksRef.current = applyIdleActivity(now, clocksRef.current);
      // This pass re-reads the clocks after its await. Requesting another pass
      // here would run the lock again for every scroll while that close runs.
      if (runningRef.current) return;
      const plannedAt = Date.now();
      if (plannedAt - lastActivityPlanAtRef.current < ACTIVITY_PLAN_MS) return;
      lastActivityPlanAtRef.current = plannedAt;
      evaluateRef.current();
    });
    return () => {
      retire();
      stopSession();
      stopActivity();
    };
  }, []);

  return {
    reportIdleCloseFailure: (vaultId) => reportRef.current(vaultId),
    scheduleIdleRetry: () => retryRef.current(),
  };
}
