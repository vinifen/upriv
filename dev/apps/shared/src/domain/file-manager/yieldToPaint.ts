/** Let the explorer paint pending rows before the next synchronous plan or RPC. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    const host = globalThis as {
      requestAnimationFrame?: (cb: () => void) => number;
      setTimeout?: (cb: () => void, ms: number) => unknown;
    };
    if (typeof host.requestAnimationFrame === "function") {
      host.requestAnimationFrame(() => resolve());
      return;
    }
    if (typeof host.setTimeout === "function") {
      host.setTimeout(() => resolve(), 0);
      return;
    }
    resolve();
  });
}
