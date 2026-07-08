import type { AppServices } from "@upriv/shared";
import { mockServices } from "@/platform/mocks";

/**
 * Desktop adapters → upriv-daemon. Replace mock delegation as RPC handlers land.
 * Until then, createServices() still uses mocks directly.
 */
export function createDesktopServices(): AppServices {
  // TODO: return real services (vault, lifecycle, backups, …) calling rpc* helpers.
  return mockServices;
}
