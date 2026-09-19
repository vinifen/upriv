import type { ReactNode } from "react";
import {
  AppSettingsProvider,
  SettingsPersistErrorToast,
  VaultRootGate,
} from "@/features/system/settings";
import { FileManagerProvider } from "@/features/vaults/file-manager";
import { DropdownOverlayProvider } from "@/components/ui/DropdownOverlayHost";
import { ThemeProvider } from "@/theme";
import { createServices, ServicesProvider } from "@/platform/services";

interface AppProvidersProps {
  children: ReactNode;
}

const appServices = createServices();

/**
 * Provider order (invariant — matches desktop + theme):
 * 1. ServicesProvider
 * 2. AppSettingsProvider (+ i18n)
 * 3. ThemeProvider (reads settings.ui.theme)
 * 4. DropdownOverlayProvider (anchored menus; same window as triggers)
 * 5. VaultRootGate + persist toast (must be under ThemeProvider)
 * 6. FileManagerProvider — under gate so session state survives setup/repair overlays
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ServicesProvider services={appServices}>
      <AppSettingsProvider>
        <ThemeProvider>
          <DropdownOverlayProvider>
            <VaultRootGate>
              <FileManagerProvider>{children}</FileManagerProvider>
            </VaultRootGate>
          </DropdownOverlayProvider>
          <SettingsPersistErrorToast />
        </ThemeProvider>
      </AppSettingsProvider>
    </ServicesProvider>
  );
}
