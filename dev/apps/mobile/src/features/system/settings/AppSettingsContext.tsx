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
  NO_LISTS_SAVED,
  createDefaultAppSettings,
  isEmptyAppListChanges,
  normalizeAppSettings,
  shouldBumpVaultRootEpoch,
  isVaultRootGoneError,
  RpcError,
  vaultRootGoneRpcError,
  type AppListChanges,
  type AppSettingsConfig,
  type AppSettingsPatch,
  type ListsSaved,
} from "@upriv/shared";
import { useAppSettingsService } from "@/platform/services";
import { I18nProvider } from "@/i18n";

interface PersistOptions {
  /** What changed in the app's folder lists: core applies it to the file as it is now. */
  lists?: AppListChanges;
  /**
   * Apply the patch in RAM only. Used when core already wrote the same field
   * (`vault_rename` patches `[app].last_opened_vault`).
   */
  memoryOnly?: boolean;
}

interface AppSettingsContextValue {
  settings: AppSettingsConfig;
  settingsReady: boolean;
  /**
   * True when `load()` threw (RPC/I/O). In-memory defaults are not bootstrap
   * `onDisk: false` — Gate must offer Retry instead of looking ready.
   */
  settingsLoadFailed: boolean;
  settingsOnDisk: boolean;
  vaultRootEpoch: number;
  /** Save `next`; resolves with what a list change left beyond `settings.toml`. */
  replaceSettings: (next: AppSettingsConfig, options?: PersistOptions) => Promise<ListsSaved>;
  patchSettings: (patch: AppSettingsPatch, options?: PersistOptions) => Promise<boolean>;
  reloadSettings: () => Promise<void>;
  /**
   * After an apply switched or made the data folder: read that folder's
   * `settings.toml`, never writing the previous session's prefs into it, and
   * have the Gate resolve again.
   */
  adoptDataFolder: () => Promise<void>;
  reportVaultRootIntegrityFailure: (error: unknown) => Promise<void>;
  /** Latest settings including in-flight patch results (sync; bypasses React render lag). */
  getSettingsSnapshot: () => AppSettingsConfig;
  showHiddenVaultsSession: boolean;
  setShowHiddenVaultsSession: (value: boolean) => void;
  /** Persist failure toast — render under ThemeProvider via SettingsPersistErrorToast. */
  persistErrorSignal: number;
  persistError: unknown;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const appSettingsService = useAppSettingsService();
  const [settings, setSettings] = useState<AppSettingsConfig>(() => createDefaultAppSettings());
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
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
        setSettingsLoadFailed(false);
        setSettingsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Hard RPC/I/O: keep in-memory defaults; do not mark ready as bootstrap.
        setSettingsOnDisk(false);
        setSettingsLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appSettingsService]);

  const reloadSettings = useCallback(async () => {
    setSettingsLoadFailed(false);
    try {
      const loaded = await appSettingsService.load();
      const normalized = normalizeAppSettings(loaded.settings);
      setSettingsOnDisk(loaded.onDisk);
      if (!loaded.onDisk) {
        // First-run / incomplete: keep RAM so the Gate locale picker still works.
        // A missing `.upriv` (case B) resets via `forgetVaultRootSession` instead.
        setSettingsReady(true);
        return;
      }
      settingsRef.current = normalized;
      setSettings(normalized);
      setSettingsReady(true);
    } catch (error) {
      setSettingsLoadFailed(true);
      throw error;
    }
  }, [appSettingsService]);

  const notifyPersistFailed = useCallback((error: unknown) => {
    setPersistError(error);
    setPersistErrorSignal((n) => n + 1);
  }, []);

  const forgetVaultRootSession = useCallback(() => {
    const defaults = createDefaultAppSettings();
    settingsRef.current = defaults;
    setSettings(defaults);
    setSettingsOnDisk(false);
    setSettingsLoadFailed(false);
    setSettingsReady(true);
  }, []);

  const applyVaultRootIntegrityFailure = useCallback(
    async (error: unknown) => {
      if (isVaultRootGoneError(error)) {
        forgetVaultRootSession();
      }
      if (shouldBumpVaultRootEpoch(error)) {
        setVaultRootEpoch((n) => n + 1);
      }
      if (!isVaultRootGoneError(error)) {
        try {
          await reloadSettings();
        } catch {
          /* keep memory */
        }
      }
      notifyPersistFailed(isVaultRootGoneError(error) ? vaultRootGoneRpcError() : error);
    },
    [forgetVaultRootSession, notifyPersistFailed, reloadSettings],
  );

  const reportVaultRootIntegrityFailure = useCallback(
    async (error: unknown) => {
      await applyVaultRootIntegrityFailure(error);
    },
    [applyVaultRootIntegrityFailure],
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
    async (next: AppSettingsConfig, options?: PersistOptions): Promise<ListsSaved> => {
      const normalized = normalizeAppSettings(next);

      if (options?.memoryOnly) {
        settingsRef.current = normalized;
        setSettings(normalized);
        return NO_LISTS_SAVED;
      }

      try {
        // No `.upriv/settings.toml` yet: keep UI prefs in memory only until a
        // data folder exists; making one stamps the locale.
        if (!settingsOnDiskRef.current) {
          settingsRef.current = normalized;
          setSettings(normalized);
          return NO_LISTS_SAVED;
        }

        const saved = await appSettingsService.save(normalized, options?.lists);
        if (!saved.wrote) {
          // `wrote: false` is only the first run with no data folder. After
          // onDisk it is an integrity failure.
          throw new RpcError(
            "vault_root_not_found",
            "settings save did not write: data folder missing",
          );
        }
        if (options?.lists && !isEmptyAppListChanges(options.lists)) {
          // Core applied the change to the lists as the file held them: read them back.
          await reloadSettings();
        } else {
          settingsRef.current = normalized;
          setSettings(normalized);
        }
        setSettingsOnDisk(true);
        return { unchangedVaults: saved.unchangedVaults, keptFolders: saved.keptFolders };
      } catch (error) {
        await applyVaultRootIntegrityFailure(error);
        throw error;
      }
    },
    [appSettingsService, applyVaultRootIntegrityFailure, reloadSettings],
  );

  const replaceSettings = useCallback(
    (next: AppSettingsConfig, options?: PersistOptions) =>
      enqueuePersist(() => persistUnlocked(next, options)),
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
          // persistUnlocked already reloaded and signaled the toast.
          return false;
        }
      });
    },
    [enqueuePersist, persistUnlocked],
  );

  const adoptDataFolder = useCallback(
    () =>
      enqueuePersist(async () => {
        try {
          await reloadSettings();
        } catch (error) {
          // The apply took place: the toast says the settings did not load.
          notifyPersistFailed(error);
        } finally {
          setVaultRootEpoch((n) => n + 1);
        }
      }),
    [enqueuePersist, notifyPersistFailed, reloadSettings],
  );

  const getSettingsSnapshot = useCallback(() => settingsRef.current, []);

  const value = useMemo(
    () => ({
      settings,
      settingsReady,
      settingsLoadFailed,
      settingsOnDisk,
      vaultRootEpoch,
      replaceSettings,
      patchSettings,
      reloadSettings,
      adoptDataFolder,
      reportVaultRootIntegrityFailure,
      getSettingsSnapshot,
      showHiddenVaultsSession,
      setShowHiddenVaultsSession,
      persistErrorSignal,
      persistError,
    }),
    [
      settings,
      settingsReady,
      settingsLoadFailed,
      settingsOnDisk,
      vaultRootEpoch,
      replaceSettings,
      patchSettings,
      reloadSettings,
      adoptDataFolder,
      reportVaultRootIntegrityFailure,
      getSettingsSnapshot,
      showHiddenVaultsSession,
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
