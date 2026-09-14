import type { AppServices } from "@upriv/shared";
import { isDesktop } from "@/lib/invoke";
import { createDesktopServices } from "@/platform/desktop/createDesktopServices";
import { mockServices } from "@/platform/mocks";

/**
 * Platform service factory.
 *
 * Electron: live vault-root, settings, list, create, open/close, and groups.
 * Browser: full in-memory mocks (no `localStorage`; temporary until mocks are removed).
 */
export function createServices(): AppServices {
  if (isDesktop()) {
    return createDesktopServices();
  }
  return mockServices;
}
