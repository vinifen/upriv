import { useEffect, useState } from "react";
import { loadingAppearDelayMs } from "../domain";
import { scheduleInterval, scheduleTimeout } from "./schedule";

export interface UseLoadingBudgetOptions {
  appearDelayMs?: number;
  /** Shared origin (e.g. pipeline `startedAt`) so modal + row stay on one clock. */
  startedAt?: number;
}

/**
 * Tracks a finite loading budget while `active`.
 *
 * - `visible`: true only after the appear delay while still active —
 *   1s for short budgets, 10s for 10-minute ones so "up to 10 min" does not scare.
 * - `timedOut`: budget exhausted — callers must clear the spinner and offer retry.
 * - Budget countdown starts at `startedAt` when given, otherwise when `active` flips.
 */
export function useLoadingBudget(
  active: boolean,
  budgetMs: number,
  options?: UseLoadingBudgetOptions,
) {
  const appearDelayMs = options?.appearDelayMs ?? loadingAppearDelayMs(budgetMs);
  const startedAtOverride = options?.startedAt;
  const [remainingMs, setRemainingMs] = useState(budgetMs);
  const [timedOut, setTimedOut] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setRemainingMs(budgetMs);
      setTimedOut(false);
      setVisible(false);
      return;
    }

    const startedAt = startedAtOverride ?? Date.now();
    setTimedOut(false);

    let cancelTick = () => {};
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, budgetMs - elapsed);
      setRemainingMs(left);
      setVisible(elapsed >= appearDelayMs || left <= 0);
      if (left <= 0) {
        cancelTick();
        setTimedOut(true);
      }
    };
    tick();
    cancelTick = scheduleInterval(tick, 250);

    const elapsed = Date.now() - startedAt;
    const appearIn = Math.max(0, appearDelayMs - elapsed);
    const cancelAppear =
      appearIn === 0
        ? () => {}
        : scheduleTimeout(() => {
            setVisible(true);
          }, appearIn);

    return () => {
      cancelAppear();
      cancelTick();
    };
  }, [active, appearDelayMs, budgetMs, startedAtOverride]);

  return { remainingMs, timedOut, budgetMs, visible };
}
