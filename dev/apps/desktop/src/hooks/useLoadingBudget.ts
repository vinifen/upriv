import { useEffect, useState } from "react";
import { LOADING_APPEAR_DELAY_MS } from "@upriv/shared";

/**
 * Tracks a finite loading budget while `active`.
 *
 * - `visible`: true only after {@link LOADING_APPEAR_DELAY_MS} while still active —
 *   skip the spinner for fast ops so the UI does not flash.
 * - `timedOut`: budget exhausted — callers must clear the spinner and offer retry.
 * - Budget countdown starts when `active` becomes true (not when `visible` flips).
 */
export function useLoadingBudget(active: boolean, budgetMs: number) {
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

    const startedAt = Date.now();
    setVisible(false);
    setTimedOut(false);
    setRemainingMs(budgetMs);

    const appearId = window.setTimeout(() => {
      setVisible(true);
    }, LOADING_APPEAR_DELAY_MS);

    const tick = () => {
      const left = Math.max(0, budgetMs - (Date.now() - startedAt));
      setRemainingMs(left);
      if (left <= 0) {
        setTimedOut(true);
        setVisible(true);
      }
    };
    tick();
    const tickId = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(appearId);
      window.clearInterval(tickId);
    };
  }, [active, budgetMs]);

  return { remainingMs, timedOut, budgetMs, visible };
}
