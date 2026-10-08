import { useCallback, useRef } from "react";
import { FILE_MANAGER_DOUBLE_TAP_MS } from "@upriv/shared";

/** Call on every tap; returns true when it completes a double tap (the pair is then reset). */
export function useDoubleTap(): () => boolean {
  const lastTapRef = useRef(0);
  return useCallback(() => {
    const now = Date.now();
    const isDouble = now - lastTapRef.current < FILE_MANAGER_DOUBLE_TAP_MS;
    lastTapRef.current = isDouble ? 0 : now;
    return isDouble;
  }, []);
}
