import type { AppServices } from "@upriv/shared";
import { isNativeBridgeAvailable } from "upriv-core";
import { createMobileMockServices } from "@/platform/mocks";
import { createNativeServices } from "@/platform/native/createNativeServices";

/**
 * Prefer in-process Rust (`upriv-ffi`) when the Expo module is linked
 * (dev-client / release). Expo Go keeps mocks.
 */
export function createServices(): AppServices {
  if (isNativeBridgeAvailable()) {
    return createNativeServices();
  }
  return createMobileMockServices();
}
