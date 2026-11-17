import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAppSettingsService } from "@/platform/services";
import { I18nProvider, useTranslation } from "@/i18n";
import { applyDocumentTheme } from "@/theme";
import {
  NO_LISTS_SAVED,
  createDefaultAppSettings,
  isEmptyAppListChanges,
  normalizeAppSettings,
  RpcError,
  isVaultRootGoneError,
  shouldBumpVaultRootEpoch,
  vaultRootGoneRpcError,
} from "@upriv/shared";
import type {
  AppListChanges,
  AppSettingsConfig,
  AppSettingsPatch,
  ListsSaved,
} from "@upriv/shared";
import { useToast } from "@upriv/shared/react";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { Toast } from "@/components/ui";
import type { I18nKey } from "@/i18n";

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
  /** False until the first successful `load()` finishes. */
  settingsReady: boolean;
  /**
   * True when `load()` threw (RPC/I/O). In-memory defaults are not bootstrap
   * `onDisk: false` — Gate must offer Retry instead of looking ready.
   */
  settingsLoadFailed: boolean;
  /** True when the last load came from on-disk settings.toml (not bootstrap defaults). */
  settingsOnDisk: boolean;
  /**
   * Bumped after vault-root setup/repair/recovery **or** mid-session root integrity
   * failure on persist — `VaultRootGate` re-resolves on this.
   */
  vaultRootEpoch: number;
  /** Save `next`; resolves with what a list change left beyond `settings.toml`. */
  replaceSettings: (next: AppSettingsConfig, options?: PersistOptions) => Promise<ListsSaved>;
  /** Persists a partial update. Returns `false` when save failed (toast already shown). */
  patchSettings: (patch: AppSettingsPatch, options?: PersistOptions) => Promise<boolean>;
  /** Reload settings.toml (or defaults) without persisting. */
  reloadSettings: () => Promise<void>;
  /**
   * After `data_folder_apply` switched or made the data folder: read that
   * folder's `settings.toml`, never writing the previous session's prefs into
   * it, and have the Gate resolve again.
   */
  adoptDataFolder: () => Promise<void>;
  /**
   * Mid-session vault-root A/B failure outside Settings save (e.g. Logs list):
   * bump Gate epoch, reload settings, toast. Caller closes its own modal.
   */
  reportVaultRootIntegrityFailure: (error: unknown) => Promise<void>;
  /** Latest settings including in-flight patch results (sync; bypasses React render lag). */
  getSettingsSnapshot: () => AppSettingsConfig;
  /** Session-only — not saved to settings.toml; resets when the app restarts. */
  showHiddenVaultsSession: boolean;
  setShowHiddenVaultsSession: (value: boolean) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function SettingsPersistErrorToast({ signal, error }: { signal: number; error: unknown }) {
  const { t } = useTranslation();
  const { toast, show: showToast, dismiss } = useToast();
  const errorRef = useRef(error);
  const tRef = useRef(t);
  const showToastRef = useRef(showToast);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    if (signal === 0) return;
    const key = desktopErrorI18nKey(errorRef.current, "toast.settings_save_failed" as I18nKey);
    showToastRef.current(tRef.current(key));
  }, [signal]);

  return <Toast toast={toast} onDismiss={dismiss} className="z-[220]" />;
}

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
        if (!cancelled) {
          const normalized = normalizeAppSettings(loaded.settings);
          settingsRef.current = normalized;
          setSettings(normalized);
          setSettingsOnDisk(loaded.onDisk);
          setSettingsLoadFailed(false);
          setSettingsReady(true);
        }
      })
      .catch((loadError) => {
        if (import.meta.env.DEV) {
          console.error("app_settings load failed", loadError);
        }
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
    setPersistErrorSignal((count) => count + 1);
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
          // Keep previous memory if reload also fails; still toast the original error.
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
        // No `.upriv/settings.toml` yet (`onDisk: false`): keep UI prefs (locale,
        // theme, …) in memory only until a data folder exists; making one stamps
        // the locale, then we reload that data folder's TOML.
        if (!settingsOnDiskRef.current) {
          settingsRef.current = normalized;
          setSettings(normalized);
          return NO_LISTS_SAVED;
        }

        const saved = await appSettingsService.save(normalized, options?.lists);
        if (!saved.wrote) {
          // `wrote: false` is only the first run with no data folder. After
          // onDisk it is an integrity failure.
          if (settingsOnDiskRef.current) {
            throw new RpcError(
              "vault_root_not_found",
              "settings save did not write: data folder missing",
            );
          }
          settingsRef.current = normalized;
          setSettings(normalized);
          return NO_LISTS_SAVED;
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
        // Preserve RpcError codes for UI mapping (do not collapse to settings_save_failed).
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
          // persistUnlocked already reloaded and signaled toast
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
    ],
  );

  useLayoutEffect(() => {
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
