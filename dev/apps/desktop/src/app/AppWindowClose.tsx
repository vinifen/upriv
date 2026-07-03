import { useEffect } from "react";
import { isTauri, TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { runAppExitHandler } from "./appExitBridge";

/** Hard cap — quit even if vault-close pipelines are still running. */
const EXIT_DEADLINE_MS = 2_500;

async function quitApp(): Promise<void> {
  try {
    await tauriInvoke(TAURI_COMMANDS.APP_EXIT);
  } catch (error) {
    console.error("app_exit failed, trying window.destroy", error);
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().destroy();
    } catch (destroyError) {
      console.error("window.destroy failed", destroyError);
    }
  }
}

/**
 * Registers the window close (X) handler as early as possible.
 * Always quits — never leaves a zombie window after preventDefault.
 */
export function AppWindowClose() {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let quitting = false;

    const scheduleQuit = () => {
      if (exitTimer) clearTimeout(exitTimer);
      exitTimer = setTimeout(() => {
        void quitApp();
      }, EXIT_DEADLINE_MS);
    };

    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      if (disposed) return;
      const currentWindow = getCurrentWindow();
      void currentWindow
        .onCloseRequested((event) => {
          event.preventDefault();
          if (quitting) {
            void quitApp();
            return;
          }
          quitting = true;
          runAppExitHandler();
          scheduleQuit();
          void quitApp();
        })
        .then((cleanup) => {
          if (disposed) {
            cleanup();
            return;
          }
          unlisten = cleanup;
        });
    });

    return () => {
      disposed = true;
      if (exitTimer) clearTimeout(exitTimer);
      unlisten?.();
    };
  }, []);

  return null;
}
