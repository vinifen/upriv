import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleTimeout } from "./schedule";

export const TOAST_DEFAULT_MS = 5000;

export function useToast(defaultMs = TOAST_DEFAULT_MS) {
  const [message, setMessage] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setMessage(null);
  }, [clearTimer]);

  const show = useCallback(
    (next: string, durationMs = defaultMs) => {
      clearTimer();
      setMessage(next);
      if (durationMs > 0) {
        cancelRef.current = scheduleTimeout(() => {
          setMessage(null);
          cancelRef.current = null;
        }, durationMs);
      }
    },
    [clearTimer, defaultMs],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { message, show, dismiss };
}
