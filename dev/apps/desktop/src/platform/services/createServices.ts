import type { AppServices } from "@upriv/shared";
import { isTauri } from "@/lib/tauri/invoke";
import { mockServices } from "@/platform/mocks";

/**
 * Platform service factory. Uses mocks in browser dev; Tauri impl when wired.
 */
export function createServices(): AppServices {
  if (isTauri()) {
    // Future: return tauri implementations per service.
    return mockServices;
  }
  return mockServices;
}
