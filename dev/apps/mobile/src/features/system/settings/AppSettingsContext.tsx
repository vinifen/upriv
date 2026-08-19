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
import {
  createDefaultAppSettings,
  isRpcError,
  isVaultRootErrorCode,
  normalizeAppSettings,
  RpcError,
  type AppSettingsConfig,
  type AppSettingsPatch,
} from "@upriv/shared";
import { useAppSettingsService } from "@/platform/services";
import { I18nProvider } from "@/i18n";

interface PersistOptions {
  vaultRootAlreadyApplied?: boolean;
}

interface AppSettingsContextValue {
  settings: AppSettingsConfig;
  settingsReady: boolean;
  settingsOnDisk: boolean;
  vaultRootEpoch: number;
  replaceSettings: (next: AppSettingsConfig, options?: PersistOptions) => Promise<void>;
  patchSettings: (patch: AppSettingsPatch, options?: PersistOptions) => Promise<boolean>;
  reloadSettings: () => Promise<void>;
  reportVaultRootIntegrityFailure: (error: unknown) => Promise<void>;
  showHiddenVaultsSession: boolean;
  setShowHiddenVaultsSession: (value: boolean) => void;
  bumpVaultRootEpoch: () => void;
  /** Persist failure toast — render under ThemeProvider via SettingsPersistErrorToast. */
  persistErrorSignal: number;
  persistError: unknown;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

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
        if (cancelled) return;
        const normalized = normalizeAppSettings(loaded.settings);
        settingsRef.current = normalized;
        setSettings(normalized);
        setSettingsOnDisk(loaded.onDisk);
        setSettingsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
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
    setSettingsReady(true);
  }, [appSettingsService]);

  const notifyPersistFailed = useCallback((error: unknown) => {
    setPersistError(error);
    setPersistErrorSignal((n) => n + 1);
  }, []);

  const reportVaultRootIntegrityFailure = useCallback(
    async (error: unknown) => {
      if (isRpcError(error) && isVaultRootErrorCode(error.code)) {
        setVaultRootEpoch((n) => n + 1);
      }
      try {
        await reloadSettings();
      } catch {
        /* keep memory */
      }
      notifyPersistFailed(error);
    },
    [notifyPersistFailed, reloadSettings],
  );

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

        // Vault-root disk changes belong to Data folder / Gate (setup* first).
        if (rootModeChanged && !options?.vaultRootAlreadyApplied) {
          throw new RpcError(
            "invalid_request",
            "vault-root mode/path changes require setup* then vaultRootAlreadyApplied",
          );
        }

        // No writable `.upriv/settings.toml` yet — keep UI prefs in memory only.
        if (!settingsOnDiskRef.current && !options?.vaultRootAlreadyApplied) {
          settingsRef.current = normalized;
          setSettings(normalized);
          return;
        }

        // After switching/creating a vault-root, adopt THAT root’s settings.toml.
        // Never write the previous session’s theme/locale into a selected folder.
        if (options?.vaultRootAlreadyApplied) {
          await reloadSettings();
          setVaultRootEpoch((n) => n + 1);
          return;
        }

        const wrote = await appSettingsService.save(normalized);
        if (!wrote) {
          if (settingsOnDiskRef.current) {
            throw new RpcError(
              "vault_root_not_found",
              "settings save did not write: vault-root missing",
            );
          }
          settingsRef.current = normalized;
          setSettings(normalized);
          return;
        }
        settingsRef.current = normalized;
        setSettings(normalized);
        setSettingsOnDisk(true);
      } catch (error) {
        if (options?.vaultRootAlreadyApplied) {
          try {
            await reloadSettings();
          } catch {
            /* ignore */
          }
          setVaultRootEpoch((n) => n + 1);
          notifyPersistFailed(error);
          throw error;
        }
        const rootIntegrity = isRpcError(error) && isVaultRootErrorCode(error.code);
        if (rootIntegrity) setVaultRootEpoch((n) => n + 1);
        try {
          await reloadSettings();
        } catch {
          /* ignore */
        }
        notifyPersistFailed(error);
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
        } catch (error) {
          // Vault-root Apply needs the real RpcError for i18n; other callers keep boolean.
          if (options?.vaultRootAlreadyApplied) throw error;
          return false;
        }
      });
    },
    [enqueuePersist, persistUnlocked],
  );

  const bumpVaultRootEpoch = useCallback(() => {
    setVaultRootEpoch((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({
      settings,
      settingsReady,
      settingsOnDisk,
      vaultRootEpoch,
      replaceSettings,
      patchSettings,
      reloadSettings,
      reportVaultRootIntegrityFailure,
      showHiddenVaultsSession,
      setShowHiddenVaultsSession,
      bumpVaultRootEpoch,
      persistErrorSignal,
      persistError,
    }),
    [
      settings,
      settingsReady,
      settingsOnDisk,
      vaultRootEpoch,
      replaceSettings,
      patchSettings,
      reloadSettings,
      reportVaultRootIntegrityFailure,
      showHiddenVaultsSession,
      bumpVaultRootEpoch,
      persistErrorSignal,
      persistError,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      <I18nProvider locale={settings.ui.locale}>{children}</I18nProvider>
    </AppSettingsContext.Provider>
  );
}

export function useAppSettingsContext(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettingsContext must be used within AppSettingsProvider");
  return ctx;
}
