/** Optional best-effort work before quit (e.g. start vault close pipelines). Must not block. */
let onAppExit: (() => void) | null = null;

export function registerAppExitHandler(handler: (() => void) | null): void {
  onAppExit = handler;
}

export function runAppExitHandler(): void {
  try {
    onAppExit?.();
  } catch (error) {
    console.error("app exit handler failed", error);
  }
}
