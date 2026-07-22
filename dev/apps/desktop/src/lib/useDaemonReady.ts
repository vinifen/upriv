import { useEffect, useState } from "react";
import { clearSessionAppVersion } from "./appVersion";
import { isDesktop } from "./invoke";
import { rpcAppVersion } from "./rpc";
import { useDesktopEvent } from "./useDesktopEvent";

/**
 * True once upriv-daemon is ready in Electron. Browser/mock mode is ready immediately.
 * Listens for `daemon_ready` and falls back to `app_version` if the event was missed.
 * Clears the session version cache when the main process reports `daemon_exited`.
 */
export function useDaemonReady(): boolean {
  const [ready, setReady] = useState(() => !isDesktop());

  useDesktopEvent("daemon_ready", () => {
    setReady(true);
  });

  useDesktopEvent("daemon_exited", () => {
    clearSessionAppVersion();
    setReady(false);
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
