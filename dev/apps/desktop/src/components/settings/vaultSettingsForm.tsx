import { useEffect, useId, type ReactNode } from "react";
import { PathField } from "@/components/PathField";
import { Button, Select, SwitchRow } from "@/components/ui";
import { useRevealWhen } from "@/hooks/useRevealWhen";
import {
  COMPRESSION_PRESETS,
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  POLICY_RADIO_BADGE_I18N,
  policyRadioBadgeList,
  IDLE_AUTO_CLOSE_MINUTES_MAX,
  IDLE_AUTO_CLOSE_MINUTES_MIN,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  workspaceSystemsCurrentFirst,
  appWorkspace,
  appWorkspacePlace,
  compressionPresetFromSevenZip,
  sevenZipPatchFromCompressionPreset,
  validateWorkspaceTable,
  vaultFolderChosen,
  vaultFolderRow,
  currentWorkspaceSystem,
  workspaceSystemHasShortcut,
  workspacePathIssueI18nKey,
  type CompressionPreset,
  type KdfUnlockPreset,
  type PolicyRadioBadge,
  type VaultGroup,
  type VaultSettingsConfig,
  type WorkspaceOsEntry,
  type WorkspacePathIssue,
  type WorkspaceSystem,
  type WorkspaceTable,
  groupsForAssignmentPicker,
  groupAssignmentClearOption,
  requireVaultConfigEditLockedI18nKey,
  liveDisplayNameError,
  displayNameErrorI18nKey,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useVaultRootService } from "@/platform/services";
import { useErrorToast } from "@/hooks/useErrorToast";
import { IntegerInput } from "./IntegerInput";
import {
  FileManagerDriverNotice,
  useFileManagerMountHost,
  type MountHostKind,
} from "@/features/system/settings/fileManagerMountHost";

export const settingsControlClass =
  "w-full rounded-lg border-0 bg-surface-container-highest px-2.5 py-2 text-sm text-on-surface outline-none ring-0 focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:py-2.5";

/** Added to a control marked `aria-invalid`, such as a refused password. */
export const settingsInvalidControlClass =
  "aria-invalid:ring-2 aria-invalid:ring-on-error-container aria-invalid:focus:ring-on-error-container";

interface SettingsFieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function SettingsField({
  label,
  hint,
  htmlFor,
  disabled = false,
  children,
}: SettingsFieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className={[
          "block text-sm font-medium",
          disabled ? "text-on-surface-variant opacity-60" : "text-on-surface",
        ].join(" ")}
      >
        {label}
      </label>
      {hint ? (
        <p
          className={[
            "text-xs leading-relaxed",
            disabled ? "text-on-surface-variant opacity-60" : "text-on-surface-variant",
          ].join(" ")}
        >
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}

interface SettingsFormGridProps {
  children: ReactNode;
}

export function SettingsFormGrid({ children }: SettingsFormGridProps) {
  return <div className="space-y-3 sm:space-y-4">{children}</div>;
}

export function DisplayNameFieldError({
  name,
  allowEmpty = false,
}: {
  name: string;
  allowEmpty?: boolean;
}) {
  const { t } = useTranslation();
  const code = liveDisplayNameError(name, { allowEmpty });
  if (!code) return null;
  return (
    <p role="alert" aria-live="polite" className="text-xs text-on-error-container">
      {t(
        displayNameErrorI18nKey(code),
        code === "too_long" ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) } : undefined,
      )}
    </p>
  );
}

interface VaultSettingsVaultSectionProps {
  config: VaultSettingsConfig["vault"];
  onChange: (patch: Partial<VaultSettingsConfig["vault"]>) => void;
  hiddenLocked?: boolean;
  /** `vault.display_name` requires closed or recovery. */
  displayNameLocked?: boolean;
}

