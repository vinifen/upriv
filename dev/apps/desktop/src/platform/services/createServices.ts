import type { AppServices } from "@upriv/shared";
import { mockServices } from "@/platform/mocks";

/**
 * Platform service factory.
 *
 * Browser and Electron both use mocks until `platform/desktop/` adapters wire
 * vault RPC in upriv-daemon. Replace `mockServices` when Rust handlers land.
 */
export function createServices(): AppServices {
  return mockServices;
}
