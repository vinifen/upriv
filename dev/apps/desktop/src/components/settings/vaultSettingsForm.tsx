import { useCallback, useId, type ReactNode } from "react";
import { Button, Select, SwitchRow } from "@/components/ui";
import { useRevealWhen } from "@/hooks/useRevealWhen";
import {
  AUTO_CLOSE_WHEN_BUSY,
  COMPRESSION_PRESETS,
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  POLICY_RADIO_BADGE_I18N,
  APP_BACKUP_LIST,
  APP_UNLOCKED_LIST,
  VAULT_BACKUP_LIST,
  VAULT_UNLOCKED_LIST,
  policyRadioBadgeList,
  IDLE_AUTO_CLOSE_MINUTES_MAX,
  IDLE_AUTO_CLOSE_MINUTES_MIN,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_NOTE_MAX_LENGTH,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  compressionPresetFromSevenZip,
  encryptedFolderOn,
  encryptedFolderUnchosen,
  folderStatusLine,
  isPhoneSystem,
  selectionHere,
  selectionLabel,
  sevenZipPatchFromCompressionPreset,
  type AppBackupFolders,
  type AppUnlockedFolders,
  type CompressionPreset,
  type DeviceGroups,
  type FolderRow,
  type EncryptedFolderSwitch,
  type HereDevice,
  type KdfUnlockPreset,
  type PolicyRadioBadge,
  type VaultBackupChoice,
  type VaultConfigEditHold,
  type VaultDeleteHold,
  type VaultGroup,
  type VaultSettingsConfig,
  groupsForAssignmentPicker,
  groupAssignmentClearOption,
  requireVaultConfigEditLockedI18nKey,
  liveDisplayNameError,
  displayNameErrorI18nKey,
  VAULT_DELETE_HOLD_I18N_KEY,
} from "@upriv/shared";
import { useFolderStatuses } from "@upriv/shared/react";
import { FolderList, StatusLine } from "@/components/folder-list";
import { useTranslation } from "@/i18n";
import { useFolderListService, useVaultRootService } from "@/platform/services";
import { IntegerInput } from "./IntegerInput";
import { UnlockedFolderDriverNotice, useUnlockedFolderDriver } from "./unlockedFolderDriver";

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
  /** Work beside the vault's status that locks fields (`vaultConfigEditHold`). */
  editHold?: VaultConfigEditHold;
  fileManager: VaultSettingsConfig["file_manager"];
  onFileManagerChange: (patch: Partial<VaultSettingsConfig["file_manager"]>) => void;
}

