import type { AppServices } from "@upriv/shared";
import { isDesktop } from "@/lib/desktop/invoke";
import { mockServices } from "@/platform/mocks";

/**
 * Platform service factory.
 *
 * Browser: mock services. Electron: mock services until daemon adapters replace
 * `platform/mocks/` (wire real handlers in `crates/upriv-daemon`).
 */
export function createServices(): AppServices {
  if (isDesktop()) {
    // IPC smoke test: `app_version` is wired in upriv-daemon; vault RPC is still TODO.
  }
  return mockServices;
}
