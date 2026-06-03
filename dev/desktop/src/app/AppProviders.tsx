import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n";

interface AppProvidersProps {
  children: ReactNode;
}

/** Composes global React context providers (i18n, future theme/query). */
export function AppProviders({ children }: AppProvidersProps) {
  return <I18nProvider>{children}</I18nProvider>;
}
