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
import {
  createDefaultAppSettings,
  normalizeAppSettings,
  RpcError,
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
} from "@upriv/shared";
import type { AppSettingsConfig, AppSettingsPatch, IncompleteReplacePolicy } from "@upriv/shared";
import { useToast } from "@/hooks/useToast";
import { useVaultRootService } from "@/platform/services";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import type { I18nKey } from "@/i18n";

interface PersistOptions {
  /** When incomplete `.upriv/` must be replaced (nearby or custom path). */
  replacePolicy?: IncompleteReplacePolicy;
  /**
   * UI already ran `setupNearby` / `setupAtPath`.
   * Persist only settings.toml — do not re-sync alias (single writer).
   */
  vaultRootAlreadyApplied?: boolean;
}

function isVaultRootIncomplete(error: unknown): boolean {
  if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) return true;
  // Fallback when IPC Error was not re-wrapped as RpcError (Electron prefixes the message).
  if (error instanceof Error) {
    return (
      error.message === VAULT_ROOT_ERROR_CODES.INCOMPLETE ||
      error.message.startsWith(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`) ||
      error.message.includes(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`)
    );
  }
  return false;
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
  const vaultRootService = useVaultRootService();
  const [settings, setSettings] = useState<AppSettingsConfig>(() => createDefaultAppSettings());
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsOnDisk, setSettingsOnDisk] = useState(false);
  const [vaultRootEpoch, setVaultRootEpoch] = useState(0);
  const [showHiddenVaultsSession, setShowHiddenVaultsSession] = useState(false);
  const [persistErrorSignal, setPersistErrorSignal] = useState(0);
  const [persistError, setPersistError] = useState<unknown>(null);
  const settingsRef = useRef(settings);
  const persistChainRef = useRef(Promise.resolve());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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
      .catch(async () => {
        if (import.meta.env.DEV) {
          console.error("app_settings load failed");
        }
        if (cancelled) return;
        // Prefer recovering from an active alias over forcing nearby defaults.
        try {
          const alias = await vaultRootService.readAlias();
          if (alias?.active && alias.path.trim()) {
            const defaults = createDefaultAppSettings();
            const recovered = normalizeAppSettings({
              ...defaults,
              app: {
                ...defaults.app,
                vault_root_mode: "custom",
                upriv_root_path: alias.path.trim(),
              },
            });
            settingsRef.current = recovered;
            setSettings(recovered);
            setSettingsOnDisk(false);
            setSettingsReady(true);
            return;
          }
        } catch {
          if (import.meta.env.DEV) {
            console.error("alias recovery after settings load failed");
          }
        }
        // No recoverable alias — first-run nearby defaults.
        const defaults = createDefaultAppSettings();
        settingsRef.current = defaults;
        setSettings(defaults);
        setSettingsOnDisk(false);
        setSettingsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appSettingsService, vaultRootService]);

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
        // Apply vault-root on disk *before* flipping settings — unless the caller
        // (Setup/Repair Gate) already did setupNearby/setupAtPath (single writer).
        const needsVaultRootMutation =
          (rootModeChanged || options?.replacePolicy != null) && !options?.vaultRootAlreadyApplied;
        if (needsVaultRootMutation) {
          if (normalized.app.vault_root_mode === "nearby") {
            // Inspect nearby before mutating. setupNearby deactivates the alias after init.
            const nearby = await vaultRootService.nearbyStatus();
            if (nearby.status === "unreadable") {
              throw new RpcError(VAULT_ROOT_ERROR_CODES.IO_ERROR, "nearby .upriv is unreadable");
            }
            // Never replace incomplete without an explicit UI policy (rename | delete).
            if (nearby.status === "incomplete" && options?.replacePolicy == null) {
              throw new RpcError(VAULT_ROOT_ERROR_CODES.INCOMPLETE, "nearby .upriv is incomplete");
            }
            await vaultRootService.setupNearby({
              replaceIncomplete: options?.replacePolicy != null,
              replacePolicy: options?.replacePolicy,
              locale: normalized.ui.locale,
            });
          } else {
            const path = normalized.app.upriv_root_path.trim();
            // setupAtPath: create `.upriv/` if missing, then write active alias.
            // Incomplete `.upriv/` requires replacePolicy from the UI (rename | delete).
            if (path) {
              await vaultRootService.setupAtPath(path, {
                replaceIncomplete: options?.replacePolicy != null,
                replacePolicy: options?.replacePolicy,
                locale: normalized.ui.locale,
              });
            }
          }
        }
        // Skip alias sync when setup/deactivate already applied (or we just mutated via setup*).
        const syncAlias = !(options?.vaultRootAlreadyApplied || needsVaultRootMutation);
        const wrote = await appSettingsService.save(normalized, { syncAlias });
        if (
          !wrote &&
          (needsVaultRootMutation || options?.vaultRootAlreadyApplied || rootModeChanged)
        ) {
          throw new RpcError("settings_save_failed", "settings save did not write to disk");
        }
        settingsRef.current = normalized;
        setSettings(normalized);
        if (wrote) {
          setSettingsOnDisk(true);
        }
        if (rootModeChanged || options?.replacePolicy != null || options?.vaultRootAlreadyApplied) {
          setVaultRootEpoch((n) => n + 1);
        }
      } catch (error) {
        // Disk may already match the new mode (Setup/Repair) — keep in-memory settings
        // aligned with disk; do not bump epoch or reload until save succeeds.
        if (options?.vaultRootAlreadyApplied) {
          settingsRef.current = normalized;
          setSettings(normalized);
          notifyPersistFailed(error);
          throw error;
        }
        // Let the settings modal offer rename/delete when the chosen folder is incomplete.
        if (isVaultRootIncomplete(error) && options?.replacePolicy == null) {
          throw error;
        }
        await reloadSettings();
        notifyPersistFailed(error);
        // Preserve RpcError codes for UI mapping (do not collapse to settings_save_failed).
        throw error;
      }
    },
    [appSettingsService, notifyPersistFailed, reloadSettings, vaultRootService],
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
