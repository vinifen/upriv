import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Switch } from "@/components/ui";
import {
  PolicyRadioOption,
  settingsControlClass,
  SettingsField,
  SettingsFormGrid,
} from "@/components/settings";
import { useTranslation } from "@/i18n";
import {
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_DEFAULT,
  LOG_KEEP_LAST_ENTRY_OPTIONS,
  LOG_KEEP_LAST_UNLIMITED,
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  logFileCountForKeepLast,
  type AppSettingsConfig,
  type IncompleteReplacePolicy,
  type LogLevel,
  type UiTheme,
  type VaultListItem,
  resolveVaultDisplayStatus,
} from "@upriv/shared";
import { useAppSettingsService, useVaultRootService, useVaultService } from "@/platform/services";
import { vaultStatusI18nKey } from "@/theme/vault-status";
import {
  downloadVaultsZip,
  listVaultsBlockingBulkExport,
  listVaultsReadyForBulkExport,
  vaultBlocksBulkExport,
} from "./vaultBulkExport";
import {
  isVaultRootDraftDirty,
  vaultRootGateFromState,
  type VaultRootDiskStatus,
  type VaultRootSettingsGate,
} from "./vaultRootSettingsIntent";

const vaultCheckboxClass =
  "h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40";

interface SectionPatchProps<S extends keyof AppSettingsConfig> {
  config: AppSettingsConfig[S];
  onChange: (patch: Partial<AppSettingsConfig[S]>) => void;
}

