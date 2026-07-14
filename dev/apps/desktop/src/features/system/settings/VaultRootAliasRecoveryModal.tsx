import { useCallback, useEffect, useId, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { SUPPORTED_LOCALES, VAULT_ROOT_ALIAS_FILE, type LocaleId } from "@upriv/shared";
import { useAppSettingsService, useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { desktopErrorI18nKey } from "@/lib/errorMessages";

interface VaultRootAliasRecoveryModalProps {
  open: boolean;
  /** Path remembered in `.upriv-root` (may be empty). */
  rememberedPath: string;
  onRecovered: () => void;
  /** Nearby incomplete while switching to auto — hand off to Gate repair. */
  onNearbyIncomplete: (nearbyAnchor: string) => void;
}

type Mode = "auto" | "fixed";

/**
 * Blocking when fixed alias / path is invalid or missing.
 * Radios + Continue (same pattern as first-run setup and settings).
 */
export function VaultRootAliasRecoveryModal({
  open,
  rememberedPath,
  onRecovered,
  onNearbyIncomplete,
}: VaultRootAliasRecoveryModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const appSettingsService = useAppSettingsService();
  const { settings, patchSettings } = useAppSettingsContext();
  const rootModeGroup = useId();
  const [mode, setMode] = useState<Mode>("auto");
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("auto");
    setPathInput(rememberedPath.trim());
    setBusy(false);
    setError(null);
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
          setPathInput(
            rememberedPath.trim() || appSettingsService.getDefaultRootPathSuggestion(),
          );
        }
      })
      .catch((caught) => {
        setError(t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_pick")));
      })
      .finally(() => setBusy(false));
  }, [appSettingsService, pathInput, rememberedPath, t, vaultRoot]);

  const handleContinue = useCallback(() => {
    setBusy(true);
    setError(null);
    void (async () => {
      if (mode === "auto") {
        const nearby = await vaultRoot.nearbyStatus();
        if (nearby.status === "incomplete") {
          onNearbyIncomplete(nearby.nearbyAnchor);
          return;
        }
        if (nearby.status === "unreadable") {
          throw new Error("io_error: nearby .upriv is unreadable");
        }
        await vaultRoot.setupNearby({ locale: settings.ui.locale });
        const saved = await patchSettings(
          {
            app: {
              auto_detect_vault_root: true,
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
      if (!path) {
        setError(t("modal.vault_root_setup.error_path_required"));
        return;
      }
      const { rootPath } = await vaultRoot.setupAtPath(path, {
        locale: settings.ui.locale,
      });
      const saved = await patchSettings(
        {
          app: {
            auto_detect_vault_root: false,
            upriv_root_path: rootPath,
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (!saved) throw new Error("settings_save_failed");
      onRecovered();
    })()
      .catch((caught) => {
        const key =
          mode === "fixed"
            ? "modal.vault_root_setup.error_pick"
            : "modal.vault_root_setup.error_init";
        setError(t(desktopErrorI18nKey(caught, key)));
      })
      .finally(() => setBusy(false));
  }, [
    mode,
    onNearbyIncomplete,
    onRecovered,
    patchSettings,
    pathInput,
    settings.ui.locale,
    t,
    vaultRoot,
  ]);

  if (!open) return null;

  const continueDisabled = busy || (mode === "fixed" && !pathInput.trim());

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
            value="auto"
            checked={mode === "auto"}
            title={t("modal.app_settings.option.upriv_root.auto")}
            description={t("modal.vault_root_setup.recovery_auto_desc")}
            badge="default"
            onSelect={() => {
              setMode("auto");
              setError(null);
            }}
          />
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="fixed"
            checked={mode === "fixed"}
            title={t("modal.app_settings.option.upriv_root.fixed")}
            description={t("modal.app_settings.option.upriv_root.fixed_desc", {
              file: VAULT_ROOT_ALIAS_FILE,
            })}
            onSelect={() => {
              setMode("fixed");
              setError(null);
              if (!pathInput.trim() && rememberedPath.trim()) {
                setPathInput(rememberedPath.trim());
              }
            }}
            footer={
              mode === "fixed" ? (
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