export function VaultSettingsVaultSection({
  config,
  onChange,
  hiddenLocked = false,
  displayNameLocked = false,
}: VaultSettingsVaultSectionProps) {
  const { t } = useTranslation();
  const displayNameId = useId();
  const orderId = useId();
  const hintId = useId();
  const noteId = useId();
  const hiddenId = useId();

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.settings.field.vault.display_name")}
        htmlFor={displayNameId}
        disabled={displayNameLocked}
        hint={
          displayNameLocked
            ? t(requireVaultConfigEditLockedI18nKey("vault.display_name"))
            : undefined
        }
      >
        <input
          id={displayNameId}
          type="text"
          value={config.display_name}
          maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
          disabled={displayNameLocked}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={
            !displayNameLocked && liveDisplayNameError(config.display_name) ? true : undefined
          }
          onChange={(e) => onChange({ display_name: e.target.value })}
          className={settingsControlClass}
        />
        {displayNameLocked ? null : <DisplayNameFieldError name={config.display_name} />}
      </SettingsField>
      <SettingsField
        label={t("modal.settings.field.vault.order")}
        hint={t("modal.settings.field.vault.order_help")}
        htmlFor={orderId}
      >
        <IntegerInput
          id={orderId}
          min={0}
          value={config.order}
          onChange={(order) => onChange({ order })}
          className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
        />
      </SettingsField>
      <SettingsField
        label={t("modal.settings.password_hint")}
        htmlFor={hintId}
        hint={t("modal.settings.field.vault.password_hint_help")}
      >
        <input
          id={hintId}
          type="text"
          value={config.password_hint}
          maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
          onChange={(e) => onChange({ password_hint: e.target.value })}
          className={settingsControlClass}
          autoComplete="off"
        />
      </SettingsField>
      <SettingsField
        label={t("modal.settings.note")}
        htmlFor={noteId}
        hint={t("modal.settings.field.vault.note_help", { max: VAULT_NOTE_MAX_LENGTH })}
      >
        <textarea
          id={noteId}
          value={config.note}
          maxLength={VAULT_NOTE_MAX_LENGTH}
          rows={3}
          onChange={(e) => onChange({ note: e.target.value })}
          className={[settingsControlClass, "resize-y"].join(" ")}
        />
      </SettingsField>
      <SwitchRow
        id={hiddenId}
        checked={config.hidden || hiddenLocked}
        onChange={(hidden) => onChange({ hidden })}
        disabled={hiddenLocked}
        label={t("modal.settings.field.vault.hidden")}
        hint={
          hiddenLocked
            ? t("modal.settings.field.vault.hidden_locked_by_group")
            : t("modal.settings.field.vault.hidden_help")
        }
      />
    </SettingsFormGrid>
  );
}

interface SectionPatchProps<S extends keyof VaultSettingsConfig> {
  config: VaultSettingsConfig[S];
  onChange: (patch: Partial<VaultSettingsConfig[S]>) => void;
}

interface VaultSettingsStorageSectionProps extends SectionPatchProps<"storage"> {
  storageModeLocked?: boolean;
}

export function VaultSettingsStorageSection({
  config,
  onChange,
  storageModeLocked = false,
}: VaultSettingsStorageSectionProps) {
  const { t } = useTranslation();
  const storageModeGroup = useId();

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.settings.section.storage_intro")}
      </p>

      <SettingsField
        label={t("modal.settings.field.storage.mode")}
        hint={t("modal.settings.field.storage.mode_help")}
      >
        {storageModeLocked ? (
          <p className="text-xs leading-relaxed text-on-surface-variant">
            {t(requireVaultConfigEditLockedI18nKey("storage.mode"))}
          </p>
        ) : null}
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.storage.mode")}
          className="grid gap-2"
        >
          <PolicyRadioOption
            groupName={storageModeGroup}
            value="encrypted_dir"
            checked={config.mode === "encrypted_dir"}
            disabled={storageModeLocked}
            title={t("modal.settings.option.storage.encrypted_dir")}
            description={t("modal.settings.option.storage.encrypted_dir_desc")}
            badge="recommended"
            onSelect={() => onChange({ mode: "encrypted_dir" })}
          />
          <PolicyRadioOption
            groupName={storageModeGroup}
            value="upriv_plain"
            checked={config.mode === "upriv_plain"}
            disabled={storageModeLocked}
            title={t("modal.settings.option.storage.upriv_plain")}
            description={t("modal.settings.option.storage.upriv_plain_desc")}
            badge="not-recommended"
            tone="less-secure"
            onSelect={() => onChange({ mode: "upriv_plain" })}
          />
        </div>
      </SettingsField>
      {config.mode === "encrypted_dir" ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("warning.encrypted_dir_ram")}
        </p>
      ) : null}
      {config.mode === "upriv_plain" ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("warning.upriv_plain")}
        </p>
      ) : null}
    </SettingsFormGrid>
  );
}

