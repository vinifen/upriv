import { useEffect, useId, useMemo, useState } from "react";
import { Button, Switch } from "@/components/ui";
import type { LocaleId } from "@/i18n";
import { useTranslation } from "@/i18n";
import type { VaultListItem } from "@/features/vault-list/types";
import { resolveVaultDisplayStatus } from "@/types";
import { vaultStatusI18nKey } from "@/theme/vault-status";
import {
  downloadVaultsZip,
  listVaultsBlockingBulkExport,
  listVaultsReadyForBulkExport,
  vaultBlocksBulkExport,
} from "./vaultBulkExport";

const vaultCheckboxClass =
  "h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40";
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
const THEMES: UiTheme[] = ["dark", "neutral", "light"];
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

interface AppSettingsHiddenVaultsSectionProps {
  alwaysShowHiddenVaults: boolean;
  onAlwaysShowHiddenVaultsChange: (value: boolean) => void;
  showHiddenVaultsSession: boolean;
  onShowHiddenVaultsSessionChange: (value: boolean) => void;
}

export function AppSettingsHiddenVaultsSection({
  alwaysShowHiddenVaults,
  onAlwaysShowHiddenVaultsChange,
  showHiddenVaultsSession,
  onShowHiddenVaultsSessionChange,
}: AppSettingsHiddenVaultsSectionProps) {
  const { t } = useTranslation();
  const showHiddenSessionId = useId();
  const alwaysShowHiddenId = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.hidden_vaults_intro")}
      </p>

      <label
        htmlFor={showHiddenSessionId}
        className="flex cursor-pointer select-none items-center gap-3"
      >
        <Switch
          id={showHiddenSessionId}
          checked={showHiddenVaultsSession}
          onChange={onShowHiddenVaultsSessionChange}
          label={t("modal.app_settings.field.show_hidden_vaults_session")}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-on-surface">
            {t("modal.app_settings.field.show_hidden_vaults_session")}
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-on-surface-variant">
            {t("modal.app_settings.field.show_hidden_vaults_session_help")}
          </span>
        </span>
      </label>

      <label
        htmlFor={alwaysShowHiddenId}
        className="flex cursor-pointer select-none items-center gap-3"
      >
        <input
          id={alwaysShowHiddenId}
          type="checkbox"
          checked={alwaysShowHiddenVaults}
          onChange={(e) => onAlwaysShowHiddenVaultsChange(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-outline-variant/50 text-accent focus:ring-accent/50"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-on-surface">
            {t("modal.app_settings.field.always_show_hidden_vaults")}
          </span>
          <span className="mt-1.5 block text-xs leading-relaxed text-on-surface-variant">
            {t("modal.app_settings.field.always_show_hidden_vaults_help")}
          </span>
        </span>
      </label>
    </SettingsFormGrid>
  );
}

interface AppSettingsDownloadVaultsSectionProps {
  vaults: VaultListItem[];
  /** Resets transient checklist when the system settings modal opens. */
  modalOpen: boolean;
}

export function AppSettingsDownloadVaultsSection({
  vaults,
  modalOpen,
}: AppSettingsDownloadVaultsSectionProps) {
  const { t } = useTranslation();
  const selectAllId = useId();

  const sortedVaults = useMemo(
    () => [...vaults].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })),
    [vaults],
  );
  const blockingVaults = useMemo(() => listVaultsBlockingBulkExport(vaults), [vaults]);
  const readyVaults = useMemo(() => listVaultsReadyForBulkExport(vaults), [vaults]);
  const readyIds = useMemo(() => readyVaults.map((vault) => vault.id), [readyVaults]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!modalOpen) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(readyIds));
  }, [modalOpen, readyIds]);

  const allReadySelected =
    readyVaults.length > 0 && readyVaults.every((vault) => selected.has(vault.id));
  const someReadySelected = readyVaults.some((vault) => selected.has(vault.id));
  const selectedReady = useMemo(
    () => readyVaults.filter((vault) => selected.has(vault.id)),
    [readyVaults, selected],
  );
  const canDownload = selectedReady.length > 0;

  const toggleVault = (vaultId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(vaultId)) next.delete(vaultId);
      else next.add(vaultId);
      return next;
    });
  };

  const toggleSelectAllReady = () => {
    if (allReadySelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(readyIds));
  };

  const handleDownload = () => {
    if (!canDownload) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadVaultsZip(
      selectedReady,
      t("modal.app_settings.download_vaults_zip_name", { date: stamp }),
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-xs leading-snug text-on-surface-variant">
        {t("modal.app_settings.section.download_vaults_intro")}
      </p>

      {blockingVaults.length > 0 ? (
        <p
          className="rounded-md bg-error-container/10 px-2 py-1.5 text-[11px] leading-snug text-on-error-container"
          role="alert"
        >
          <span className="font-medium">{t("warning.download_vaults_open_title")}</span>
          <span className="text-on-error-container/85"> — {t("warning.download_vaults_open_body")}</span>
        </p>
      ) : null}

      {vaults.length === 0 ? (
        <p className="text-xs text-on-surface-variant">{t("modal.app_settings.download_vaults_empty")}</p>
      ) : (
        <div className="space-y-0.5">
          {readyVaults.length > 0 ? (
            <label
              htmlFor={selectAllId}
              className="flex cursor-pointer select-none items-center gap-2.5 py-1"
            >
              <input
                id={selectAllId}
                type="checkbox"
                checked={allReadySelected}
                ref={(node) => {
                  if (node) node.indeterminate = someReadySelected && !allReadySelected;
                }}
                onChange={toggleSelectAllReady}
                className={vaultCheckboxClass}
              />
              <span className="text-xs text-on-surface-variant">{t("modal.app_settings.select_all_vaults")}</span>
            </label>
          ) : null}

          <ul className="max-h-[min(13rem,36vh)] space-y-0.5 overflow-y-auto">
            {sortedVaults.map((vault) => {
              const blocked = vaultBlocksBulkExport(vault);
              const checkboxId = `download-vault-${vault.id}`;
              const status = resolveVaultDisplayStatus(vault);

              return (
                <li key={vault.id} className={blocked ? "opacity-60" : ""}>
                  <label
                    htmlFor={checkboxId}
                    className={[
                      "flex cursor-pointer select-none items-center gap-2.5 rounded-md py-1",
                      blocked ? "cursor-not-allowed" : "hover:bg-surface-container-high/40",
                    ].join(" ")}
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={!blocked && selected.has(vault.id)}
                      disabled={blocked}
                      onChange={() => toggleVault(vault.id)}
                      className={vaultCheckboxClass}
                    />
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="truncate text-xs text-on-surface">{vault.displayName}</span>
                      {blocked ? (
                        <span className="shrink-0 text-[10px] text-on-error-container/85">
                          ({t(vaultStatusI18nKey[status])})
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!canDownload} onClick={handleDownload}>
          {selectedReady.length === readyVaults.length && readyVaults.length > 0
            ? t("modal.app_settings.action.download_all_vaults")
            : t("modal.app_settings.action.download_vaults_selected")}
        </Button>
        {someReadySelected ? (
          <span className="text-[11px] tabular-nums text-on-surface-variant">
            {t("modal.app_settings.download_vaults_selected_count", {
              count: String(selectedReady.length),
            })}
          </span>
        ) : null}
      </div>
    </div>
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
  const rootModeGroup = useId();
  const useAutoDetect = config.auto_detect_vault_root;

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.app_settings.section.behavior_intro")}
      </p>

      <SettingsField
        label={t("modal.app_settings.field.upriv_root_mode")}
        hint={t("modal.app_settings.field.upriv_root_mode_help")}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.upriv_root_mode")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="auto"
            checked={useAutoDetect}
            title={t("modal.app_settings.option.upriv_root.auto")}
            description={t("modal.app_settings.option.upriv_root.auto_desc")}
            badge="default"
            onSelect={() => onChange({ auto_detect_vault_root: true, upriv_root_path: "" })}
          />
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="fixed"
            checked={!useAutoDetect}
            title={t("modal.app_settings.option.upriv_root.fixed")}
            description={t("modal.app_settings.option.upriv_root.fixed_desc")}
            onSelect={() =>
              onChange({
                auto_detect_vault_root: false,
                upriv_root_path: config.upriv_root_path,
              })
            }
            footer={
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-on-surface-variant">
                  {t("modal.app_settings.field.upriv_root_help")}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <input
                    type="text"
                    readOnly
                    value={config.upriv_root_path}
                    placeholder={t("modal.app_settings.field.upriv_root_placeholder")}
                    className={[settingsControlClass, "font-mono text-xs sm:min-w-0 sm:flex-1"].join(" ")}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    className="w-full shrink-0 sm:w-auto"
                    onClick={() =>
                      onChange({
                        auto_detect_vault_root: false,
                        upriv_root_path: MOCK_UPRIV_ROOT_PATH,
                      })
                    }
                  >
                    {t("modal.app_settings.action.choose_folder")}
                  </Button>
                </div>
              </div>
            }
          />
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}
