import { useEffect, useState } from "react";
import { scheduleTimeout } from "./schedule";

/**
 * `value` once it has held still for `delayMs`, for work too slow to run on
 * every key. A new `key` (another file) takes `value` at once, so it never
 * shows what belonged to the previous one.
 */
export function useSettledValue<T>(value: T, delayMs: number, key: unknown): T {
  const [settled, setSettled] = useState({ key, value });

  useEffect(() => {
    if (settled.key !== key) {
      setSettled({ key, value });
      return;
    }
    if (Object.is(settled.value, value)) return;
    return scheduleTimeout(() => setSettled({ key, value }), delayMs);
  }, [delayMs, key, settled, value]);

  return settled.key === key ? settled.value : value;
}
