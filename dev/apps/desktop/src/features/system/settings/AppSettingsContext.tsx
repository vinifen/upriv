import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAppSettingsService } from "@/platform/services";
import { I18nProvider } from "@/i18n";
import { applyDocumentTheme } from "@/theme";
import { DEFAULT_APP_SETTINGS } from "@/platform/mocks/data/appSettings";
import type { AppSettingsConfig, AppSettingsPatch } from "./appSettingsTypes";
import { normalizeAppSettings } from "./appSettingsTypes";

interface AppSettingsContextValue {
  settings: AppSettingsConfig;
  replaceSettings: (next: AppSettingsConfig) => void;
  patchSettings: (patch: AppSettingsPatch) => void;
  /** Reload settings.toml (or mock) without persisting. */
  reloadSettings: () => Promise<void>;
  /** Session-only — not saved to settings.toml; resets when the app restarts. */
  showHiddenVaultsSession: boolean;
  setShowHiddenVaultsSession: (value: boolean) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const appSettingsService = useAppSettingsService();
  const [settings, setSettings] = useState<AppSettingsConfig>(() =>
    structuredClone(DEFAULT_APP_SETTINGS),
  );
  const [showHiddenVaultsSession, setShowHiddenVaultsSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void appSettingsService.load().then((loaded) => {
      if (!cancelled) setSettings(normalizeAppSettings(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, [appSettingsService]);

  const persistSettings = useCallback(
    (next: AppSettingsConfig) => {
      const normalized = normalizeAppSettings(next);
      setSettings(normalized);
      void appSettingsService.save(normalized);
    },
    [appSettingsService],
  );

  const replaceSettings = useCallback(
    (next: AppSettingsConfig) => {
      persistSettings(next);
    },
    [persistSettings],
  );

  const patchSettings = useCallback(
    (patch: AppSettingsPatch) => {
      setSettings((current) => {
        const next = normalizeAppSettings({
          ...current,
          ui: patch.ui ? { ...current.ui, ...patch.ui } : current.ui,
          logging: patch.logging ? { ...current.logging, ...patch.logging } : current.logging,
          app: patch.app ? { ...current.app, ...patch.app } : current.app,
        });
        void appSettingsService.save(next);
        return next;
      });
    },
    [appSettingsService],
  );

  const reloadSettings = useCallback(async () => {
    const loaded = await appSettingsService.load();
    setSettings(normalizeAppSettings(loaded));
  }, [appSettingsService]);

  const value = useMemo(
    () => ({
      settings,
      replaceSettings,
      patchSettings,
      reloadSettings,
      showHiddenVaultsSession,
      setShowHiddenVaultsSession,
    }),
    [settings, replaceSettings, patchSettings, reloadSettings, showHiddenVaultsSession],
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
