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
  // Browser (`npm run dev`) and Tauri (`npm run tauri:dev`) share mock services until
  // `src-tauri` handlers replace `platform/mocks/` (see SDD §8.2.6).
  if (isTauri()) {
    // IPC smoke test: `app_version` is wired in Rust; vault IPC commands are still TODO.
  }
  return mockServices;
}
