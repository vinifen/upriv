import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { I18nProvider } from "@/i18n";
import { getMockAppSettings } from "./mockAppSettings";
import type { AppSettingsConfig, AppSettingsPatch } from "./appSettingsTypes";

interface AppSettingsContextValue {
  settings: AppSettingsConfig;
  replaceSettings: (next: AppSettingsConfig) => void;
  patchSettings: (patch: AppSettingsPatch) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettingsConfig>(() => getMockAppSettings());

  const replaceSettings = useCallback((next: AppSettingsConfig) => {
    setSettings(next);
  }, []);

  const patchSettings = useCallback((patch: AppSettingsPatch) => {
    setSettings((current) => ({
      ...current,
      ui: patch.ui ? { ...current.ui, ...patch.ui } : current.ui,
      logging: patch.logging ? { ...current.logging, ...patch.logging } : current.logging,
      app: patch.app ? { ...current.app, ...patch.app } : current.app,
    }));
  }, []);

  const value = useMemo(
    () => ({ settings, replaceSettings, patchSettings }),
    [settings, replaceSettings, patchSettings],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      <I18nProvider locale={settings.ui.locale}>{children}</I18nProvider>
    </AppSettingsContext.Provider>
  );
}

export function useAppSettingsContext(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) {
    throw new Error("useAppSettingsContext must be used within AppSettingsProvider");
  }
  return ctx;
}
