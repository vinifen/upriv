import { MODAL_CLOSE_MS } from "../motion";

/** Count of app overlays while mounted (includes the close-animation frame). */
let openCount = 0;

type TimerHost = {
  requestAnimationFrame?: (cb: () => void) => number;
  setTimeout?: (fn: () => void, delay: number) => number;
};

function host(): TimerHost {
  return globalThis as TimerHost;
}

/** Call while a Modal / fullscreen overlay is mounted (not only `open`). Pair with `releaseOpenModal`. */
export function acquireOpenModal(): void {
  openCount += 1;
}

export function releaseOpenModal(): void {
  openCount = Math.max(0, openCount - 1);
}

export function hasOpenModal(): boolean {
  return openCount > 0;
}

/** After React commits (lifecycle password dialog closed, etc.). */
export function runAfterUiSettled(fn: () => void): void {
  const timers = host();
  if (typeof timers.requestAnimationFrame === "function") {
    timers.requestAnimationFrame(() => {
      timers.requestAnimationFrame?.(() => {
        fn();
      });
    });
    return;
  }
  if (typeof timers.setTimeout === "function") {
    timers.setTimeout(fn, 0);
    return;
  }
  fn();
}

/**
 * When enabled, run `open` after the current overlay close tween finishes —
 * skipped if any modal is still mounted. Used to auto-open the file manager
 * after a successful vault unlock without stacking on the password dialog.
 *
 * The close tween timer is armed in Modal's effect *after* this scheduler
 * (pipeline `onComplete` → `setLifecycleRequest(null)` → commit → effect).
 * Both wait `MODAL_CLOSE_MS`, so the first check can still see `mounted`.
 * One short retry covers that tick; a dialog that stays open still skips.
 */
const CLOSE_TWEEN_RETRY_MS = 32;

export function scheduleOpenFileManagerIfIdle(enabled: boolean, open: () => void): void {
  if (!enabled) return;
  const timers = host();
  const tryOpen = (retriesLeft: number): void => {
    runAfterUiSettled(() => {
      if (!hasOpenModal()) {
        open();
        return;
      }
      if (retriesLeft <= 0) return;
      if (typeof timers.setTimeout === "function") {
        timers.setTimeout(() => tryOpen(retriesLeft - 1), CLOSE_TWEEN_RETRY_MS);
      }
    });
  };
  if (typeof timers.setTimeout === "function") {
    timers.setTimeout(() => tryOpen(1), MODAL_CLOSE_MS);
    return;
  }
  tryOpen(0);
}