const THEMES: UiTheme[] = ["dark", "neutral", "light"];
const LOG_LEVELS = [
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const satisfies readonly LogLevel[];

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
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.locale")}
          className="grid gap-2"
        >
          {SUPPORTED_LOCALES.map((locale) => (
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
        <div
          role="radiogroup"
          aria-label={t("modal.app_settings.field.theme")}
          className="grid gap-2"
        >
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
  const vaultService = useVaultService();
  const selectAllId = useId();

  const sortedVaults = useMemo(
    () =>
      [...vaults].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
      ),
    [vaults],
  );
  const blockingVaults = useMemo(() => listVaultsBlockingBulkExport(vaults), [vaults]);
  const readyVaults = useMemo(() => listVaultsReadyForBulkExport(vaults), [vaults]);
  const readyIds = useMemo(() => readyVaults.map((vault) => vault.id), [readyVaults]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const wasModalOpenRef = useRef(false);

  useEffect(() => {
    if (!modalOpen) {
      wasModalOpenRef.current = false;
      setSelected(new Set());
      return;
    }
    if (!wasModalOpenRef.current) {
      wasModalOpenRef.current = true;
      setSelected(new Set(readyIds));
    }
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
    void downloadVaultsZip(
      selectedReady,
      t("modal.app_settings.download_vaults_zip_name", { date: stamp }),
      (vault) => vaultService.getArchiveExportBytes(vault),
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
          <span className="text-on-error-container/85">
            {" "}
            — {t("warning.download_vaults_open_body")}
          </span>
        </p>
      ) : null}

      {vaults.length === 0 ? (
        <p className="text-xs text-on-surface-variant">
          {t("modal.app_settings.download_vaults_empty")}
        </p>
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
              <span className="text-xs text-on-surface-variant">
                {t("modal.app_settings.select_all_vaults")}
              </span>
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

function formatLogKeepLastOption(
  t: ReturnType<typeof useTranslation>["t"],
  locale: string,
  entries: number,
): string {
  if (entries === LOG_KEEP_LAST_UNLIMITED) {
    return t("modal.app_settings.option.logging_keep_last.unlimited");
  }
  const files = logFileCountForKeepLast(entries);
  const label = t("modal.app_settings.option.logging_keep_last.entries", {
    entries: entries.toLocaleString(locale),
    files: String(files),
  });
  if (entries === LOG_KEEP_LAST_DEFAULT) {
    return `${label} — ${t("modal.settings.badge.default")}`;
  }
  return label;
}

export function AppSettingsLoggingSection({ config, onChange }: SectionPatchProps<"logging">) {
  const { locale, t } = useTranslation();
  const enabledId = useId();
  const levelGroup = useId();
  const keepLastId = useId();

  const keepLastValue =
    config.keep_last_entries === LOG_KEEP_LAST_UNLIMITED
      ? String(LOG_KEEP_LAST_UNLIMITED)
      : String(config.keep_last_entries);

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
          <span className="text-sm text-on-surface">
            {t("modal.app_settings.field.logging_enabled_label")}
          </span>
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

      <SettingsField
        label={t("modal.app_settings.field.logging_keep_last")}
        htmlFor={keepLastId}
        hint={t("modal.app_settings.field.logging_keep_last_help", {
          perFile: String(LOG_ENTRIES_PER_FILE),
        })}
      >
        <select
          id={keepLastId}
          value={keepLastValue}
          disabled={!config.enabled}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10);
            onChange({
              keep_last_entries: Number.isNaN(parsed) ? LOG_KEEP_LAST_UNLIMITED : parsed,
              entries_per_file: LOG_ENTRIES_PER_FILE,
            });
          }}
          className={settingsControlClass}
        >
          {LOG_KEEP_LAST_ENTRY_OPTIONS.map((entries) => (
            <option key={entries} value={entries}>
              {formatLogKeepLastOption(t, locale, entries)}
            </option>
          ))}
          <option value={LOG_KEEP_LAST_UNLIMITED}>
            {formatLogKeepLastOption(t, locale, LOG_KEEP_LAST_UNLIMITED)}
          </option>
        </select>
      </SettingsField>
    </SettingsFormGrid>
  );
}

export function AppSettingsBehaviorSection({
  config,
  onChange,
  savedAutoDetect,
  savedRootPath,
  onVaultRootGateChange,
}: SectionPatchProps<"app"> & {
  savedAutoDetect: boolean;
  savedRootPath: string;
  onVaultRootGateChange: (gate: VaultRootSettingsGate) => void;
}) {
  const { t } = useTranslation();
  const appSettingsService = useAppSettingsService();
  const vaultRootService = useVaultRootService();
  const rootModeGroup = useId();
  const repairPolicyGroup = useId();
  const useAutoDetect = config.auto_detect_vault_root;
  const aliasLoadGen = useRef(0);
  const checkGen = useRef(0);

  const [disk, setDisk] = useState<VaultRootDiskStatus>("ready");
  const [replacePolicy, setReplacePolicy] = useState<IncompleteReplacePolicy | null>(null);
  const [fixedPathLoading, setFixedPathLoading] = useState(false);

  const dirty = isVaultRootDraftDirty(
    config.auto_detect_vault_root,
    config.upriv_root_path,
    savedAutoDetect,
    savedRootPath,
  );
  const vaultRootGate = vaultRootGateFromState({ dirty, disk, replacePolicy });

  // Keep parent Save gate in sync (draft-only policies until Save).
  useEffect(() => {
    onVaultRootGateChange(vaultRootGateFromState({ dirty, disk, replacePolicy }));
  }, [dirty, disk, onVaultRootGateChange, replacePolicy]);

  // Validate current mode/path whenever the dirty vault-root draft changes.
  useEffect(() => {
    if (!dirty) {
      setDisk("ready");
      setReplacePolicy(null);
      return;
    }

    const gen = ++checkGen.current;
    setReplacePolicy(null);

    if (config.auto_detect_vault_root) {
      setDisk("checking");
      void vaultRootService
        .nearbyStatus()
        .then((result) => {
          if (gen !== checkGen.current) return;
          if (result.status === "incomplete") setDisk("incomplete");
          else if (result.status === "unreadable") setDisk("unreadable");
          else if (result.status === "absent") setDisk("will_create");
          else setDisk("ready");
        })
        .catch(() => {
          if (gen !== checkGen.current) return;
          setDisk("unreadable");
        });
      return;
    }

    const path = config.upriv_root_path.trim();
    if (!path) {
      setDisk(fixedPathLoading ? "checking" : "needs_folder");
      return;
    }

    setDisk("checking");
    void vaultRootService
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== checkGen.current) return;
        if (result.status === "incomplete") setDisk("incomplete");
        else if (result.status === "unreadable") setDisk("unreadable");
        else setDisk("ready");
      })
      .catch(() => {
        if (gen !== checkGen.current) return;
        setDisk("unreadable");
      });
  }, [
    config.auto_detect_vault_root,
    config.upriv_root_path,
    dirty,
    fixedPathLoading,
    vaultRootService,
  ]);

  const retryDiskCheck = () => {
    // Bump generation by re-setting path/auto through a no-op disk reset.
    setDisk("checking");
    setReplacePolicy(null);
    checkGen.current += 1;
    const gen = checkGen.current;
    if (config.auto_detect_vault_root) {
      void vaultRootService
        .nearbyStatus()
        .then((result) => {
          if (gen !== checkGen.current) return;
          if (result.status === "incomplete") setDisk("incomplete");
          else if (result.status === "unreadable") setDisk("unreadable");
          else if (result.status === "absent") setDisk("will_create");
          else setDisk("ready");
        })
        .catch(() => {
          if (gen !== checkGen.current) return;
          setDisk("unreadable");
        });
      return;
    }
    const path = config.upriv_root_path.trim();
    if (!path) {
      setDisk("needs_folder");
      return;
    }
    void vaultRootService
      .inspectAtPath(path)
      .then((result) => {
        if (gen !== checkGen.current) return;
        if (result.status === "incomplete") setDisk("incomplete");
        else if (result.status === "unreadable") setDisk("unreadable");
        else setDisk("ready");
      })
      .catch(() => {
        if (gen !== checkGen.current) return;
        setDisk("unreadable");
      });
  };

  const showAutoExtras = useAutoDetect && dirty;
  const showFixedExtras = !useAutoDetect;

  const incompletePanel =
    dirty && disk === "incomplete" ? (
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-on-surface" role="status">
          {t(
            useAutoDetect
              ? "modal.app_settings.upriv_root.switch_auto_replace_notice"
              : "modal.app_settings.save_confirm_fixed_incomplete",
            useAutoDetect
              ? { file: VAULT_ROOT_ALIAS_FILE }
              : { path: config.upriv_root_path.trim() || "…" },
          )}
        </p>
        <div
          role="radiogroup"
          aria-label={t("modal.vault_root_repair.title")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={repairPolicyGroup}
            value="rename"
            checked={replacePolicy === "rename"}
            title={t("modal.vault_root_repair.option_rename")}
            description={t("modal.vault_root_repair.rename_hint")}
            badge="default"
            onSelect={() => setReplacePolicy("rename")}
          />
          <PolicyRadioOption
            groupName={repairPolicyGroup}
            value="delete"
            checked={replacePolicy === "delete"}
            title={t("modal.vault_root_repair.option_delete")}
            description={t("modal.vault_root_repair.delete_hint")}
            tone="less-secure"
            onSelect={() => setReplacePolicy("delete")}
          />
        </div>
      </div>
    ) : null;

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
            attention={useAutoDetect && vaultRootGate.blocksSave}
            title={t("modal.app_settings.option.upriv_root.auto")}
            description={t("modal.app_settings.option.upriv_root.auto_desc")}
            badge="default"
            onSelect={() => {
              aliasLoadGen.current += 1;
              setFixedPathLoading(false);
              setReplacePolicy(null);
              onChange({ auto_detect_vault_root: true, upriv_root_path: "" });
            }}
            footer={
              showAutoExtras ? (
                <div className="space-y-2">
                  {disk === "checking" ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </p>
                  ) : null}
                  {disk === "will_create" ? (
                    <p
                      className="rounded-md bg-surface-container px-3 py-2 text-xs leading-relaxed text-on-surface"
                      role="status"
                    >
                      {t("modal.app_settings.upriv_root.switch_auto_create_notice", {
                        file: VAULT_ROOT_ALIAS_FILE,
                      })}
                    </p>
                  ) : null}
                  {disk === "unreadable" ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p
                        className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
                        role="alert"
                      >
                        {t("modal.vault_root_setup.error_io")}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        className="w-full shrink-0 sm:w-auto"
                        onClick={retryDiskCheck}
                      >
                        {t("action.retry")}
                      </Button>
                    </div>
                  ) : null}
                  {incompletePanel}
                </div>
              ) : null
            }
          />
          <PolicyRadioOption
            groupName={rootModeGroup}
            value="fixed"
            checked={!useAutoDetect}
            attention={!useAutoDetect && vaultRootGate.blocksSave}
            title={t("modal.app_settings.option.upriv_root.fixed")}
            description={t("modal.app_settings.option.upriv_root.fixed_desc", {
              file: VAULT_ROOT_ALIAS_FILE,
            })}
            onSelect={() => {
              const current = config.upriv_root_path.trim();
              setReplacePolicy(null);
              if (current) {
                onChange({ auto_detect_vault_root: false, upriv_root_path: current });
                return;
              }
              const gen = ++aliasLoadGen.current;
              setFixedPathLoading(true);
              onChange({ auto_detect_vault_root: false, upriv_root_path: "" });
              void vaultRootService
                .readAlias()
                .then((alias) => {
                  if (gen !== aliasLoadGen.current) return;
                  onChange({
                    auto_detect_vault_root: false,
                    upriv_root_path: alias?.path.trim() || "",
                  });
                })
                .finally(() => {
                  if (gen !== aliasLoadGen.current) return;
                  setFixedPathLoading(false);
                });
            }}
            footer={
              showFixedExtras ? (
                <div className="space-y-2">
                  <p className="text-xs leading-relaxed text-on-surface-variant">
                    {t("modal.app_settings.field.upriv_root_help")}
                  </p>
                  {config.upriv_root_path.trim() ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant">
                      {t("modal.app_settings.field.upriv_root_remembered", {
                        file: VAULT_ROOT_ALIAS_FILE,
                      })}
                    </p>
                  ) : fixedPathLoading || disk === "checking" ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.app_settings.field.upriv_root_loading")}
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                    <input
                      type="text"
                      readOnly
                      value={config.upriv_root_path}
                      placeholder={t("modal.app_settings.field.upriv_root_placeholder")}
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
                      disabled={fixedPathLoading}
                      onClick={() => {
                        const suggested = config.upriv_root_path.trim();
                        setReplacePolicy(null);
                        void (
                          suggested
                            ? Promise.resolve(suggested)
                            : vaultRootService.readAlias().then((alias) => alias?.path.trim() || "")
                        ).then((defaultPath) =>
                          vaultRootService
                            .pickFolder(
                              defaultPath || null,
                              t("modal.vault_root_setup.pick_folder_title"),
                            )
                            .then((picked) => {
                              onChange({
                                auto_detect_vault_root: false,
                                upriv_root_path:
                                  picked?.trim() ||
                                  defaultPath ||
                                  appSettingsService.getDefaultRootPathSuggestion(),
                              });
                            }),
                        );
                      }}
                    >
                      {t("modal.app_settings.action.choose_folder")}
                    </Button>
                  </div>
                  {disk === "unreadable" ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p
                        className="rounded-md bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-on-error-container"
                        role="alert"
                      >
                        {t("modal.vault_root_setup.error_io")}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        className="w-full shrink-0 sm:w-auto"
                        onClick={retryDiskCheck}
                      >
                        {t("action.retry")}
                      </Button>
                    </div>
                  ) : null}
                  {disk === "needs_folder" ? (
                    <p className="text-xs leading-relaxed text-on-surface-variant" role="status">
                      {t("modal.vault_root_setup.error_path_required")}
                    </p>
                  ) : null}
                  {incompletePanel}
                </div>
              ) : null
            }
          />
        </div>
      </SettingsField>
    </SettingsFormGrid>
  );
}
