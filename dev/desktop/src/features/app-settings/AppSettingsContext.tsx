import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nProvider } from "@/i18n";
import { applyDocumentTheme } from "@/theme";
import { getMockAppSettings } from "./mockAppSettings";
import type { AppSettingsConfig, AppSettingsPatch } from "./appSettingsTypes";
import { normalizeAppSettings } from "./appSettingsTypes";

interface AppSettingsContextValue {
  settings: AppSettingsConfig;
  replaceSettings: (next: AppSettingsConfig) => void;
  patchSettings: (patch: AppSettingsPatch) => void;
  /** Session-only — not saved to settings.toml; resets when the app restarts. */
  showHiddenVaultsSession: boolean;
  setShowHiddenVaultsSession: (value: boolean) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettingsConfig>(() => getMockAppSettings());
  const [showHiddenVaultsSession, setShowHiddenVaultsSession] = useState(false);

  const replaceSettings = useCallback((next: AppSettingsConfig) => {
    setSettings(normalizeAppSettings(next));
  }, []);

  const patchSettings = useCallback((patch: AppSettingsPatch) => {
    setSettings((current) =>
      normalizeAppSettings({
        ...current,
        ui: patch.ui ? { ...current.ui, ...patch.ui } : current.ui,
        logging: patch.logging ? { ...current.logging, ...patch.logging } : current.logging,
        app: patch.app ? { ...current.app, ...patch.app } : current.app,
      }),
    );
  }, []);

  const value = useMemo(
    () => ({
      settings,
      replaceSettings,
      patchSettings,
      showHiddenVaultsSession,
      setShowHiddenVaultsSession,
    }),
    [settings, replaceSettings, patchSettings, showHiddenVaultsSession],
  );

  useEffect(() => {
    applyDocumentTheme(settings.ui.theme);
  }, [settings.ui.theme]);

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
