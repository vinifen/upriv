/** True when running inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "upriv" in window && window.upriv != null;
}

/**
 * Typed wrapper around Electron preload `window.upriv.invoke`.
 * Throws if called outside the desktop shell — use `isDesktop()` for browser dev.
 */
export async function desktopInvoke<T>(
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!isDesktop()) {
    throw new Error("desktopInvoke called outside Electron shell");
  }
  const api = window.upriv;
  if (!api) {
    throw new Error("desktopInvoke called outside Electron shell");
  }
  return api.invoke(method, params) as Promise<T>;
}
