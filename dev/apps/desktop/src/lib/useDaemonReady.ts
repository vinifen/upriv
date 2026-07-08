import { useEffect, useState } from "react";
import { isDesktop } from "./invoke";
import { rpcAppVersion } from "./rpc";
import { useDesktopEvent } from "./useDesktopEvent";

/**
 * True once upriv-daemon is ready in Electron. Browser/mock mode is ready immediately.
 * Listens for `daemon_ready` and falls back to `app_version` if the event was missed.
 */
export function useDaemonReady(): boolean {
  const [ready, setReady] = useState(() => !isDesktop());

  useDesktopEvent("daemon_ready", () => {
    setReady(true);
  });

  useEffect(() => {
    if (!isDesktop() || ready) return;
    let cancelled = false;
    void rpcAppVersion()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready]);

  return ready;
}
