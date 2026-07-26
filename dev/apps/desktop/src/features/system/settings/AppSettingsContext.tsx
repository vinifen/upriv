import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAppSettingsService } from "@/platform/services";
import { I18nProvider, useTranslation } from "@/i18n";
import { applyDocumentTheme } from "@/theme";
import { createDefaultAppSettings, normalizeAppSettings, RpcError } from "@upriv/shared";
import type { AppSettingsConfig, AppSettingsPatch } from "@upriv/shared";
import { useToast } from "@/hooks/useToast";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import type { I18nKey } from "@/i18n";

interface PersistOptions {
  /**
   * Caller already ran `setupDefaultRoot` / `setupAtPath` (Data folder / Setup /
   * Repair / Recovery). Reload that root’s `settings.toml` — do not overwrite it
   * with the previous session’s in-memory UI prefs. Vault-root disk mutations are
   * modal-owned; Context never calls setup*.
   */
  vaultRootAlreadyApplied?: boolean;
}

interface AppSettingsContextValue {
  settings: AppSettingsConfig;
  /** False until the first `load()` from disk (or defaults) finishes. */
  settingsReady: boolean;
  /** True when the last load came from on-disk settings.toml (not bootstrap defaults). */
  settingsOnDisk: boolean;
  /**
   * Bumped after a successful vault-root mode/path persist.
   * `VaultRootGate` re-resolves on this (not on every unrelated settings patch).
   */
  vaultRootEpoch: number;
  replaceSettings: (next: AppSettingsConfig, options?: PersistOptions) => Promise<void>;
  /** Persists a partial update. Returns `false` when save failed (toast already shown). */
  patchSettings: (patch: AppSettingsPatch, options?: PersistOptions) => Promise<boolean>;
  /** Reload settings.toml (or defaults) without persisting. */
  reloadSettings: () => Promise<void>;
  /** Session-only — not saved to settings.toml; resets when the app restarts. */
  showHiddenVaultsSession: boolean;
  setShowHiddenVaultsSession: (value: boolean) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function SettingsPersistErrorToast({ signal, error }: { signal: number; error: unknown }) {
  const { t } = useTranslation();
  const { show: showToast } = useToast();

  useEffect(() => {
    if (signal === 0) return;
    const key = desktopErrorI18nKey(error, "toast.settings_save_failed" as I18nKey);
    showToast(t(key));
  }, [error, showToast, signal, t]);

  return null;
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const appSettingsService = useAppSettingsService();
  const [settings, setSettings] = useState<AppSettingsConfig>(() => createDefaultAppSettings());
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsOnDisk, setSettingsOnDisk] = useState(false);
  const [vaultRootEpoch, setVaultRootEpoch] = useState(0);
  const [showHiddenVaultsSession, setShowHiddenVaultsSession] = useState(false);
  const [persistErrorSignal, setPersistErrorSignal] = useState(0);
  const [persistError, setPersistError] = useState<unknown>(null);
  const settingsRef = useRef(settings);
  const settingsOnDiskRef = useRef(settingsOnDisk);
  const persistChainRef = useRef(Promise.resolve());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    settingsOnDiskRef.current = settingsOnDisk;
  }, [settingsOnDisk]);

  useEffect(() => {
    let cancelled = false;
    void appSettingsService
      .load()
      .then((loaded) => {
        if (!cancelled) {
          const normalized = normalizeAppSettings(loaded.settings);
          settingsRef.current = normalized;
          setSettings(normalized);
          setSettingsOnDisk(loaded.onDisk);
          setSettingsReady(true);
        }
      })
      .catch(async (loadError) => {
        if (import.meta.env.DEV) {
          console.error("app_settings load failed", loadError);
        }
        if (cancelled) return;
        // Hard RPC/I/O failure: do not silently recover via alias (M11).
        // Soft `onDisk: false` with defaults is only for a successful load of bootstrap defaults.
        const defaults = createDefaultAppSettings();
        settingsRef.current = defaults;
        setSettings(defaults);
        setSettingsOnDisk(false);
        setSettingsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appSettingsService]);

  const reloadSettings = useCallback(async () => {
    const loaded = await appSettingsService.load();
    const normalized = normalizeAppSettings(loaded.settings);
    settingsRef.current = normalized;
    setSettings(normalized);
    setSettingsOnDisk(loaded.onDisk);
  }, [appSettingsService]);

  const notifyPersistFailed = useCallback((error: unknown) => {
    setPersistError(error);
    setPersistErrorSignal((count) => count + 1);
  }, []);

  const enqueuePersist = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const queued = persistChainRef.current.then(task, task);
    persistChainRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, []);

  const persistUnlocked = useCallback(
    async (next: AppSettingsConfig, options?: PersistOptions) => {
      const previous = settingsRef.current;
      const normalized = normalizeAppSettings(next);
      const rootModeChanged =
        previous.app.vault_root_mode !== normalized.app.vault_root_mode ||
        previous.app.upriv_root_path !== normalized.app.upriv_root_path;

      try {
        if (
          normalized.app.vault_root_mode === "custom_root" &&
          !normalized.app.upriv_root_path.trim()
        ) {
          throw new RpcError(
            "invalid_request",
            "custom_root mode requires a non-empty upriv_root_path",
          );
        }

        // Vault-root disk changes belong to Data folder / Gate modals (setup* first).
        // After setup*, callers pass vaultRootAlreadyApplied and we only reload.
        if (rootModeChanged && !options?.vaultRootAlreadyApplied) {
          throw new RpcError(
            "invalid_request",
            "vault-root mode/path changes require setup* then vaultRootAlreadyApplied",
          );
        }

        // Bootstrap / broken alias: no writable `.upriv/settings.toml` yet (`onDisk: false`).
        // Keep UI prefs (locale, theme, …) in memory only until a root exists; creating a
        // new root stamps locale via setup*, then we reload that root’s TOML.
        if (!settingsOnDiskRef.current && !options?.vaultRootAlreadyApplied) {
          settingsRef.current = normalized;
          setSettings(normalized);
          return;
        }

        // After switching/creating a vault-root, adopt THAT root’s settings.toml.
        // Never write the previous session’s theme/locale into a selected existing folder.
        if (options?.vaultRootAlreadyApplied) {
          await reloadSettings();
          setVaultRootEpoch((n) => n + 1);
          return;
        }

        const wrote = await appSettingsService.save(normalized, { syncAlias: true });
        settingsRef.current = normalized;
        setSettings(normalized);
        if (wrote) {
          setSettingsOnDisk(true);
        }
      } catch (error) {
        // Disk/alias may already match the new root (Gate / Data folder setup).
        // Prefer adopting that root’s TOML over keeping previous-session memory.
        if (options?.vaultRootAlreadyApplied) {
          try {
            await reloadSettings();
          } catch {
            // Fall through to toast; caller still sees the original error.
          }
          // Setup may already have changed the on-disk root — always re-resolve Gate.
          setVaultRootEpoch((n) => n + 1);
          notifyPersistFailed(error);
          throw error;
        }
        await reloadSettings();
        notifyPersistFailed(error);
        // Preserve RpcError codes for UI mapping (do not collapse to settings_save_failed).
        throw error;
      }
    },
    [appSettingsService, notifyPersistFailed, reloadSettings],
  );

  const replaceSettings = useCallback(
    async (next: AppSettingsConfig, options?: PersistOptions) => {
      await enqueuePersist(() => persistUnlocked(next, options));
    },
    [enqueuePersist, persistUnlocked],
  );

  const patchSettings = useCallback(
    async (patch: AppSettingsPatch, options?: PersistOptions): Promise<boolean> => {
      return enqueuePersist(async () => {
        const current = settingsRef.current;
        const next = normalizeAppSettings({
          ...current,
          ui: patch.ui ? { ...current.ui, ...patch.ui } : current.ui,
          logging: patch.logging ? { ...current.logging, ...patch.logging } : current.logging,
          app: patch.app ? { ...current.app, ...patch.app } : current.app,
        });
        try {
          await persistUnlocked(next, options);
          return true;
        } catch {
          // persistUnlocked already reloaded and signaled toast
          return false;
        }
      });
    },
    [enqueuePersist, persistUnlocked],
  );

  const value = useMemo(
    () => ({
      settings,
      settingsReady,
      settingsOnDisk,
      vaultRootEpoch,
      replaceSettings,
      patchSettings,
      reloadSettings,
      showHiddenVaultsSession,
      setShowHiddenVaultsSession,
    }),
    [
      settings,
      settingsReady,
      settingsOnDisk,
      vaultRootEpoch,
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
        <SettingsPersistErrorToast signal={persistErrorSignal} error={persistError} />
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
