import type { ReactNode } from "react";
import { AppSettingsProvider } from "@/features/system/settings";
import { FileManagerProvider } from "@/features/vaults/file-manager";
import { createServices, ServicesProvider } from "@/platform/services";

interface AppProvidersProps {
  children: ReactNode;
}

const appServices = createServices();

/** Composes global React context providers (services, app settings, i18n, file manager). */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ServicesProvider services={appServices}>
      <AppSettingsProvider>
        <FileManagerProvider>{children}</FileManagerProvider>
      </AppSettingsProvider>
    </ServicesProvider>
  );
}
