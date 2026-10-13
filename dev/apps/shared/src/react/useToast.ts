import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleTimeout } from "./schedule";

export const TOAST_DEFAULT_MS = 5000;

/** One visible toast. `id` changes on every `show`, so the progress line restarts. */
export interface ToastState {
  message: string;
  /** Auto-dismiss delay. `0` = stays until dismissed (no progress line). */
  durationMs: number;
  id: number;
}

export function useToast(defaultMs = TOAST_DEFAULT_MS) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const show = useCallback(
    (message: string, durationMs = defaultMs) => {
      clearTimer();
      idRef.current += 1;
      const id = idRef.current;
      const duration = Math.max(0, durationMs);
      setToast({ message, durationMs: duration, id });
    },
    [clearTimer, defaultMs],
  );

  // Start the dismiss clock after paint, with the progress line. A timer
  // started inside `show` runs while React is still rendering, so the toast
  // disappears before the bar finishes.
  useEffect(() => {
    if (!toast || toast.durationMs <= 0) return;
    const id = toast.id;
    const cancel = scheduleTimeout(() => {
      cancelRef.current = null;
      setToast((current) => (current?.id === id ? null : current));
    }, toast.durationMs);
    cancelRef.current = cancel;
    return () => {
      cancel();
      if (cancelRef.current === cancel) cancelRef.current = null;
    };
  }, [toast]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { toast, show, dismiss };
}
