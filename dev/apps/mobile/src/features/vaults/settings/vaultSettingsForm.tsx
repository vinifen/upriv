import { type ReactNode, useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  workspaceSystemsCurrentFirst,
  workspaceSystemFromHost,
  workspaceSystemHasShortcut,
  appWorkspace,
  appWorkspacePlace,
  securityModeToUi,
  securityUiModesForStorage,
  storageModeIsPlaintext,
  uiToSecurityMode,
  validateWorkspaceTable,
  vaultSettingsPreferenceSections,
  workspacePathIssueI18nKey,
  type KdfUnlockPreset,
  type PolicyRadioBadge,
  type SecurityUiMode,
  type StorageMode,
  type VaultGroup,
  type VaultSettingsConfig,
  type VaultSettingsSectionId,
  type WorkspaceOsEntry,
  type WorkspacePathIssue,
  type WorkspaceSystem,
  type WorkspaceTable,
  groupsForAssignmentPicker,
  groupAssignmentClearOption,
  requireVaultConfigEditLockedI18nKey,
} from "@upriv/shared";
import { PathField } from "@/components/PathField";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useTranslation, type I18nKey } from "@/i18n";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Button, Select } from "@/components/ui";
import { IntegerInput, PolicyRadioOption, SettingsAccordionSection } from "@/components/settings";
import {
  FieldHint,
  FieldLabel,
  RadioGroup,
  SwitchRow,
  ThemedInput,
  DisplayNameFieldError,
} from "@/components/settings/settingsFields";
import { useVaultRootService } from "@/platform/services";

type PatchDraft = <S extends keyof VaultSettingsConfig>(
  section: S,
  patch: Partial<VaultSettingsConfig[S]>,
) => void;

const STORAGE_RADIOS: ReadonlyArray<{
  mode: StorageMode;
  badge?: PolicyRadioBadge;
  tone?: "default" | "insecure";
}> = [
  { mode: "encrypted_dir", badge: "recommended" },
  { mode: "upriv_plain", badge: "insecure", tone: "insecure" },
];

const STORAGE_WARNING: Partial<Record<StorageMode, I18nKey>> = {
  encrypted_dir: "warning.encrypted_dir_ram",
  upriv_plain: "warning.upriv_plain",
};

function securityOptionMeta(uiMode: SecurityUiMode): {
  badge?: PolicyRadioBadge;
  tone?: "default" | "less-secure" | "insecure";
} {
  switch (uiMode) {
    case "session_ram":
      return { badge: "recommended" };
    case "prompt_open_close":
      return { badge: "more-secure" };
    case "disk_close":
      return { badge: "less-secure", tone: "less-secure" };
    case "disk_open_close":
      return { badge: "insecure", tone: "insecure" };
    default:
      return {};
  }
}

interface VaultSettingsFormProps {
  draft: VaultSettingsConfig;
  patchDraft: PatchDraft;
  storageModeLocked?: boolean;
  displayNameLocked?: boolean;
  mountLocked?: boolean;
  securityModeLocked?: boolean;
  /** Resolved vault-root for reserved mount-path checks. */
  vaultRootPath?: string | null;
  onPathIssueChange?: (issue: WorkspacePathIssue | null) => void;
  appWorkspace?: WorkspaceTable;
  hiddenLocked?: boolean;
  children?: ReactNode;
}

export function VaultSettingsForm({
  draft,
  patchDraft,
  storageModeLocked = false,
  displayNameLocked = false,
  mountLocked = false,
  securityModeLocked = false,
  vaultRootPath = null,
  onPathIssueChange,
  appWorkspace: appFolders = appWorkspace(),
  hiddenLocked = false,
  children,
}: VaultSettingsFormProps) {
  const { t } = useTranslation();
  const locks = {
    storageModeLocked,
    displayNameLocked,
    mountLocked,
    securityModeLocked,
    hiddenLocked,
  };

  return (
    <View style={styles.root}>
      {vaultSettingsPreferenceSections(draft.storage.mode).map((sectionId) => (
        <SettingsAccordionSection
          key={sectionId}
          title={t(`modal.settings.section.${sectionId}` as I18nKey)}
          defaultOpen={sectionId === "vault"}
        >
          {renderSection(
            sectionId,
            draft,
            patchDraft,
            locks,
            vaultRootPath,
            appFolders,
            onPathIssueChange,
          )}
        </SettingsAccordionSection>
      ))}
      {children}
    </View>
  );
}

