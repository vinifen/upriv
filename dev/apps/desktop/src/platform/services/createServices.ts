import type { AppServices } from "@upriv/shared";
import { isTauri } from "@/lib/tauri/invoke";
import { mockServices } from "@/platform/mocks";

/**
 * Platform service factory.
 *
 * MVP: mock implementations for browser and Tauri builds until Rust handlers are wired.
 * TODO (post-review):
 * - Replace `mockServices` with real Tauri/platform adapters and delete `src/platform/mocks/`.
 * - Rename symbols that still carry `mock` / `Mock` / `getMock*` (e.g. `validateMockLifecyclePassword`,
 *   `MOCK_VAULTS`, `mockVaultService`) to neutral platform names as real impls land — shared
 *   contracts (`VaultService`, etc.) already avoid mock prefixes.
 */
export function createServices(): AppServices {
  void isTauri();
  return mockServices;
}
