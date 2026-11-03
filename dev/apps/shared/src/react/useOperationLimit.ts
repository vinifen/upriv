import { useEffect, useState } from "react";
import { LOADING_APPEAR_DELAY_MS, OPERATION_LIMIT_MS } from "../domain";
import { scheduleTimeout } from "./schedule";

/**
 * A call the person cannot stop, while `active`. Both clocks start when it
 * turns active.
 *
 * - `visible`: true once `LOADING_APPEAR_DELAY_MS` passed, so fast work never
 *   flashes a spinner. Nothing counts down.
 * - `timedOut`: `OPERATION_LIMIT_MS` passed. The caller clears its busy state,
 *   bumps its generation token so a late answer is ignored, and offers Retry.
 */
export function useOperationLimit(active: boolean) {
  const [visible, setVisible] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      setTimedOut(false);
      return;
    }
    const cancelAppear = scheduleTimeout(() => setVisible(true), LOADING_APPEAR_DELAY_MS);
    const cancelLimit = scheduleTimeout(() => setTimedOut(true), OPERATION_LIMIT_MS);
    return () => {
      cancelAppear();
      cancelLimit();
    };
  }, [active]);

  return { visible, timedOut };
}