interface VaultSettingsMountSectionProps extends SectionPatchProps<"mount"> {
  vaultRootPath?: string | null;
  /** Notifies parent when the mount path UI is invalid (blocks save / create). */
  onPathIssueChange?: (issue: WorkspacePathIssue | null) => void;
  /** Selected file-manager choice still needs the WinFsp driver. Blocks save. */
  onDriverAttentionChange?: (active: boolean) => void;
  /** `mount.workspace_path` requires vault_quiet. */
  controlsDisabled?: boolean;
  /** Plain text writes files in the folder and has no file manager folder switch. */
  plaintext?: boolean;
  /** App workspace, so "Use the app folder" can follow that file manager folder. */
  appWorkspace?: WorkspaceTable;
}

export function VaultSettingsMountSection({
  config,
  onChange,
  vaultRootPath = null,
  onPathIssueChange,
  onDriverAttentionChange,
  controlsDisabled = false,
  plaintext = false,
  appWorkspace: appFolders = appWorkspace(),
}: VaultSettingsMountSectionProps) {
  const { t } = useTranslation();
  const pathId = useId();
  const current = currentWorkspaceSystem();
  const pathIssue = validateWorkspaceTable(config, vaultRootPath);
  const driver = useFileManagerMountHost();

  const choiceNeedsDriver =
    !plaintext &&
    workspaceSystemHasShortcut(current) &&
    (config[current].path.trim() !== "" || config.app_file_manager_folder === "on");
  // Unknown status still blocks save, so a click cannot land before the check returns.
  const driverAttention = choiceNeedsDriver && (!driver.known || driver.missing);

  useEffect(() => {
    onPathIssueChange?.(pathIssue);
  }, [onPathIssueChange, pathIssue]);

  useEffect(() => {
    onDriverAttentionChange?.(driverAttention);
    return () => onDriverAttentionChange?.(false);
  }, [onDriverAttentionChange, driverAttention]);

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.settings.section.mount_intro")}
      </p>
      {controlsDisabled ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t(requireVaultConfigEditLockedI18nKey("mount.workspace_path"))}
        </p>
      ) : null}
      {workspaceSystemsCurrentFirst().map((system) => {
        const active = system === current && !controlsDisabled;
        const entry = config[system];
        return (
          <SettingsField
            key={system}
            label={t(`modal.app_settings.field.workspace.system.${system}`)}
            hint={
              system === current
                ? t(
                    plaintext
                      ? "modal.settings.field.mount.plain_help"
                      : workspaceSystemHasShortcut(system)
                        ? "modal.settings.field.mount.path_help"
                        : "modal.settings.field.mount.phone_help",
                  )
                : t("modal.app_settings.field.workspace.other_system")
            }
            htmlFor={system === current ? pathId : undefined}
            disabled={!active}
          >
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
                driverKind={driver.kind}
                driverMissing={driver.missing}
                driverBusy={driver.busy || !driver.known}
                ensureDriver={driver.ensureInstalled}
                pathId={pathId}
                onChange={onChange}
              />
            ) : (
              <div className="flex flex-col gap-2 opacity-60">
                <PathField
                  value={entry.path}
                  disabled
                  placeholder={t("modal.settings.field.mount.inherit")}
                />
              </div>
            )}
          </SettingsField>
        );
      })}
      {pathIssue ? (
        <p className="text-xs text-on-error-container" role="alert">
          {t(workspacePathIssueI18nKey(pathIssue))}
        </p>
      ) : null}
    </SettingsFormGrid>
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
  driverKind,
  driverMissing,
  driverBusy,
  ensureDriver,
  pathId,
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
  driverKind: MountHostKind;
  driverMissing: boolean;
  driverBusy: boolean;
  ensureDriver: () => Promise<boolean>;
  pathId: string;
  onChange: (patch: Partial<VaultSettingsConfig["mount"]>) => void;
}) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const placeGroup = useId();
  const shortcutGroup = useId();
  const vaultRootService = useVaultRootService();
  const trimmed = entry.path.trim();
  // Another folder can be chosen before its path is typed or picked: that path
  // is the step left, so the option carries the attention border and Save waits.
  const custom = vaultFolderChosen(entry);
  const customPathMissing = custom && trimmed === "";
  const showShortcut = workspaceSystemHasShortcut(system) && !plaintext;
  const workspaceReady = appWorkspacePlace(appEntry) !== "unset";
  const shortcutLocked = !active || !workspaceReady;
  const radiosDisabled = shortcutLocked || custom;
  const driverNeededForOn = showShortcut && !custom && driverMissing;
  const onNeedsDriver = driverNeededForOn && vaultAppShortcut === "on";
  const customNeedsDriver = showShortcut && custom && driverMissing;
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

  // Kept as typed, so a space inside a folder name survives; saving trims it.
  function writePath(path: string) {
    onChange({ [system]: vaultFolderRow(path) });
  }

  function pickFolder(initial: string | null) {
    if (!active) return;
    void (async () => {
      try {
        const picked = await vaultRootService.pickFolder(
          initial,
          t("modal.app_settings.action.pick_workspace_folder"),
        );
        if (!picked?.trim()) return;
        writePath(picked.trim());
      } catch (error) {
        showError(error, "error.unexpected");
      }
    })();
  }

  return (
    <div className={active ? "flex flex-col gap-2" : "flex flex-col gap-2 opacity-60"}>
      <div
        role="radiogroup"
        aria-label={t(`modal.app_settings.field.workspace.system.${system}`)}
        className="grid gap-2"
      >
        <PolicyRadioOption
          groupName={placeGroup}
          value="inherit"
          checked={!custom}
          title={appFolderTitle}
          description={t("modal.settings.field.mount.inherit_desc")}
          disabled={!active}
          muted={!workspaceReady}
          attention={onNeedsDriver}
          onSelect={() => {
            if (!active) return;
            onChange({ [system]: { place: "unset", path: "" } });
          }}
          footer={
            showShortcut ? (
              <div
                role="radiogroup"
                aria-label={t("modal.settings.field.mount.mount")}
                className="grid gap-2"
              >
                <div>
                  <p className="text-sm font-medium leading-snug text-on-surface">
                    {t("modal.settings.field.mount.mount")}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                    {t(
                      workspaceReady
                        ? "modal.settings.field.mount.inherit_shortcut_help"
                        : "modal.settings.field.mount.shortcut_unset",
                    )}
                  </p>
                </div>
                {(["inherit", "on", "off"] as const).map((mode) => (
                  <PolicyRadioOption
                    key={mode}
                    groupName={shortcutGroup}
                    value={mode}
                    checked={vaultAppShortcut === mode}
                    disabled={shortcutLocked || driverBusy}
                    attention={mode === "on" && driverNeededForOn}
                    title={
                      mode === "inherit"
                        ? followTitle
                        : t(`modal.settings.field.mount.shortcut_${mode}`)
                    }
                    onSelect={() => {
                      if (radiosDisabled || driverBusy) return;
                      if (mode !== "on") {
                        onChange({ app_file_manager_folder: mode });
                        return;
                      }
                      void (async () => {
                        if (!(await ensureDriver())) return;
                        onChange({ app_file_manager_folder: "on" });
                      })();
                    }}
                    footer={
                      mode === "on" && driverNeededForOn ? (
                        <FileManagerDriverNotice
                          kind={driverKind}
                          missing
                          busy={driverBusy}
                          onInstall={ensureDriver}
                        />
                      ) : undefined
                    }
                  />
                ))}
              </div>
            ) : null
          }
        />
        <PolicyRadioOption
          groupName={placeGroup}
          value="custom"
          checked={custom}
          title={t("modal.settings.field.mount.custom")}
          description={t("modal.settings.field.mount.custom_desc")}
          disabled={!active}
          attention={customNeedsDriver || customPathMissing}
          onSelect={() => {
            if (!active || custom) return;
            writePath("");
          }}
          footer={
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <PathField
                  id={pathId}
                  className="sm:flex-1"
                  value={entry.path}
                  disabled={!active || !custom}
                  placeholder={t("modal.folder_field.placeholder")}
                  onChange={(path) => {
                    if (!active) return;
                    writePath(path);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className="w-full shrink-0 sm:w-auto"
                  disabled={!active}
                  onClick={() => pickFolder(trimmed || null)}
                >
                  {t("modal.app_settings.action.pick_workspace_folder")}
                </Button>
              </div>
              {showShortcut ? (
                <SwitchRow
                  checked={vaultCustomShortcut}
                  disabled={!active || !custom || driverBusy}
                  onChange={(checked) => {
                    void (async () => {
                      if (checked && !(await ensureDriver())) return;
                      onChange({ custom_file_manager_folder: checked });
                    })();
                  }}
                  label={t("modal.settings.field.mount.mount")}
                  hint={t("modal.settings.field.mount.mount_help")}
                />
              ) : null}
              {customNeedsDriver ? (
                <FileManagerDriverNotice
                  kind={driverKind}
                  missing
                  busy={driverBusy}
                  onInstall={ensureDriver}
                />
              ) : null}
            </div>
          }
        />
      </div>
    </div>
  );
}

interface VaultSettingsKdfSectionProps {
  /** Create-time picker — preset is written to `vault.header`, not `config.toml`. */
  config: { unlock_preset: KdfUnlockPreset };
  onChange: (patch: Partial<{ unlock_preset: KdfUnlockPreset }>) => void;
  /** `.zip` of `store/` import: header already has KDF params. */
  choosesPreset?: boolean;
  /** Header preset for a disabled list. `null` leaves every option unselected. */
  archivePreset?: KdfUnlockPreset | null;
}

export function VaultSettingsKdfSection({
  config,
  onChange,
  choosesPreset = true,
  archivePreset = null,
}: VaultSettingsKdfSectionProps) {
  const { t } = useTranslation();
  const groupName = useId();

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.settings.field.kdf.unlock_preset")}
        hint={t("modal.settings.section.kdf_intro")}
        disabled={!choosesPreset}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.kdf.unlock_preset")}
          className="grid gap-2"
        >
          {KDF_UNLOCK_PRESETS.map((preset) => {
            const meta = KDF_UNLOCK_OPTION_META[preset];
            const selected = choosesPreset ? config.unlock_preset : archivePreset;
            return (
              <PolicyRadioOption
                key={preset}
                groupName={groupName}
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
        </div>
      </SettingsField>
      {!choosesPreset ? (
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("modal.settings.field.kdf.import_package")}
        </p>
      ) : null}
    </SettingsFormGrid>
  );
}

interface VaultSettingsCloseSectionProps {
  autoClose: VaultSettingsConfig["auto_close"];
  onAutoCloseChange: (patch: Partial<VaultSettingsConfig["auto_close"]>) => void;
}

export function VaultSettingsCloseSection({
  autoClose,
  onAutoCloseChange,
}: VaultSettingsCloseSectionProps) {
  const { t } = useTranslation();
  const enabledId = useId();
  const idleId = useId();

  return (
    <SettingsFormGrid>
      <SwitchRow
        id={enabledId}
        checked={autoClose.enabled}
        onChange={(enabled) => onAutoCloseChange({ enabled })}
        label={t("modal.settings.field.auto_close.enabled")}
      />
      <SettingsField
        label={t("modal.settings.field.auto_close.idle_minutes")}
        hint={t("modal.settings.field.auto_close.idle_minutes_help")}
        htmlFor={idleId}
        disabled={!autoClose.enabled}
      >
        <IntegerInput
          id={idleId}
          min={IDLE_AUTO_CLOSE_MINUTES_MIN}
          max={IDLE_AUTO_CLOSE_MINUTES_MAX}
          value={autoClose.idle_minutes}
          disabled={!autoClose.enabled}
          onChange={(idle_minutes) => onAutoCloseChange({ idle_minutes })}
          className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
        />
      </SettingsField>
    </SettingsFormGrid>
  );
}

export function VaultSettingsBackupSection({ config, onChange }: SectionPatchProps<"backup">) {
  const { t } = useTranslation();
  const modeId = useId();
  const keepId = useId();
  const enabledId = useId();
  const skipId = useId();

  return (
    <SettingsFormGrid>
      <SwitchRow
        id={enabledId}
        checked={config.enabled}
        onChange={(enabled) => onChange({ enabled })}
        label={t("modal.settings.field.backup.enabled")}
      />
      <SwitchRow
        id={skipId}
        checked={config.skip_unchanged}
        disabled={!config.enabled}
        onChange={(skip_unchanged) => onChange({ skip_unchanged })}
        label={t("modal.settings.field.backup.skip_unchanged")}
        hint={t("modal.settings.field.backup.skip_unchanged_help")}
      />
      <SettingsField
        label={t("modal.settings.field.backup.mode")}
        htmlFor={modeId}
        disabled={!config.enabled}
      >
        <Select
          id={modeId}
          value={config.mode}
          disabled={!config.enabled}
          aria-label={t("modal.settings.field.backup.mode")}
          onChange={(mode) => onChange({ mode: mode as VaultSettingsConfig["backup"]["mode"] })}
          options={[
            { value: "keep_last", label: t("modal.settings.option.backup.keep_last") },
            { value: "keep_all", label: t("modal.settings.option.backup.keep_all") },
          ]}
        />
      </SettingsField>
      <SettingsField
        label={t("modal.settings.field.backup.keep_last")}
        htmlFor={keepId}
        disabled={!config.enabled || config.mode !== "keep_last"}
      >
        <IntegerInput
          id={keepId}
          min={1}
          max={99}
          value={config.keep_last}
          disabled={!config.enabled || config.mode !== "keep_last"}
          onChange={(keep_last) => onChange({ keep_last })}
          className={[settingsControlClass, "font-mono tabular-nums"].join(" ")}
        />
      </SettingsField>
    </SettingsFormGrid>
  );
}

interface VaultSettingsSevenZipSectionProps extends SectionPatchProps<"seven_zip"> {
  disabled?: boolean;
  /** Nested under a parent radio (export format) — skip the standalone intro. */
  embedded?: boolean;
}

export function VaultSettingsSevenZipSection({
  config,
  onChange,
  disabled = false,
  embedded = false,
}: VaultSettingsSevenZipSectionProps) {
  const { t } = useTranslation();
  const compressionGroup = useId();
  const encryptId = useId();
  const preset = compressionPresetFromSevenZip(config);

  const setPreset = (next: CompressionPreset) => {
    onChange(sevenZipPatchFromCompressionPreset(next));
  };

  return (
    <SettingsFormGrid>
      {embedded ? null : (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("modal.settings.section.seven_zip_intro")}
        </p>
      )}

      <SettingsField
        label={t("modal.settings.field.seven_zip.compression")}
        hint={t("modal.settings.field.seven_zip.compression_help")}
        disabled={disabled}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.seven_zip.compression")}
          className="grid gap-2"
        >
          {COMPRESSION_PRESETS.map((value) => (
            <PolicyRadioOption
              key={value}
              groupName={compressionGroup}
              value={value}
              checked={preset === value}
              disabled={disabled}
              title={t(`modal.settings.option.seven_zip.compression.${value}`)}
              description={t(`modal.settings.option.seven_zip.compression.${value}_desc`)}
              onSelect={() => setPreset(value)}
            />
          ))}
        </div>
      </SettingsField>

      <SwitchRow
        id={encryptId}
        checked={config.encrypt_file_names}
        onChange={(encrypt_file_names) => onChange({ encrypt_file_names })}
        disabled={disabled}
        label={t("modal.settings.field.seven_zip.encrypt_file_names_label")}
        hint={t("modal.settings.field.seven_zip.encrypt_file_names_help")}
      />
      {!disabled && !config.encrypt_file_names ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("modal.settings.field.seven_zip.encrypt_file_names_off_warn")}
        </p>
      ) : null}
    </SettingsFormGrid>
  );
}

