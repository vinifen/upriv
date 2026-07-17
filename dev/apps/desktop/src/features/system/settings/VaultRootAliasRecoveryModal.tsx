import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass } from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  RpcError,
  isRpcError,
  type LocaleId,
  type VaultRootMode,
} from "@upriv/shared";
import { useAppSettingsService, useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";

interface VaultRootAliasRecoveryModalProps {
  open: boolean;
  /** Path remembered in `.upriv-root` (may be empty). */
  rememberedPath: string;
  onRecovered: () => void;
  /** Nearby incomplete while switching to nearby mode — hand off to Gate repair. */
  onNearbyIncomplete: (nearbyAnchor: string) => void;
  /** Custom-path incomplete — hand off to Gate repair. */
  onCustomIncomplete: (path: string) => void;
}

function isIncompleteError(error: unknown): boolean {
  if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) return true;
  if (error instanceof Error) {
    return (
      error.message === VAULT_ROOT_ERROR_CODES.INCOMPLETE ||
      error.message.startsWith(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`) ||
      error.message.includes(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`)
    );
  }
  return false;
}

/**
 * Blocking when custom alias / path is invalid or missing.
 * Radios + Continue (same pattern as first-run setup and settings).
 */
export function VaultRootAliasRecoveryModal({
  open,
  rememberedPath,
  onRecovered,
  onNearbyIncomplete,
  onCustomIncomplete,
}: VaultRootAliasRecoveryModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const appSettingsService = useAppSettingsService();
  const { settings, patchSettings } = useAppSettingsContext();
  const rootModeGroup = useId();
  const [mode, setMode] = useState<VaultRootMode>("nearby");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const diskApplied = useRef<{ rootPath: string; mode: VaultRootMode } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("nearby");
    setPathInput(rememberedPath.trim());
    setBusy(false);
    setError(null);
    submitLock.current = false;
    diskApplied.current = null;
  }, [open, rememberedPath]);

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const handlePickFolder = useCallback(() => {
    setBusy(true);
    setError(null);
    void vaultRoot
      .pickFolder(
        pathInput.trim() || rememberedPath.trim() || null,
        t("modal.vault_root_setup.pick_folder_title"),
      )
      .then((picked) => {
        if (picked) setPathInput(picked);
        else if (!pathInput.trim()) {
          setPathInput(rememberedPath.trim() || appSettingsService.getDefaultRootPathSuggestion());
        }
      })
      .catch((caught) => {
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => setBusy(false));
  }, [appSettingsService, pathInput, rememberedPath, t, vaultRoot]);

  const handleContinue = useCallback(() => {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      if (mode === "nearby") {
        if (!diskApplied.current) {
          const nearby = await vaultRoot.nearbyStatus();
          if (nearby.status === "incomplete") {
            onNearbyIncomplete(nearby.nearbyAnchor);
            return;
          }
          if (nearby.status === "unreadable") {
            throw new RpcError(VAULT_ROOT_ERROR_CODES.IO_ERROR, "nearby .upriv is unreadable");
          }
          const { rootPath } = await vaultRoot.setupNearby({ locale: settings.ui.locale });
          diskApplied.current = { rootPath, mode: "nearby" };
        }
        const saved = await patchSettings(
          {
            app: {
              vault_root_mode: "nearby",
              upriv_root_path: "",
            },
          },
          { vaultRootAlreadyApplied: true },
        );
        if (!saved) throw new Error("settings_save_failed");
        onRecovered();
        return;
      }

      const path = pathInput.trim();
      if (!path && !diskApplied.current) {
        setError(t("modal.vault_root_setup.error_path_required"));
        return;
      }

      if (!diskApplied.current) {
        try {
          const inspected = await vaultRoot.inspectAtPath(path);
          if (inspected.status === "incomplete") {
            onCustomIncomplete(path);
            return;
          }
        } catch (caught) {
          if (isIncompleteError(caught)) {
            onCustomIncomplete(path);
            return;
          }
          // Inspect I/O — still try setup; Incomplete from setup is handled below.
        }
        try {
          const { rootPath } = await vaultRoot.setupAtPath(path, {
            locale: settings.ui.locale,
          });
          diskApplied.current = { rootPath, mode: "custom" };
          const saved = await patchSettings(
            {
              app: {
                vault_root_mode: "custom",
                upriv_root_path: rootPath,
              },
            },
            { vaultRootAlreadyApplied: true },
          );
          if (!saved) throw new Error("settings_save_failed");
          onRecovered();
          return;
        } catch (caught) {
          if (isIncompleteError(caught)) {
            onCustomIncomplete(path);
            return;
          }
          throw caught;
        }
      }

      // Disk already applied — retry settings save with canonical rootPath.
      const applied = diskApplied.current;
      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: applied.mode,
            upriv_root_path: applied.mode === "custom" ? applied.rootPath : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (!saved) throw new Error("settings_save_failed");
      onRecovered();
    })()
      .catch((caught) => {
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        submitLock.current = false;
        setBusy(false);
      });
  }, [
    mode,
    onCustomIncomplete,
    onNearbyIncomplete,
    onRecovered,
    patchSettings,
    pathInput,
    settings.ui.locale,
    t,
    vaultRoot,
  ]);

  if (!open) return null;

  const continueDisabled = busy || (mode === "custom" && !pathInput.trim());

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_setup.title")}
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      rootClassName="z-[200]"
      headerActions={
        <label className="flex items-center gap-1.5">
          <span className="sr-only">{t("modal.app_settings.field.locale")}</span>
          <select
            value={settings.ui.locale}
            disabled={busy}
            aria-label={t("modal.app_settings.field.locale")}
            onChange={(event) => handleLocaleChange(event.target.value as LocaleId)}
            className="h-9 max-w-[9.5rem] rounded-lg border border-transparent bg-surface-container-highest px-2 text-xs text-on-surface outline-none focus:border-[var(--accent)] disabled:opacity-60 sm:h-10 sm:max-w-[11rem] sm:text-sm"
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {t(`modal.app_settings.option.locale.${locale}`)}
              </option>
            ))}
          </select>
        </label>
      }
      footer={
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="md"
            disabled={continueDisabled}
            className="w-full sm:w-auto"
            onClick={handleContinue}
          >
            {t("action.continue")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-on-surface-variant">
        <p role="alert">{t("modal.vault_root_setup.error_alias_invalid")}</p>
        {rememberedPath.trim() ? (
          <p className="font-mono text-xs break-all text-on-surface">
            {t("modal.vault_root_setup.alias_invalid_path", {
              path: rememberedPath.trim(),
              file: VAULT_ROOT_ALIAS_FILE,
            })}
          </p>
        ) : null}
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.upriv_root_mode")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="nearby"
            checked={mode === "nearby"}
            title={t("modal.app_settings.option.upriv_root.nearby")}
            description={t("modal.vault_root_setup.recovery_nearby_desc")}
            badge="default"
            onSelect={() => {
              setMode("nearby");
              setError(null);
            }}
          />
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="custom"
            checked={mode === "custom"}
            title={t("modal.app_settings.option.upriv_root.custom")}
            description={t("modal.app_settings.option.upriv_root.custom_desc", {
              file: VAULT_ROOT_ALIAS_FILE,
            })}
            onSelect={() => {
              setMode("custom");
              setError(null);
              if (!pathInput.trim() && rememberedPath.trim()) {
                setPathInput(rememberedPath.trim());
              }
            }}
            footer={
              mode === "custom" ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <input
                    type="text"
                    readOnly
                    value={pathInput}
                    placeholder={t("modal.vault_root_setup.path_placeholder")}
                    aria-invalid={error ? true : undefined}
                    className={[
                      settingsControlClass,
                      "font-mono text-xs sm:min-w-0 sm:flex-1",
                    ].join(" ")}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    className="w-full shrink-0 sm:w-auto"
                    disabled={busy}
                    onClick={handlePickFolder}
                  >
                    {t("modal.app_settings.action.choose_folder")}
                  </Button>
                </div>
              ) : null
            }
          />
        </div>
        {busy ? (
          <p className="sr-only" role="status" aria-live="polite">
            {t("modal.vault_root_setup.busy")}
          </p>
        ) : null}
        {error ? (
          <p
            className="rounded-md bg-error-container/10 px-3 py-2 text-sm text-on-error-container"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
