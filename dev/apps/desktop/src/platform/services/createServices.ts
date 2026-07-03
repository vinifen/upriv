import type { AppServices } from "@upriv/shared";
import { isTauri } from "@/lib/tauri/invoke";
import { mockServices } from "@/platform/mocks";
import { createTauriServices } from "@/platform/tauri/createTauriServices";

/**
 * Platform service factory.
 *
 * Browser: mock services. Tauri: real vault list + plain lifecycle via upriv-core.
 */
export function createServices(): AppServices {
  if (isTauri()) {
    return createTauriServices(mockServices);
  }
  return mockServices;
}
