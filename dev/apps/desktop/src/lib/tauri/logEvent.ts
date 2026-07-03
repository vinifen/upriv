import { TAURI_COMMANDS } from "./commands";
import { isTauri, tauriInvoke } from "./invoke";
import { resolveVaultRootPath } from "@/platform/tauri/vaultRoot";

export type LogEventLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Best-effort app-level log entry — never throws, no-op outside Tauri. */
export async function logEvent(
  level: LogEventLevel,
  event: string,
  fields?: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const vaultRoot = await resolveVaultRootPath();
    await tauriInvoke(TAURI_COMMANDS.LOG_APPEND, {
      vaultRoot,
      level,
      event,
      fields: fields ?? "",
    });
  } catch {
    // Logging must never break the UI.
  }
}
