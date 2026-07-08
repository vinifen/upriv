import { useCallback, useRef, useState } from "react";

export const TOAST_DEFAULT_MS = 5000;

export function useToast(defaultMs = TOAST_DEFAULT_MS) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMessage(null);
  }, []);

  const show = useCallback(
    (next: string, durationMs = defaultMs) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      setMessage(next);
      if (durationMs > 0) {
        timerRef.current = window.setTimeout(() => {
          setMessage(null);
          timerRef.current = null;
        }, durationMs);
      }
    },
    [defaultMs],
  );

  return { message, show, dismiss };
}