export function VaultSettingsVaultSection({
  config,
  onChange,
  hiddenLocked = false,
  displayNameLocked = false,
  editHold,
  fileManager,
  onFileManagerChange,
}: VaultSettingsVaultSectionProps) {
  const { t } = useTranslation();
  const displayNameId = useId();
  const orderId = useId();
  const hintId = useId();
  const noteId = useId();
  const hiddenId = useId();
  const confirmDeleteId = useId();

  return (
    <SettingsFormGrid>
      <SettingsField
        label={t("modal.settings.field.vault.display_name")}
        htmlFor={displayNameId}
        disabled={displayNameLocked}
        hint={
          displayNameLocked
            ? t(requireVaultConfigEditLockedI18nKey("vault.display_name", editHold))
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
      <SwitchRow
        id={confirmDeleteId}
        checked={fileManager.confirm_delete}
        onChange={(confirm_delete) => onFileManagerChange({ confirm_delete })}
        label={t("modal.settings.field.file_manager.confirm_delete")}
        hint={t("modal.settings.field.file_manager.confirm_delete_help")}
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
  /** `storage.plain_files` needs the vault closed or in recovery. */
  plainFilesLocked?: boolean;
  /** Work beside the vault's status that locks fields (`vaultConfigEditHold`). */
  editHold?: VaultConfigEditHold;
}

export function VaultSettingsStorageSection({
  config,
  onChange,
  storageModeLocked = false,
  plainFilesLocked = false,
  editHold,
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
            {t(requireVaultConfigEditLockedI18nKey("storage.mode", editHold))}
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
            footer={
              <SwitchRow
                checked={config.plain_files === "chosen"}
                disabled={plainFilesLocked}
                onChange={(chosen) => onChange({ plain_files: chosen ? "chosen" : "whole" })}
                label={t("modal.settings.field.storage.plain_files")}
                hint={t(
                  plainFilesLocked
                    ? requireVaultConfigEditLockedI18nKey("storage.plain_files")
                    : "modal.settings.field.storage.plain_files_help",
                )}
              />
            }
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

/**
 * The status line of each of this device's rows of an unlocked folder or
 * backup list, each checked on its own (`folder_status`), and the vaults open
 * in a row's folder now (`openIn`), which keep that row in the list.
 */
export function useRowStatuses<F extends string>(
  list: "unlocked" | "backup",
  groups: DeviceGroups<F>,
  here: HereDevice | null,
  vaultId: string | null,
) {
  const { t } = useTranslation();
  const folderLists = useFolderListService();
  const paths = (here ? groups[here.id]?.rows : undefined)?.map((row) => row.path) ?? [];
  const check = useCallback(
    (path: string) => folderLists.status(list, path, vaultId),
    [folderLists, list, vaultId],
  );
  const { statuses } = useFolderStatuses(paths, check);
  const renderStatus = useCallback(
    (path: string) => {
      const key = path.trim();
      // A check that could not run leaves the row with no status line.
      if (!statuses.has(key)) return null;
      return <StatusLine line={folderStatusLine(statuses.get(key) ?? null, list, t)} />;
    },
    [list, statuses, t],
  );
  const openIn = useCallback(
    (path: string): readonly string[] => statuses.get(path.trim())?.details?.openVaults ?? [],
    [statuses],
  );
  return { renderStatus, openIn };
}

/** Where the folder picker of a list starts on this computer. */
export function usePickFolder() {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  return useCallback(
    (start: string | null) => vaultRoot.pickFolder(start, t("folder_list.action.browse")),
    [t, vaultRoot],
  );
}

interface VaultSettingsUnlockedFolderSectionProps extends SectionPatchProps<"unlocked_folder"> {
  /** As loaded; an empty list for a vault being created. */
  saved: VaultSettingsConfig["unlocked_folder"];
  here: HereDevice | null;
  /** The vault's id; `null` while it is being created. */
  vaultId: string | null;
  /** The app's unlocked folders: what Use the app's means here. */
  appUnlocked: AppUnlockedFolders;
  /** A plain-text vault writes its files there and has no switch. */
  plaintext: boolean;
  /** Why this device's group cannot change now (`unlocked_folder` gate); `null` when it can. */
  lockedHint?: string | null;
  /**
   * The list says when the vault should get a folder and none is chosen on
   * this device. The create wizard reports that as its step's error instead.
   */
  showUnchosen?: boolean;
}

/**
 * The vault's unlocked folder: the encrypted switch for every device, and
 * the vault's own list of folders on this device.
 */
export function VaultSettingsUnlockedFolderSection({
  config,
  onChange,
  saved,
  here,
  vaultId,
  appUnlocked,
  plaintext,
  lockedHint = null,
  showUnchosen = true,
}: VaultSettingsUnlockedFolderSectionProps) {
  const { t } = useTranslation();
  const switchId = useId();
  const driver = useUnlockedFolderDriver();
  const { renderStatus, openIn } = useRowStatuses("unlocked", config.devices, here, vaultId);
  const pickFolder = usePickFolder();
  const phone = here ? isPhoneSystem(here.system) : false;
  const hereId = here?.id ?? null;
  // Core keeps a saved row while a vault is open in its folder: it may not
  // go or change its path then.
  const savedRows = hereId ? (saved.devices[hereId]?.rows ?? []) : [];
  const rowInUse = (row: FolderRow) =>
    savedRows.some((old) => old.number === row.number && old.path.trim() === row.path.trim()) &&
    openIn(row.path).length > 0;
  const appChoice = selectionLabel(
    selectionHere(appUnlocked.devices, hereId, APP_UNLOCKED_LIST),
    hereId ? appUnlocked.devices[hereId] : undefined,
    t,
  );
  const inheritState = t(
    appUnlocked.encrypted_vaults
      ? "modal.settings.option.unlocked_folder.encrypted.on"
      : "modal.settings.option.unlocked_folder.encrypted.off",
  );

  const folderWanted = !plaintext && encryptedFolderOn(appUnlocked, config);
  const unchosen = showUnchosen && !plaintext && encryptedFolderUnchosen(appUnlocked, config, here);

  const setEncrypted = (encrypted: EncryptedFolderSwitch) => {
    const turnsOn = encryptedFolderOn(appUnlocked, { ...config, encrypted });
    void (async () => {
      if (turnsOn && !(await driver.ensureInstalled())) return;
      onChange({ encrypted });
    })();
  };

  return (
    <SettingsFormGrid>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t(
          plaintext
            ? "modal.settings.section.unlocked_folder_intro_plain"
            : "modal.settings.section.unlocked_folder_intro",
        )}
      </p>
      {plaintext ? null : (
        <SettingsField
          label={t("modal.settings.field.unlocked_folder.encrypted")}
          hint={t(
            phone
              ? "modal.settings.field.unlocked_folder.phone"
              : "modal.settings.field.unlocked_folder.encrypted_help",
          )}
          htmlFor={switchId}
          disabled={phone}
        >
          <Select
            id={switchId}
            value={config.encrypted}
            disabled={phone || !driver.known || driver.busy || lockedHint !== null}
            aria-label={t("modal.settings.field.unlocked_folder.encrypted")}
            onChange={(value) => setEncrypted(value as EncryptedFolderSwitch)}
            options={[
              {
                value: "inherit",
                label: t("modal.settings.option.unlocked_folder.encrypted.inherit", {
                  state: inheritState,
                }),
              },
              { value: "on", label: t("modal.settings.option.unlocked_folder.encrypted.on") },
              { value: "off", label: t("modal.settings.option.unlocked_folder.encrypted.off") },
            ]}
          />
          <UnlockedFolderDriverNotice
            kind={driver.kind}
            missing={folderWanted && driver.missing}
            busy={driver.busy}
            onInstall={driver.ensureInstalled}
          />
        </SettingsField>
      )}
      <FolderList
        label={t("modal.settings.field.unlocked_folder.list")}
        policy={VAULT_UNLOCKED_LIST}
        groups={config.devices}
        saved={saved.devices}
        here={here}
        lockedHint={lockedHint}
        selectionMissing={unchosen ? t("modal.settings.field.unlocked_folder.unchosen") : null}
        fixed={[
          {
            choice: "inherit",
            title: t("folder_list.choice.inherit"),
            description: t("folder_list.choice.inherit_now", { choice: appChoice }),
          },
        ]}
        renderStatus={renderStatus}
        rowInUse={rowInUse}
        // A vault being created has nothing saved yet.
        markUnsaved={vaultId !== null}
        pickFolder={pickFolder}
        onChange={(devices) => onChange({ devices })}
      />
    </SettingsFormGrid>
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
  const whenBusyGroup = useId();

  return (
    <SettingsFormGrid>
      <SwitchRow
        id={enabledId}
        checked={autoClose.enabled}
        onChange={(enabled) => onAutoCloseChange({ enabled })}
        label={t("modal.settings.field.auto_close.enabled")}
      />
      <SettingsField
        label={t("modal.settings.field.auto_close.when_busy")}
        hint={t("modal.settings.field.auto_close.when_busy_help")}
        disabled={!autoClose.enabled}
      >
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.auto_close.when_busy")}
          className="grid gap-2"
        >
          {AUTO_CLOSE_WHEN_BUSY.map((value) => (
            <PolicyRadioOption
              key={value}
              groupName={whenBusyGroup}
              value={value}
              checked={autoClose.when_busy === value}
              disabled={!autoClose.enabled}
              title={t(`modal.settings.field.auto_close.when_busy.${value}`)}
              onSelect={() => onAutoCloseChange({ when_busy: value })}
            />
          ))}
        </div>
      </SettingsField>
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

interface VaultSettingsBackupSectionProps extends SectionPatchProps<"backup"> {
  /** As loaded; an empty list for a vault being created. */
  saved: DeviceGroups<VaultBackupChoice>;
  here: HereDevice | null;
  /** The vault's id; `null` while it is being created. */
  vaultId: string | null;
  /** The app's backup folders: what Use the app's means here. */
  appBackups: AppBackupFolders;
}

export function VaultSettingsBackupSection({
  config,
  onChange,
  saved,
  here,
  vaultId,
  appBackups,
}: VaultSettingsBackupSectionProps) {
  const { t } = useTranslation();
  const modeId = useId();
  const keepId = useId();
  const enabledId = useId();
  const skipId = useId();
  const { renderStatus } = useRowStatuses("backup", config.devices, here, vaultId);
  const pickFolder = usePickFolder();
  const hereId = here?.id ?? null;
  const appChoice = selectionLabel(
    selectionHere(appBackups.devices, hereId, APP_BACKUP_LIST),
    hereId ? appBackups.devices[hereId] : undefined,
    t,
  );

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
      <SettingsField
        label={t("modal.settings.field.backup.folder")}
        hint={t("modal.settings.field.backup.folder_help")}
      >
        <FolderList
          label={t("modal.settings.field.backup.folder")}
          policy={VAULT_BACKUP_LIST}
          groups={config.devices}
          saved={saved}
          here={here}
          fixed={[
            {
              choice: "inherit",
              title: t("folder_list.choice.inherit"),
              description: t("folder_list.choice.inherit_now", { choice: appChoice }),
            },
            {
              choice: "data_folder",
              title: t("folder_list.choice.data_folder"),
              description: t("modal.settings.field.backup.folder_data_desc"),
            },
          ]}
          renderStatus={renderStatus}
          markUnsaved={vaultId !== null}
          pickFolder={pickFolder}
          onChange={(devices) => onChange({ devices })}
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
  insecure:
    "rounded bg-[color-mix(in_srgb,var(--on-error-container)_25%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-error-container",
};

/** Card fill and hover per risk tone. `insecure` is the strongest: nothing is encrypted. */
const POLICY_RADIO_TONE_CLASS = {
  default: {
    card: "bg-surface-container",
    hover: "hover:bg-surface-container-highest/60",
  },
  "less-secure": {
    card: "bg-[color-mix(in_srgb,var(--error-container)_7%,var(--surface-container))]",
    hover: "hover:bg-[color-mix(in_srgb,var(--error-container)_11%,var(--surface-container))]",
  },
  insecure: {
    card: "bg-[color-mix(in_srgb,var(--error-container)_14%,var(--surface-container))]",
    hover: "hover:bg-[color-mix(in_srgb,var(--error-container)_20%,var(--surface-container))]",
  },
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
  tone?: keyof typeof POLICY_RADIO_TONE_CLASS;
  /**
   * Yellow/amber border while this option still needs follow-up config
   * (e.g. vault-root incomplete policy). Overrides the accent or red border when
   * checked.
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
  const toneClass = POLICY_RADIO_TONE_CLASS[tone];
  const insecure = tone === "insecure";

  const borderClass = checked
    ? attention
      ? "border-2 border-[var(--vault-status-recovery)]"
      : insecure
        ? "border-2 border-[var(--danger-border)]"
        : "border-2 border-[var(--accent)]"
    : insecure
      ? "border border-[var(--danger-border)]"
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
        toneClass.card,
        borderClass,
        !checked && !disabled ? toneClass.hover : "",
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
  /** Why Delete waits (`vaultDeleteHold`). While set the button stays off and the reason shows. */
  hold?: VaultDeleteHold | null;
  /** This vault has backups outside the data folder, so the switch shows. */
  outsideBackups?: boolean;
  removeOutsideBackups?: boolean;
  onRemoveOutsideBackupsChange?: (remove: boolean) => void;
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
  hold = null,
  outsideBackups = false,
  removeOutsideBackups = false,
  onRemoveOutsideBackupsChange,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onConfirmChange,
}: VaultSettingsDangerZoneSectionProps) {
  const { t } = useTranslation();
  const confirmRef = useRevealWhen<HTMLDivElement>(deleteOpen);
  const allowed = hold === null;

  if (!deleteOpen) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">{t("modal.settings.danger_zone_help")}</p>
        {hold ? (
          <p className="text-sm text-on-surface-variant">{t(VAULT_DELETE_HOLD_I18N_KEY[hold])}</p>
        ) : null}
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
      {outsideBackups ? (
        <SwitchRow
          checked={removeOutsideBackups}
          disabled={busy}
          onChange={(remove) => onRemoveOutsideBackupsChange?.(remove)}
          label={t("modal.settings.delete_outside_backups")}
          hint={t("modal.settings.delete_outside_backups_help")}
        />
      ) : null}
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
