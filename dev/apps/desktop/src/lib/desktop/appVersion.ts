import packageJson from "../../../package.json";
import { DESKTOP_COMMANDS } from "./commands";
import { desktopInvoke, isDesktop } from "./invoke";

/** npm package version — fallback when Rust IPC is unavailable (browser dev). */
export const APP_PACKAGE_VERSION = packageJson.version;

/** Shell version from upriv-daemon when in Electron; otherwise `APP_PACKAGE_VERSION`. */
export async function getAppVersion(): Promise<string> {
  if (!isDesktop()) return APP_PACKAGE_VERSION;
  try {
    return await desktopInvoke<string>(DESKTOP_COMMANDS.APP_VERSION);
  } catch {
    return APP_PACKAGE_VERSION;
  }
}
