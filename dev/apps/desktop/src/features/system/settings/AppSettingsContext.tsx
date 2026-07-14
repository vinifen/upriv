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
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
} from "@upriv/shared";
import type { AppSettingsConfig, AppSettingsPatch, IncompleteReplacePolicy } from "@upriv/shared";
import { useToast } from "@/hooks/useToast";
import { useVaultRootService } from "@/platform/services";

interface PersistOptions {
  /** When incomplete `.upriv/` must be replaced (nearby auto or fixed path). */
  replacePolicy?: IncompleteReplacePolicy;
  /**
   * UI already ran `setupNearby` / `setupAtPath` / `deactivateAlias`.
   * Persist only settings.toml + alias sync via save — do not mutate vault-root again.
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
  const vaultRootService = useVaultRootService();
  const [settings, setSettings] = useState<AppSettingsConfig>(() => createDefaultAppSettings());
  const [settingsReady, setSettingsReady] = useState(false);
  const [vaultRootEpoch, setVaultRootEpoch] = useState(0);
  const [showHiddenVaultsSession, setShowHiddenVaultsSession] = useState(false);
  const [persistErrorSignal, setPersistErrorSignal] = useState(0);
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
          const normalized = normalizeAppSettings(loaded);
          settingsRef.current = normalized;
          setSettings(normalized);
          setSettingsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const defaults = createDefaultAppSettings();
          settingsRef.current = defaults;
          setSettings(defaults);
          setSettingsReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appSettingsService]);

  const reloadSettings = useCallback(async () => {
    const loaded = await appSettingsService.load();
    const normalized = normalizeAppSettings(loaded);
    settingsRef.current = normalized;
    setSettings(normalized);
  }, [appSettingsService]);

  const notifyPersistFailed = useCallback(() => {
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
        previous.app.auto_detect_vault_root !== normalized.app.auto_detect_vault_root ||
        previous.app.upriv_root_path !== normalized.app.upriv_root_path;

      try {
        // Apply vault-root on disk *before* flipping settings — unless the caller
        // (Setup/Repair Gate) already did setupNearby/setupAtPath (single writer).
        const needsVaultRootMutation =
          (rootModeChanged || options?.replacePolicy != null) && !options?.vaultRootAlreadyApplied;
        if (needsVaultRootMutation) {
          if (normalized.app.auto_detect_vault_root) {
            await vaultRootService.deactivateAlias();
            const nearby = await vaultRootService.nearbyStatus();
            if (nearby.status === "unreadable") {
              throw new Error("io_error: nearby .upriv is unreadable");
            }
            // Never replace incomplete without an explicit UI policy (rename | delete).
            if (nearby.status === "incomplete" && options?.replacePolicy == null) {
              throw new Error(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}: nearby .upriv is incomplete`);
            }
            await vaultRootService.setupNearby({
              replaceIncomplete: options?.replacePolicy != null,
              replacePolicy: options?.replacePolicy,
            });
          } else {
            const path = normalized.app.upriv_root_path.trim();
            // setupAtPath: create `.upriv/` if missing, then write active alias.
            // Incomplete `.upriv/` requires replacePolicy from the UI (rename | delete).
            if (path) {
              await vaultRootService.setupAtPath(path, {
                replaceIncomplete: options?.replacePolicy != null,
                replacePolicy: options?.replacePolicy,
              });
            }
          }
        }
        await appSettingsService.save(normalized);
        settingsRef.current = normalized;
        setSettings(normalized);
        if (rootModeChanged || options?.replacePolicy != null || options?.vaultRootAlreadyApplied) {
          setVaultRootEpoch((n) => n + 1);
        }
      } catch (error) {
        // Disk may already match the new mode (Setup/Repair) — still re-resolve.
        if (options?.vaultRootAlreadyApplied) {
          setVaultRootEpoch((n) => n + 1);
        }
        // Let the settings modal offer rename/delete when the chosen folder is incomplete.
        if (isVaultRootIncomplete(error) && options?.replacePolicy == null) {
          throw error;
        }
        await reloadSettings();
        notifyPersistFailed();
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
