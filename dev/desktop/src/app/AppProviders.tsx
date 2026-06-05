import type { ReactNode } from "react";
import { AppSettingsProvider } from "@/features/app-settings";
import { FileManagerProvider } from "@/features/file-manager";

interface AppProvidersProps {
  children: ReactNode;
}

/** Composes global React context providers (i18n, future theme/query). */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <AppSettingsProvider>
      <FileManagerProvider>{children}</FileManagerProvider>
    </AppSettingsProvider>
  );
}
