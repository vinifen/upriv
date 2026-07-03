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
import { I18nProvider, useTranslation } from "@/i18n";
import { applyDocumentTheme } from "@/theme";
import { createDefaultAppSettings, normalizeAppSettings } from "@upriv/shared";
import type { AppSettingsConfig, AppSettingsPatch } from "@upriv/shared";
import { useToast } from "@/hooks/useToast";
import { isTauri } from "@/lib/tauri/invoke";
import { APP_PACKAGE_VERSION, logEvent } from "@/lib/tauri";
import { setVaultRootPath, resolveVaultRootPath } from "@/platform/tauri/vaultRoot";

interface AppSettingsContextValue {
  settings: AppSettingsConfig;
  /** False until the first `AppSettingsService.load()` finishes. */
  isSettingsLoaded: boolean;
  replaceSettings: (next: AppSettingsConfig) => Promise<void>;
  patchSettings: (patch: AppSettingsPatch) => Promise<void>;
  /** Reload settings.toml (or mock) without persisting. */
  reloadSettings: () => Promise<void>;
  /** Session-only — not saved to settings.toml; resets when the app restarts. */
  showHiddenVaultsSession: boolean;
  setShowHiddenVaultsSession: (value: boolean) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function SettingsPersistErrorToast({ signal }: { signal: number }) {
  const { t } = useTranslation();
  const { show: showToast } = useToast();

  useEffect(() => {
    if (signal === 0) return;
    showToast(t("toast.settings_save_failed"));
  }, [showToast, signal, t]);

  return null;
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const appSettingsService = useAppSettingsService();
  const [settings, setSettings] = useState<AppSettingsConfig>(() => createDefaultAppSettings());
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [showHiddenVaultsSession, setShowHiddenVaultsSession] = useState(false);
  const [persistErrorSignal, setPersistErrorSignal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void appSettingsService
      .load()
      .then(async (loaded) => {
        if (cancelled) return;
        const normalized = normalizeAppSettings(loaded);
        setSettings(normalized);
        if (isTauri()) {
          if (!normalized.app.auto_detect_vault_root) {
            const manualRoot = normalized.app.upriv_root_path?.trim();
            setVaultRootPath(manualRoot || null);
          } else {
            await resolveVaultRootPath().catch(() => undefined);
          }
          void logEvent("info", "app_start", `version=${APP_PACKAGE_VERSION}`);
        }
      })
      .catch((error) => {
        // Never trap the app on a loading screen — fall back to defaults.
        console.error("app settings load failed", error);
      })
      .finally(() => {
        if (!cancelled) setIsSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appSettingsService]);

  const reloadSettings = useCallback(async () => {
    const loaded = await appSettingsService.load();
    setSettings(normalizeAppSettings(loaded));
  }, [appSettingsService]);

  const notifyPersistFailed = useCallback(() => {
    setPersistErrorSignal((count) => count + 1);
  }, []);

  const persistSettings = useCallback(
    async (next: AppSettingsConfig) => {
      const normalized = normalizeAppSettings(next);
      setSettings(normalized);
      if (isTauri()) {
        if (!normalized.app.auto_detect_vault_root) {
          const manualRoot = normalized.app.upriv_root_path?.trim();
          setVaultRootPath(manualRoot || null);
        } else {
          await resolveVaultRootPath().catch(() => undefined);
        }
      }
      try {
        await appSettingsService.save(normalized);
      } catch {
        await reloadSettings();
        notifyPersistFailed();
        throw new Error("settings_save_failed");
      }
    },
    [appSettingsService, notifyPersistFailed, reloadSettings],
  );

  const replaceSettings = useCallback(
    async (next: AppSettingsConfig) => {
      await persistSettings(next);
    },
    [persistSettings],
  );

  const patchSettings = useCallback(
    async (patch: AppSettingsPatch) => {
      const current = settings;
      const next = normalizeAppSettings({
        ...current,
        ui: patch.ui ? { ...current.ui, ...patch.ui } : current.ui,
        logging: patch.logging ? { ...current.logging, ...patch.logging } : current.logging,
        app: patch.app ? { ...current.app, ...patch.app } : current.app,
      });
      try {
        await persistSettings(next);
      } catch {
        // persistSettings already reloaded and signaled toast
      }
    },
    [persistSettings, settings],
  );

  const value = useMemo(
    () => ({
      settings,
      isSettingsLoaded,
      replaceSettings,
      patchSettings,
      reloadSettings,
      showHiddenVaultsSession,
      setShowHiddenVaultsSession,
    }),
    [
      settings,
      isSettingsLoaded,
      replaceSettings,
      patchSettings,
      reloadSettings,
      showHiddenVaultsSession,
    ],
  );

  useEffect(() => {
    applyDocumentTheme(settings.ui.theme);
  }, [settings.ui.theme]);

  return (
    <AppSettingsContext.Provider value={value}>
      <I18nProvider locale={settings.ui.locale}>
        {children}
        <SettingsPersistErrorToast signal={persistErrorSignal} />
      </I18nProvider>
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