function renderSection(
  sectionId: VaultSettingsSectionId,
  draft: VaultSettingsConfig,
  patchDraft: PatchDraft,
  locks: {
    storageModeLocked: boolean;
    displayNameLocked: boolean;
    mountLocked: boolean;
    securityModeLocked: boolean;
    hiddenLocked: boolean;
  },
  vaultRootPath: string | null,
  appFolders: WorkspaceTable,
  onPathIssueChange?: (issue: WorkspacePathIssue | null) => void,
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSection
          config={draft.vault}
          hiddenLocked={locks.hiddenLocked}
          displayNameLocked={locks.displayNameLocked}
          onChange={(patch) => patchDraft("vault", patch)}
        />
      );
    case "storage":
      return (
        <StorageSection
          config={draft.storage}
          locked={locks.storageModeLocked}
          onChange={(patch) => patchDraft("storage", patch)}
        />
      );
    case "mount":
      return (
        <VaultSettingsMountSection
          config={draft.mount}
          vaultRootPath={vaultRootPath}
          controlsDisabled={locks.mountLocked}
          plaintext={draft.storage.mode === "upriv_plain"}
          appWorkspace={appFolders}
          onPathIssueChange={onPathIssueChange}
          onChange={(patch) => patchDraft("mount", patch)}
        />
      );
    case "auto_close":
      return (
        <AutoCloseSection
          autoClose={draft.auto_close}
          secureWipe={draft.security.secure_wipe_workspace}
          requireUnmountOnSleep={draft.policy.require_unmount_on_sleep}
          onAutoCloseChange={(patch) => patchDraft("auto_close", patch)}
          onSecureWipeChange={(secure_wipe_workspace) =>
            patchDraft("security", { secure_wipe_workspace })
          }
          onRequireUnmountOnSleepChange={(require_unmount_on_sleep) =>
            patchDraft("policy", { require_unmount_on_sleep })
          }
        />
      );
    case "backup":
      return (
        <BackupSection config={draft.backup} onChange={(patch) => patchDraft("backup", patch)} />
      );
    case "security":
      return (
        <SecuritySection
          storageMode={draft.storage.mode}
          config={draft.security}
          passwordHint={draft.vault.password_hint}
          securityModeLocked={locks.securityModeLocked}
          onChange={(patch) => patchDraft("security", patch)}
          onPasswordHintChange={(password_hint) => patchDraft("vault", { password_hint })}
        />
      );
    case "policy":
      return (
        <PolicySection config={draft.policy} onChange={(patch) => patchDraft("policy", patch)} />
      );
    default:
      return null;
  }
}

function VaultSection({
  config,
  onChange,
  hiddenLocked = false,
  displayNameLocked = false,
}: {
  config: VaultSettingsConfig["vault"];
  onChange: (patch: Partial<VaultSettingsConfig["vault"]>) => void;
  hiddenLocked?: boolean;
  displayNameLocked?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <FieldLabel disabled={displayNameLocked}>
        {t("modal.settings.field.vault.display_name")}
      </FieldLabel>
      {displayNameLocked ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("vault.display_name"))}</FieldHint>
      ) : null}
      <ThemedInput
        value={config.display_name}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
        disabled={displayNameLocked}
        autoCorrect={false}
        spellCheck={false}
        onChangeText={(display_name) => onChange({ display_name })}
      />
      {displayNameLocked ? null : <DisplayNameFieldError name={config.display_name} />}
      <FieldLabel>{t("modal.settings.field.vault.order")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.vault.order_help")}</FieldHint>
      <IntegerInput min={0} value={config.order} onChange={(order) => onChange({ order })} />
      <FieldLabel>{t("modal.settings.note")}</FieldLabel>
      <FieldHint>
        {t("modal.settings.field.vault.note_help", { max: String(VAULT_NOTE_MAX_LENGTH) })}
      </FieldHint>
      <ThemedInput
        value={config.note}
        maxLength={VAULT_NOTE_MAX_LENGTH}
        onChangeText={(note) => onChange({ note })}
        multiline
        style={styles.multiline}
      />
      <SwitchRow
        label={t("modal.settings.field.vault.hidden")}
        hint={
          hiddenLocked
            ? t("modal.settings.field.vault.hidden_locked_by_group")
            : t("modal.settings.field.vault.hidden_help")
        }
        value={config.hidden || hiddenLocked}
        disabled={hiddenLocked}
        onValueChange={(hidden) => onChange({ hidden })}
      />
    </View>
  );
}

