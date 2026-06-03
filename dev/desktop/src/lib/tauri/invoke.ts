import { invoke } from "@tauri-apps/api/core";

/** True when running inside the Tauri WebView shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Typed wrapper around Tauri `invoke`.
 * Throws if called outside Tauri — use `isTauri()` or feature flags for browser dev.
 */
export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}
