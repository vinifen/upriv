import { useEffect, useState } from "react";
import { LOADING_APPEAR_DELAY_MS } from "@upriv/shared";

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

    const appearId = setTimeout(() => setVisible(true), LOADING_APPEAR_DELAY_MS);
    const tick = () => {
      const left = Math.max(0, budgetMs - (Date.now() - startedAt));
      setRemainingMs(left);
      if (left <= 0) {
        setTimedOut(true);
        setVisible(true);
      }
    };
    tick();
    const tickId = setInterval(tick, 250);
    return () => {
      clearTimeout(appearId);
      clearInterval(tickId);
    };
  }, [active, budgetMs]);

  return { remainingMs, timedOut, budgetMs, visible };
}