interface VaultSettingsGroupSectionProps {
  groups: readonly VaultGroup[];
  selectedGroupId: string;
  newGroupName: string;
  includeHidden?: boolean;
  onSelectedGroupIdChange: (groupId: string) => void;
  onNewGroupNameChange: (name: string) => void;
}

export function VaultSettingsGroupSection({
  groups,
  selectedGroupId,
  newGroupName,
  includeHidden = false,
  onSelectedGroupIdChange,
  onNewGroupNameChange,
}: VaultSettingsGroupSectionProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const creating = Boolean(newGroupName.trim());
  const pickerGroups = groupsForAssignmentPicker(groups, { includeHidden, selectedGroupId });
  const groupOptions = [
    groupAssignmentClearOption(creating ? "" : selectedGroupId, t),
    ...pickerGroups.map((group) => ({ value: group.id, label: group.displayName })),
  ];

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.settings.field.group.new_name_help")}
      </p>
      <SettingsField label={t("vault.group.assignment.section")} disabled={creating}>
        <Select
          value={creating ? "" : selectedGroupId}
          disabled={creating}
          aria-label={t("vault.group.assignment.section")}
          options={groupOptions}
          onChange={onSelectedGroupIdChange}
        />
      </SettingsField>
      <SettingsField
        label={t("modal.settings.field.group.new_name")}
        htmlFor={nameId}
        hint={t("vault.create.group_create_help")}
      >
        <input
          id={nameId}
          type="text"
          value={newGroupName}
          maxLength={VAULT_DISPLAY_NAME_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={liveDisplayNameError(newGroupName, { allowEmpty: true }) ? true : undefined}
          onChange={(event) => onNewGroupNameChange(event.target.value)}
          className={settingsControlClass}
          placeholder={t("vault.group.create.name_label")}
        />
        <DisplayNameFieldError name={newGroupName} allowEmpty />
      </SettingsField>
    </SettingsFormGrid>
  );
}

