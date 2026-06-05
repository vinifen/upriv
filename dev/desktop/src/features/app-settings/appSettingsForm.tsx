import { useId } from "react";
import { Button } from "@/components/ui";
import type { LocaleId } from "@/i18n";
import { useTranslation } from "@/i18n";
import {
  PolicyRadioOption,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
} from "@/features/vault-list/vaultSettingsForm";
import { MOCK_UPRIV_ROOT_PATH } from "./mockAppSettings";
import type { AppSettingsConfig, LogLevel, UiTheme } from "./appSettingsTypes";

interface SectionPatchProps<S extends keyof AppSettingsConfig> {
  config: AppSettingsConfig[S];
  onChange: (patch: Partial<AppSettingsConfig[S]>) => void;
}

const LOCALES: LocaleId[] = ["en", "pt-BR"];
const THEMES: UiTheme[] = ["dark", "light"];
const LOG_LEVELS = ["error", "warn", "info", "debug"] as const satisfies readonly LogLevel[];

export function AppSettingsAppearanceSection({ config, onChange }: SectionPatchProps<"ui">) {
  const { t } = useTranslation();
  const localeGroup = useId();
  const themeGroup = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.appearance_intro")}
      </p>

      <SettingsField
        label={t("modal.app_settings.field.locale")}
        hint={t("modal.app_settings.field.locale_help")}
      >
        <div role="radiogroup" aria-label={t("modal.app_settings.field.locale")} className="grid gap-2">
          {LOCALES.map((locale) => (
            <PolicyRadioOption
              key={locale}
              groupName={localeGroup}
              value={locale}
              checked={config.locale === locale}
              title={t(`modal.app_settings.option.locale.${locale}`)}
              description={t(`modal.app_settings.option.locale.${locale}_desc`)}
              badge={locale === "en" ? "default" : undefined}
              onSelect={() => onChange({ locale })}
            />
          ))}
        </div>
      </SettingsField>

      <SettingsField
        label={t("modal.app_settings.field.theme")}
        hint={t("modal.app_settings.field.theme_help")}
      >
        <div role="radiogroup" aria-label={t("modal.app_settings.field.theme")} className="grid gap-2">
          {THEMES.map((theme) => (
            <PolicyRadioOption
              key={theme}
              groupName={themeGroup}
              value={theme}
              checked={config.theme === theme}
              title={t(`modal.app_settings.option.theme.${theme}`)}
              description={t(`modal.app_settings.option.theme.${theme}_desc`)}
              badge={theme === "dark" ? "default" : undefined}
              onSelect={() => onChange({ theme })}
            />
          ))}
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}

export function AppSettingsLoggingSection({ config, onChange }: SectionPatchProps<"logging">) {
  const { t } = useTranslation();
  const enabledId = useId();
  const levelGroup = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.logging_intro")}
      </p>

      <SettingsField
        label={t("modal.app_settings.field.logging_enabled")}
        hint={t("modal.app_settings.field.logging_enabled_help")}
        htmlFor={enabledId}
      >
        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            id={enabledId}
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-on-surface">{t("modal.app_settings.field.logging_enabled_label")}</span>
        </label>
      </SettingsField>

      <SettingsField
        label={t("modal.app_settings.field.logging_level")}
        hint={t("modal.app_settings.field.logging_level_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.logging_level")}
          className="grid gap-2"
        >
          {LOG_LEVELS.map((level) => (
            <PolicyRadioOption
              key={level}
              groupName={levelGroup}
              value={level}
              checked={config.level === level}
              title={t(`modal.app_settings.option.logging_level.${level}`)}
              description={t(`modal.app_settings.option.logging_level.${level}_desc`)}
              badge={level === "info" ? "recommended" : undefined}
              onSelect={() => onChange({ level })}
            />
          ))}
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}

export function AppSettingsBehaviorSection({ config, onChange }: SectionPatchProps<"app">) {
  const { t } = useTranslation();
  const autoDetectId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.behavior_intro")}
      </p>

      <SettingsField
        label={t("modal.app_settings.field.upriv_root")}
        hint={t("modal.app_settings.field.upriv_root_help")}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            type="text"
            readOnly
            value={config.upriv_root_path}
            placeholder={
              config.auto_detect_vault_root
                ? t("modal.app_settings.field.upriv_root_auto_placeholder")
                : t("modal.app_settings.field.upriv_root_placeholder")
            }
            className={[settingsControlClass, "font-mono text-xs sm:min-w-0 sm:flex-1"].join(" ")}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="w-full shrink-0 sm:w-auto"
            onClick={() =>
              onChange({
                upriv_root_path: MOCK_UPRIV_ROOT_PATH,
                auto_detect_vault_root: false,
              })
            }
          >
            {t("modal.app_settings.action.choose_folder")}
          </Button>
        </div>
      </SettingsField>

      <SettingsField
        label={t("modal.app_settings.field.auto_detect_upriv_root")}
        hint={t("modal.app_settings.field.auto_detect_upriv_root_help")}
        htmlFor={autoDetectId}
      >
        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            id={autoDetectId}
            type="checkbox"
            checked={config.auto_detect_vault_root}
            onChange={(e) => onChange({ auto_detect_vault_root: e.target.checked })}
            className="h-4 w-4 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
          />
          <span className="text-sm text-on-surface">{t("modal.app_settings.field.auto_detect_upriv_root_label")}</span>
        </label>
      </SettingsField>
    </SettingsFormGrid>
  );
}
