import packageJson from "../../../package.json";
import { TAURI_COMMANDS } from "./commands";
import { isTauri, tauriInvoke } from "./invoke";

/** npm package version — fallback when Rust IPC is unavailable (browser dev). */
export const APP_PACKAGE_VERSION = packageJson.version;

/** Shell version from Rust when in Tauri; otherwise `APP_PACKAGE_VERSION`. */
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return APP_PACKAGE_VERSION;
  try {
    return await tauriInvoke<string>(TAURI_COMMANDS.APP_VERSION);
  } catch {
    return APP_PACKAGE_VERSION;
  }
}