const POLICY_RADIO_BADGE_CLASS: Record<PolicyRadioBadge, string> = {
  recommended:
    "rounded bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent",
  "more-secure":
    "rounded bg-[color-mix(in_srgb,var(--vault-status-open)_20%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-vault-open",
  "in-use":
    "rounded bg-[color-mix(in_srgb,var(--vault-status-open)_20%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-vault-open",
  default:
    "rounded bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent",
  "less-secure":
    "rounded bg-[color-mix(in_srgb,var(--on-error-container)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-error-container",
  "not-recommended":
    "rounded bg-[color-mix(in_srgb,var(--on-error-container)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-error-container",
};

interface PolicyRadioOptionProps {
  groupName: string;
  value: string;
  checked: boolean;
  title: string;
  /** Optional leading icon (sits before the title). */
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
  /** Gray, still selectable. The file manager folder inside can stay locked. */
  muted?: boolean;
  /** One badge, or several shown in this order. */
  badge?: PolicyRadioBadge | readonly PolicyRadioBadge[];
  tone?: "default" | "less-secure";
  /**
   * Yellow/amber border while this option still needs follow-up config
   * (e.g. vault-root incomplete policy). Overrides the accent border when checked.
   */
  attention?: boolean;
  /**
   * The option's own controls under the description. Pass them whether or not
   * the option is chosen: they always show, disabled until it is.
   */
  footer?: ReactNode;
  /** Click on an already-selected card (not its footer controls). */
  onCardPress?: () => void;
  onSelect: () => void;
}

