import { useCallback, useEffect, useRef, useState } from "react";

/** A minimum turn of the refresh icon, so a refresh that settles at once still shows. */
export function useRefreshState(durationMs = 800) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setIsRefreshing(false);
    }, durationMs);
  }, [durationMs]);

  return { isRefreshing, refresh };
}