function StorageSection({
  config,
  locked,
  onChange,
}: {
  config: VaultSettingsConfig["storage"];
  locked: boolean;
  onChange: (patch: Partial<VaultSettingsConfig["storage"]>) => void;
}) {
  const { t } = useTranslation();
  const warning = STORAGE_WARNING[config.mode];
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.settings.section.storage_intro")}</FieldHint>
      <FieldLabel>{t("modal.settings.field.storage.mode")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.storage.mode_help")}</FieldHint>
      {locked ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("storage.mode"))}</FieldHint>
      ) : null}
      <RadioGroup>
        {STORAGE_RADIOS.map(({ mode, badge, tone }) => (
          <PolicyRadioOption
            key={mode}
            value={mode}
            checked={config.mode === mode}
            disabled={locked || mode === "upriv_plain"}
            title={t(`modal.settings.option.storage.${mode}` as I18nKey)}
            description={t(`modal.settings.option.storage.${mode}_desc` as I18nKey)}
            badge={badge}
            tone={tone}
            onSelect={() => onChange({ mode })}
          />
        ))}
      </RadioGroup>
      {warning ? <FieldHint>{t(warning)}</FieldHint> : null}
      <FieldHint>{t("error.upriv_plain_unavailable")}</FieldHint>
    </View>
  );
}

export function VaultSettingsMountSection({
  config,
  onChange,
  vaultRootPath = null,
  onPathIssueChange,
  controlsDisabled = false,
  plaintext = false,
  appWorkspace: appFolders = appWorkspace(),
}: {
  config: VaultSettingsConfig["mount"];
  onChange: (patch: Partial<VaultSettingsConfig["mount"]>) => void;
  vaultRootPath?: string | null;
  onPathIssueChange?: (issue: WorkspacePathIssue | null) => void;
  controlsDisabled?: boolean;
  plaintext?: boolean;
  appWorkspace?: WorkspaceTable;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const current = workspaceSystemFromHost(Platform.OS);
  const pathIssue = validateWorkspaceTable(config, vaultRootPath);

  useEffect(() => {
    onPathIssueChange?.(pathIssue);
  }, [onPathIssueChange, pathIssue]);

  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.settings.section.mount_intro")}</FieldHint>
      {controlsDisabled ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("mount.workspace_path"))}</FieldHint>
      ) : null}
      {workspaceSystemsCurrentFirst(Platform.OS).map((system) => {
        const active = system === current && !controlsDisabled;
        const entry = config[system];
        return (
          <View key={system} style={active ? undefined : { opacity: 0.6 }}>
            <FieldLabel disabled={!active}>
              {t(`modal.app_settings.field.workspace.system.${system}`)}
            </FieldLabel>
            <FieldHint disabled={!active}>
              {system === current
                ? t(
                    plaintext
                      ? "modal.settings.field.mount.plain_help"
                      : workspaceSystemHasShortcut(system)
                        ? "modal.settings.field.mount.path_help"
                        : "modal.settings.field.mount.phone_help",
                  )
                : t("modal.app_settings.field.workspace.other_system")}
            </FieldHint>
            {system === current ? (
              <CurrentVaultFolderChoices
                system={system}
                entry={entry}
                appEntry={appFolders[system]}
                appShortcutOn={appFolders.file_manager_folder}
                vaultAppShortcut={config.app_file_manager_folder}
                vaultCustomShortcut={config.custom_file_manager_folder}
                active={active}
                plaintext={plaintext}
                canPick={Platform.OS === "android"}
                onChange={onChange}
              />
            ) : (
              <PathField
                value={entry.path}
                disabled
                placeholder={t("modal.settings.field.mount.inherit")}
              />
            )}
          </View>
        );
      })}
      {pathIssue ? (
        <Text
          style={[typography.caption, { color: colors.onErrorContainer }]}
          accessibilityRole="alert"
        >
          {t(workspacePathIssueI18nKey(pathIssue))}
        </Text>
      ) : null}
    </View>
  );
}

