import type { AppServices } from "@upriv/shared";
import { createDesktopServices } from "@/platform/desktop/createDesktopServices";

/**
 * Electron desktop services. Vault I/O goes through `upriv-daemon`.
 * There is no in-memory vault list — open the UI from the Electron shell.
 */
export function createServices(): AppServices {
  return createDesktopServices();
}
