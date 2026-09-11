/**
 * `setTimeout` is a runtime global everywhere this package runs, but `lib` is
 * kept DOM-free, so it is reached through `globalThis`. Resolves immediately
 * where no scheduler exists (keeps tests and SSR-ish hosts deterministic).
 */
export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const schedule = (globalThis as { setTimeout?: (fn: () => void, delay: number) => void })
      .setTimeout;
    if (schedule) schedule(resolve, ms);
    else resolve();
  });
}