export function PolicyRadioOption({
  groupName,
  value,
  checked,
  title,
  icon,
  description,
  disabled = false,
  muted = false,
  badge,
  tone = "default",
  attention = false,
  footer,
  onCardPress,
  onSelect,
}: PolicyRadioOptionProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const isLessSecure = tone === "less-secure";

  const cardBgClass = isLessSecure
    ? "bg-[color-mix(in_srgb,var(--error-container)_7%,var(--surface-container))]"
    : "bg-surface-container";

  const cardHoverClass = isLessSecure
    ? "hover:bg-[color-mix(in_srgb,var(--error-container)_11%,var(--surface-container))]"
    : "hover:bg-surface-container-highest/60";

  const borderClass = checked
    ? attention
      ? "border-2 border-[var(--vault-status-recovery)]"
      : "border-2 border-[var(--accent)]"
    : "border border-outline-variant";

  const radioClass =
    "mt-0.5 h-4 w-4 shrink-0 rounded-full border border-outline-variant accent-accent text-accent focus:ring-0 focus-visible:ring-0";

  return (
    <label
      htmlFor={inputId}
      className={[
        "block select-none rounded-xl p-2.5 transition-colors sm:p-3",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        muted && !disabled ? "opacity-60" : "",
        cardBgClass,
        borderClass,
        !checked && !disabled ? cardHoverClass : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (!disabled && checked) onCardPress?.();
      }}
    >
      <span className="flex gap-2.5 sm:gap-3">
        <input
          id={inputId}
          type="radio"
          name={groupName}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => {
            if (!disabled) onSelect();
          }}
          className={radioClass}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {icon ? (
              <span className="inline-flex shrink-0 text-on-surface-variant">{icon}</span>
            ) : null}
            <span className="text-sm font-medium leading-snug text-on-surface">{title}</span>
            {policyRadioBadgeList(badge).map((item) => (
              <span key={item} className={POLICY_RADIO_BADGE_CLASS[item]}>
                {t(POLICY_RADIO_BADGE_I18N[item])}
              </span>
            ))}
          </span>
          {description ? (
            <span className="mt-1.5 block text-xs leading-relaxed text-on-surface-variant">
              {description}
            </span>
          ) : null}
        </span>
      </span>
      {footer ? (
        // Always shown. Until the option is chosen every control in it is
        // disabled (the fieldset reaches keyboard focus too), and a click on
        // it falls through to the card, which chooses the option.
        <fieldset
          disabled={!checked}
          className={["mt-3 min-w-0 pl-6 sm:pl-7", checked ? "" : "pointer-events-none opacity-60"]
            .filter(Boolean)
            .join(" ")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {footer}
        </fieldset>
      ) : null}
    </label>
  );
}

