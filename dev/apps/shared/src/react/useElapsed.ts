import { useSyncExternalStore } from "react";
import { LOADING_APPEAR_DELAY_MS } from "../domain";
import { scheduleInterval } from "./schedule";

/**
 * One clock for every elapsed counter on screen: it ticks once a second while
 * any counter is shown, and stops when none is.
 */
const listeners = new Set<() => void>();
let now = Date.now();
let stopTicking: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (stopTicking === null) {
    now = Date.now();
    stopTicking = scheduleInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopTicking !== null) {
      stopTicking();
      stopTicking = null;
    }
  };
}

function idle(): () => void {
  return () => {};
}

/**
 * The clock's last tick. Before the first counter subscribes it is the current
 * second, so a counter that mounts late (a reopened window) starts right; whole
 * seconds keep the value stable while React reads it twice in one render.
 */
function readNow(): number {
  if (stopTicking === null) now = Math.floor(Date.now() / 1_000) * 1_000;
  return now;
}

export interface Elapsed {
  /** Time since `startedAt`, read from the shared clock. */
  elapsedMs: number;
  /** True once `LOADING_APPEAR_DELAY_MS` has passed, so fast work never flashes a counter. */
  visible: boolean;
}

/**
 * How long work that started at `startedAt` has been running. `null` while it
 * has not started (queued) or nothing runs. The value is "now minus start", so
 * a tick missed in the background never makes it drift.
 */
export function useElapsed(startedAt: number | null): Elapsed | null {
  const current = useSyncExternalStore(startedAt === null ? idle : subscribe, readNow, readNow);
  if (startedAt === null) return null;
  const elapsedMs = Math.max(0, current - startedAt);
  return { elapsedMs, visible: elapsedMs >= LOADING_APPEAR_DELAY_MS };
}
