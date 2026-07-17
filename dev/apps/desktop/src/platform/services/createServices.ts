import type { AppServices } from "@upriv/shared";
import { isDesktop } from "@/lib/invoke";
import { createDesktopServices } from "@/platform/desktop/createDesktopServices";
import { mockServices } from "@/platform/mocks";

/**
 * Platform service factory.
 *
 * Electron: real vault-root + app-settings RPCs (+ empty vault list until `vault_list`).
 * Browser: full in-memory mocks (no `localStorage`; temporary until mocks are removed).
 */
export function createServices(): AppServices {
  if (isDesktop()) {
    return createDesktopServices();
  }
  return mockServices;
}