interface VaultSettingsDangerZoneSectionProps {
  vaultId: string;
  deleteOpen: boolean;
  deleteConfirm: string;
  confirmInputId: string;
  canConfirmDelete: boolean;
  busy?: boolean;
  enabled?: boolean;
  /** Closed or recovery. When false the button stays off and the reason is shown. */
  allowed?: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onConfirmChange: (value: string) => void;
}

export function VaultSettingsDangerZoneSection({
  vaultId,
  deleteOpen,
  deleteConfirm,
  confirmInputId,
  canConfirmDelete,
  busy = false,
  enabled = true,
  allowed = true,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onConfirmChange,
}: VaultSettingsDangerZoneSectionProps) {
  const { t } = useTranslation();
  const confirmRef = useRevealWhen<HTMLDivElement>(deleteOpen);

  if (!deleteOpen) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">{t("modal.settings.danger_zone_help")}</p>
        {allowed ? null : (
          <p className="text-sm text-on-surface-variant">
            {t("modal.settings.delete_only_closed")}
          </p>
        )}
        <Button
          variant="danger"
          size="sm"
          onClick={onRequestDelete}
          disabled={busy || !enabled || !allowed}
        >
          {t("modal.settings.delete_vault")}
        </Button>
      </div>
    );
  }

  return (
    <div ref={confirmRef} className="space-y-3">
      <p className="text-sm text-on-surface-variant">{t("modal.settings.delete_confirm")}</p>
      <p className="font-mono text-xs text-on-surface-variant/80">{vaultId}</p>
      <input
        id={confirmInputId}
        type="text"
        value={deleteConfirm}
        onChange={(event) => onConfirmChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        className={settingsControlClass}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancelDelete} disabled={busy}>
          {t("action.cancel")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!canConfirmDelete || busy || !allowed}
          onClick={onConfirmDelete}
        >
          {t("action.delete")}
        </Button>
      </div>
    </div>
  );
}
