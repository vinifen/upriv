/**
 * Timer / frame helpers via `globalThis` so this package stays DOM-lib-free
 * (same idea as `delayMs`).
 */
type ScheduleHost = {
  requestAnimationFrame?: (cb: () => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  setTimeout?: (fn: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
  setInterval?: (fn: () => void, delay: number) => number;
  clearInterval?: (id: number) => void;
};

function host(): ScheduleHost {
  return globalThis as ScheduleHost;
}

export function scheduleAnimationFrame(cb: () => void): () => void {
  const timers = host();
  if (typeof timers.requestAnimationFrame === "function") {
    const id = timers.requestAnimationFrame(cb);
    return () => timers.cancelAnimationFrame?.(id);
  }
  if (typeof timers.setTimeout === "function") {
    const id = timers.setTimeout(cb, 0);
    return () => timers.clearTimeout?.(id);
  }
  cb();
  return () => {};
}

export function scheduleTimeout(fn: () => void, delay: number): () => void {
  const timers = host();
  if (typeof timers.setTimeout !== "function") return () => {};
  const id = timers.setTimeout(fn, delay);
  return () => timers.clearTimeout?.(id);
}

export function scheduleInterval(fn: () => void, delay: number): () => void {
  const timers = host();
  if (typeof timers.setInterval !== "function") return () => {};
  const id = timers.setInterval(fn, delay);
  return () => timers.clearInterval?.(id);
}