function CurrentVaultFolderChoices({
  system,
  entry,
  appEntry,
  appShortcutOn,
  vaultAppShortcut,
  vaultCustomShortcut,
  active,
  plaintext,
  canPick,
  onChange,
}: {
  system: WorkspaceSystem;
  entry: WorkspaceOsEntry;
  appEntry: WorkspaceOsEntry;
  appShortcutOn: boolean;
  vaultAppShortcut: VaultSettingsConfig["mount"]["app_file_manager_folder"];
  vaultCustomShortcut: boolean;
  active: boolean;
  plaintext: boolean;
  canPick: boolean;
  onChange: (patch: Partial<VaultSettingsConfig["mount"]>) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultRootService = useVaultRootService();
  const trimmed = entry.path.trim();
  const [customPending, setCustomPending] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const custom = trimmed !== "" || customPending;
  const showShortcut = workspaceSystemHasShortcut(system) && !plaintext;
  const workspaceReady = appWorkspacePlace(appEntry) !== "unset";
  const shortcutLocked = !active || !workspaceReady;
  const radiosDisabled = shortcutLocked || custom;
  const appFolderTitle = workspaceReady
    ? t("modal.settings.field.mount.inherit")
    : `${t("modal.settings.field.mount.inherit")} (${t("modal.app_settings.field.workspace.unset")})`;
  const followTitle = workspaceReady
    ? `${t("modal.settings.field.mount.shortcut_inherit")} (${t(
        appShortcutOn
          ? "modal.settings.field.mount.shortcut_on"
          : "modal.settings.field.mount.shortcut_off",
      )})`
    : t("modal.settings.field.mount.shortcut_inherit");

  function writePath(path: string) {
    const next = path.trim();
    if (!next) setCustomPending(false);
    onChange({ [system]: { ...entry, path: next } });
  }

  function pickFolder(initial: string | null) {
    if (!active || !canPick) return;
    void (async () => {
      setPickError(null);
      try {
        const picked = await vaultRootService.pickFolder(
          initial,
          t("modal.app_settings.action.pick_workspace_folder"),
        );
        if (!picked?.trim()) return;
        setCustomPending(false);
        onChange({ [system]: { ...entry, path: picked.trim() } });
      } catch (error) {
        setPickError(t(mobileErrorI18nKey(error, "error.unexpected")));
      }
    })();
  }

  return (
    <View style={styles.fields}>
      <PolicyRadioOption
        value="inherit"
        checked={!custom}
        title={appFolderTitle}
        description={t("modal.settings.field.mount.inherit_desc")}
        disabled={!active}
        muted={!workspaceReady}
        onSelect={() => {
          if (!active) return;
          setCustomPending(false);
          onChange({ [system]: { ...entry, path: "" } });
        }}
        footer={
          showShortcut ? (
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t("modal.settings.field.mount.mount")}
              style={styles.fields}
            >
              <View>
                <Text style={[typography.body, { color: colors.onSurface, fontWeight: "500" }]}>
                  {t("modal.settings.field.mount.mount")}
                </Text>
                <Text style={[typography.caption, { color: colors.onSurfaceVariant }]}>
                  {t(
                    workspaceReady
                      ? "modal.settings.field.mount.inherit_shortcut_help"
                      : "modal.settings.field.mount.shortcut_unset",
                  )}
                </Text>
              </View>
              {(["inherit", "on", "off"] as const).map((mode) => (
                <PolicyRadioOption
                  key={mode}
                  value={mode}
                  checked={vaultAppShortcut === mode}
                  disabled={shortcutLocked}
                  title={
                    mode === "inherit"
                      ? followTitle
                      : t(`modal.settings.field.mount.shortcut_${mode}`)
                  }
                  onSelect={() => {
                    if (radiosDisabled) return;
                    onChange({ app_file_manager_folder: mode });
                  }}
                />
              ))}
            </View>
          ) : null
        }
      />
      <PolicyRadioOption
        value="custom"
        checked={custom}
        title={t("modal.settings.field.mount.custom")}
        description={t("modal.settings.field.mount.custom_desc")}
        disabled={!active}
        onSelect={() => {
          if (!active || custom) return;
          if (!canPick) {
            setCustomPending(true);
            return;
          }
          pickFolder(null);
        }}
        footer={
          <View style={styles.fields}>
            <PathField
              value={entry.path}
              disabled={!active || !custom}
              placeholder={t("modal.settings.field.mount.path_placeholder")}
              onChangeText={(path) => {
                if (!active) return;
                writePath(path);
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              label={t("modal.app_settings.action.pick_workspace_folder")}
              disabled={!active || !canPick}
              onPress={() => pickFolder(trimmed || null)}
            />
            {showShortcut ? (
              <SwitchRow
                label={t("modal.settings.field.mount.mount")}
                hint={t("modal.settings.field.mount.mount_help")}
                value={vaultCustomShortcut}
                disabled={!active || trimmed === ""}
                onValueChange={(checked) => onChange({ custom_file_manager_folder: checked })}
              />
            ) : null}
          </View>
        }
      />
      {pickError ? (
        <Text
          style={[typography.caption, { color: colors.onErrorContainer }]}
          accessibilityRole="alert"
        >
          {pickError}
        </Text>
      ) : null}
    </View>
  );
}

function AutoCloseSection({
  autoClose,
  secureWipe,
  requireUnmountOnSleep,
  onAutoCloseChange,
  onSecureWipeChange,
  onRequireUnmountOnSleepChange,
}: {
  autoClose: VaultSettingsConfig["auto_close"];
  secureWipe: boolean;
  requireUnmountOnSleep: boolean;
  onAutoCloseChange: (patch: Partial<VaultSettingsConfig["auto_close"]>) => void;
  onSecureWipeChange: (secureWipe: boolean) => void;
  onRequireUnmountOnSleepChange: (requireUnmountOnSleep: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.fields}>
      <SwitchRow
        label={t("modal.settings.field.close.secure_wipe")}
        value={secureWipe}
        onValueChange={onSecureWipeChange}
      />
      {!secureWipe ? (
        <FieldHint>{t("modal.settings.field.close.secure_wipe_warn")}</FieldHint>
      ) : null}

      <SwitchRow
        label={t("modal.settings.field.auto_close.enabled")}
        value={autoClose.enabled}
        onValueChange={(enabled) => onAutoCloseChange({ enabled })}
      />
      <FieldLabel disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.idle_minutes")}
      </FieldLabel>
      <IntegerInput
        min={1}
        max={1440}
        disabled={!autoClose.enabled}
        value={autoClose.idle_minutes}
        onChange={(idle_minutes) => onAutoCloseChange({ idle_minutes })}
      />
      <FieldLabel disabled={!autoClose.enabled}>
        {t("modal.settings.field.auto_close.warn_before_seconds")}
      </FieldLabel>
      <IntegerInput
        min={0}
        max={300}
        disabled={!autoClose.enabled}
        value={autoClose.warn_before_seconds}
        onChange={(warn_before_seconds) => onAutoCloseChange({ warn_before_seconds })}
      />

      <SwitchRow
        label={t("modal.settings.field.close.require_unmount_on_sleep")}
        hint={t("modal.settings.field.close.require_unmount_on_sleep_help")}
        value={requireUnmountOnSleep}
        onValueChange={onRequireUnmountOnSleepChange}
      />
    </View>
  );
}

function BackupSection({
  config,
  onChange,
}: {
  config: VaultSettingsConfig["backup"];
  onChange: (patch: Partial<VaultSettingsConfig["backup"]>) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.fields}>
      <SwitchRow
        label={t("modal.settings.field.backup.enabled")}
        value={config.enabled}
        onValueChange={(enabled) => onChange({ enabled })}
      />
      <Select
        label={t("modal.settings.field.backup.mode")}
        value={config.mode}
        disabled={!config.enabled}
        options={[
          { value: "keep_last", label: t("modal.settings.option.backup.keep_last") },
          { value: "keep_all", label: t("modal.settings.option.backup.keep_all") },
        ]}
        onChange={(mode) => onChange({ mode })}
      />
      <FieldLabel disabled={!config.enabled || config.mode !== "keep_last"}>
        {t("modal.settings.field.backup.keep_last")}
      </FieldLabel>
      <IntegerInput
        min={1}
        max={99}
        disabled={!config.enabled || config.mode !== "keep_last"}
        value={config.keep_last}
        onChange={(keep_last) => onChange({ keep_last })}
      />
    </View>
  );
}

function SecuritySection({
  storageMode,
  config,
  passwordHint,
  onChange,
  onPasswordHintChange,
  securityModeLocked = false,
}: {
  storageMode: StorageMode;
  config: VaultSettingsConfig["security"];
  passwordHint: string;
  onChange: (patch: Partial<VaultSettingsConfig["security"]>) => void;
  onPasswordHintChange: (passwordHint: string) => void;
  securityModeLocked?: boolean;
}) {
  const { t } = useTranslation();
  const selectedUi = securityModeToUi(config.mode);
  const modes = securityUiModesForStorage(storageMode);
  return (
    <View style={styles.fields}>
      <FieldLabel disabled={securityModeLocked}>
        {t("modal.settings.field.security.mode")}
      </FieldLabel>
      <FieldHint disabled={securityModeLocked}>
        {securityModeLocked
          ? t(requireVaultConfigEditLockedI18nKey("security.mode"))
          : storageModeIsPlaintext(storageMode)
            ? t("modal.settings.field.security.mode_help_plain")
            : t("modal.settings.field.security.mode_help")}
      </FieldHint>
      <RadioGroup>
        {modes.map((uiMode) => {
          const meta = securityOptionMeta(uiMode);
          return (
            <PolicyRadioOption
              key={uiMode}
              value={uiMode}
              checked={selectedUi === uiMode}
              disabled={securityModeLocked}
              title={t(`modal.settings.option.security.${uiMode}` as I18nKey)}
              description={t(`modal.settings.option.security.${uiMode}_desc` as I18nKey)}
              badge={meta.badge}
              tone={meta.tone}
              onSelect={() => onChange({ mode: uiToSecurityMode(uiMode) })}
            />
          );
        })}
      </RadioGroup>
      <FieldLabel>{t("modal.settings.password_hint")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.security.password_hint_help")}</FieldHint>
      <ThemedInput
        value={passwordHint}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onChangeText={onPasswordHintChange}
      />
    </View>
  );
}

export function KdfSection({
  config,
  onChange,
  choosesPreset = true,
  archivePreset = null,
}: {
  config: { unlock_preset: KdfUnlockPreset };
  onChange: (patch: Partial<{ unlock_preset: KdfUnlockPreset }>) => void;
  choosesPreset?: boolean;
  archivePreset?: KdfUnlockPreset | null;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.fields}>
      <FieldLabel disabled={!choosesPreset}>
        {t("modal.settings.field.kdf.unlock_preset")}
      </FieldLabel>
      <FieldHint disabled={!choosesPreset}>{t("modal.settings.section.kdf_intro")}</FieldHint>
      <RadioGroup>
        {KDF_UNLOCK_PRESETS.map((preset) => {
          const meta = KDF_UNLOCK_OPTION_META[preset];
          const selected = choosesPreset ? config.unlock_preset : archivePreset;
          return (
            <PolicyRadioOption
              key={preset}
              value={preset}
              checked={selected === preset}
              disabled={!choosesPreset}
              title={t(meta.titleKey)}
              description={t(meta.descKey)}
              badge={meta.badge}
              tone={meta.tone}
              onSelect={() => onChange({ unlock_preset: preset })}
            />
          );
        })}
      </RadioGroup>
      {!choosesPreset ? (
        <FieldHint>{t("modal.settings.field.kdf.import_package")}</FieldHint>
      ) : null}
    </View>
  );
}

function PolicySection({
  config,
  onChange,
}: {
  config: VaultSettingsConfig["policy"];
  onChange: (patch: Partial<VaultSettingsConfig["policy"]>) => void;
}) {
  const { t } = useTranslation();
  const externalBlockCopy = config.allow_external_editors && config.disallow_copy_outside_mount;
  return (
    <View style={styles.fields}>
      <FieldLabel>{t("modal.settings.field.policy.external_editors")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.policy.external_editors_help")}</FieldHint>
      <RadioGroup>
        <PolicyRadioOption
          value="no"
          checked={!config.allow_external_editors}
          title={t("modal.settings.option.policy.external_editors_no")}
          description={t("modal.settings.option.policy.external_editors_no_desc")}
          badge="recommended"
          onSelect={() => onChange({ allow_external_editors: false })}
        />
        <PolicyRadioOption
          value="yes"
          checked={config.allow_external_editors}
          title={t("modal.settings.option.policy.external_editors_yes")}
          description={t("modal.settings.option.policy.external_editors_yes_desc")}
          badge="less-secure"
          tone="less-secure"
          onSelect={() => onChange({ allow_external_editors: true })}
        />
      </RadioGroup>
      <FieldLabel>{t("modal.settings.field.policy.copy_outside")}</FieldLabel>
      <FieldHint>{t("modal.settings.field.policy.copy_outside_help")}</FieldHint>
      <RadioGroup>
        <PolicyRadioOption
          value="block"
          checked={config.disallow_copy_outside_mount}
          title={t("modal.settings.option.policy.copy_block")}
          description={t("modal.settings.option.policy.copy_block_desc")}
          badge="recommended"
          onSelect={() => onChange({ disallow_copy_outside_mount: true })}
        />
        <PolicyRadioOption
          value="allow"
          checked={!config.disallow_copy_outside_mount}
          title={t("modal.settings.option.policy.copy_allow")}
          description={t("modal.settings.option.policy.copy_allow_desc")}
          badge="less-secure"
          tone="less-secure"
          onSelect={() => onChange({ disallow_copy_outside_mount: false })}
        />
      </RadioGroup>
      {config.allow_external_editors ? <FieldHint>{t("warning.external_editor")}</FieldHint> : null}
      {externalBlockCopy ? <FieldHint>{t("warning.policy.external_block_copy")}</FieldHint> : null}
    </View>
  );
}

export function VaultSettingsGroupSection({
  groups,
  selectedGroupId,
  newGroupName,
  includeHidden = false,
  onSelectedGroupIdChange,
  onNewGroupNameChange,
}: {
  groups: readonly VaultGroup[];
  selectedGroupId: string;
  newGroupName: string;
  includeHidden?: boolean;
  onSelectedGroupIdChange: (groupId: string) => void;
  onNewGroupNameChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const creating = Boolean(newGroupName.trim());
  const pickerGroups = groupsForAssignmentPicker(groups, { includeHidden, selectedGroupId });
  const groupOptions = [
    groupAssignmentClearOption(creating ? "" : selectedGroupId, t),
    ...pickerGroups.map((group) => ({ value: group.id, label: group.displayName })),
  ];
  return (
    <View style={styles.fields}>
      <FieldHint>{t("modal.settings.field.group.new_name_help")}</FieldHint>
      <Select
        label={t("vault.group.assignment.section")}
        value={creating ? "" : selectedGroupId}
        options={groupOptions}
        disabled={creating}
        onChange={onSelectedGroupIdChange}
      />
      <FieldLabel>{t("modal.settings.field.group.new_name")}</FieldLabel>
      <ThemedInput
        value={newGroupName}
        maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
        autoCorrect={false}
        spellCheck={false}
        onChangeText={onNewGroupNameChange}
        placeholder={t("vault.group.create.name_label")}
      />
      <DisplayNameFieldError name={newGroupName} allowEmpty />
      <FieldHint>{t("vault.create.group_create_help")}</FieldHint>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  fields: { gap: spacing.md },
  multiline: { minHeight: 88, textAlignVertical: "top" },
});
