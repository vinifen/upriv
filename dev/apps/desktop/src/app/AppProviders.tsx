import type { ReactNode } from "react";
import { AppSettingsProvider, VaultRootGate } from "@/features/system/settings";
import { FileManagerProvider } from "@/features/vaults/file-manager";
import { createServices, ServicesProvider } from "@/platform/services";
import { QuitClosingOverlay } from "./QuitClosingOverlay";

interface AppProvidersProps {
  children: ReactNode;
}

const appServices = createServices();

/**
 * Provider order (invariant):
 * 1. `ServicesProvider` — daemon RPC adapters
 * 2. `AppSettingsProvider` — settings + i18n (Gate needs settings)
 * 3. `VaultRootGate` — overlay until vault-root ready; children stay mounted
 *    (`inert` + `pointer-events-none` + `aria-hidden` while blocked).
 *    (`ready` kept across re-resolve until a blocking state is confirmed)
 * 4. `FileManagerProvider` — under gate so session state survives setup/repair overlays
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ServicesProvider services={appServices}>
      <AppSettingsProvider>
        <VaultRootGate>
          <FileManagerProvider>{children}</FileManagerProvider>
        </VaultRootGate>
        <QuitClosingOverlay />
      </AppSettingsProvider>
    </ServicesProvider>
  );
}
