import { useEffect, useRef } from "react";
import { isDesktop } from "./invoke";

/**
 * Subscribe to a single daemon/event name without leaking listeners when the handler changes.
 * Uses a stable preload subscription + ref for the latest callback.
 */
export function useDesktopEvent(eventName: string, handler: (payload: unknown) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!isDesktop()) return undefined;
    const api = window.upriv;
    if (!api) return undefined;

    return api.onEvent((name, payload) => {
      if (name === eventName) handlerRef.current(payload);
    });
  }, [eventName]);
}
