import type { VaultBackupEntry, VaultBackupSection } from "../backups";
import { deviceName } from "../device";
import { choiceNameLabel, fixedChoiceLabel } from "../folder-lists";
import { formatBytes } from "../format/bytes";
import { formatIsoDate } from "../format/datetime";
import { vaultLastAccessedLabel } from "../vault-list/lastAccessed";
import { withOpenPath, type InfoSection, type InfoTranslate } from "../info";
import { KDF_UNLOCK_OPTION_META } from "../vault-settings/kdf";
import {
  idleWarnLeadSeconds,
  resolveVaultListStatus,
  vaultStatusLabelKey,
  type VaultPipelineListStatus,
} from "../vault";
import type { VaultInfoSnapshot } from "./types";

const SESSION_KEYS = {
  open: "modal.info.value.session.open",
  closing: "modal.info.value.session.closing",
  recovery: "modal.info.value.session.recovery",
} as const;

const STORAGE_KEYS = {
  encrypted_dir: "modal.settings.option.storage.encrypted_dir",
  upriv_plain: "modal.settings.option.storage.upriv_plain",
} as const;

function yesNo(t: InfoTranslate, value: boolean): string {
  return t(value ? "modal.info.value.yes" : "modal.info.value.no");
}

function emptyDash(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function countOrDash(value: number | null): string {
  return value == null ? "—" : String(value);
}

function backupTotalBytes(backups: VaultBackupEntry[]): number {
  return backups.reduce((sum, entry) => sum + entry.sizeBytes, 0);
}

function latestBackupName(backups: VaultBackupEntry[]): string {
  const latest = [...backups].sort((a, b) => {
    const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return byTime !== 0 ? byTime : a.fileName.localeCompare(b.fileName);
  })[0];
  return latest ? latest.fileName : "—";
}

function measured(value: number | null | "measuring", t: InfoTranslate): string {
  return value === "measuring" ? t("modal.info.loading") : formatBytes(value ?? undefined);
}

/** A folder holding zips, with the device that wrote there. */
function sectionValue(section: VaultBackupSection, t: InfoTranslate): string {
  return section.device
    ? `${section.path} · ${deviceName(section.device.id, section.device.system, t)}`
    : section.path;
}

export function buildVaultInfoSections(
  snapshot: VaultInfoSnapshot,
  t: InfoTranslate,
  pipeline: VaultPipelineListStatus = {},
): InfoSection[] {
  const {
    vault,
    settings,
    kdfPreset,
    groupName,
    groupHidden,
    backupSections,
    runtime,
    passwordInSession,
    unlockedFolder,
    storePath,
    backupsPath,
    storeOpenPath,
    backupsOpenPath,
    locale,
  } = snapshot;

  const displayStatus = resolveVaultListStatus(vault, pipeline);
  const fileManagerEligible = displayStatus === "open";

  const identityFields = [
    { id: "display_name", label: t("modal.info.field.display_name"), value: vault.displayName },
    { id: "vault_id", label: t("modal.info.field.vault_id"), value: vault.id },
    {
      id: "display_order",
      label: t("modal.info.field.display_order"),
      value: vault.order != null ? String(vault.order) : "—",
    },
    { id: "group", label: t("modal.info.field.group"), value: emptyDash(groupName) },
    {
      id: "hidden",
      label: t("modal.info.field.hidden"),
      value: yesNo(t, Boolean(vault.hidden)),
    },
    {
      id: "hidden_locked_by_group",
      label: t("modal.info.field.hidden_locked_by_group"),
      value: yesNo(t, groupHidden),
    },
    { id: "note", label: t("modal.info.field.note"), value: emptyDash(vault.note) },
    {
      id: "password_hint",
      label: t("modal.info.field.password_hint"),
      value: emptyDash(vault.passwordHint),
    },
  ];

  const statusFields = [
    {
      id: "display_status",
      label: t("modal.info.field.display_status"),
      value: t(vaultStatusLabelKey(displayStatus, vault.id, pipeline, vault.autoClosed === true)),
    },
    {
      id: "session",
      label: t("modal.info.field.session"),
      value: vault.session ? t(SESSION_KEYS[vault.session]) : t("modal.info.value.session.none"),
    },
    {
      id: "storage_mode",
      label: t("modal.info.field.storage_mode"),
      value: t(STORAGE_KEYS[vault.storageMode]),
    },
    {
      id: "last_accessed",
      label: t("modal.info.field.last_accessed"),
      value: vaultLastAccessedLabel(vault, locale),
    },
    {
      id: "last_accessed_at",
      label: t("modal.info.field.last_accessed_at"),
      value: emptyDash(vault.lastAccessedAt),
    },
    {
      id: "file_manager",
      label: t("modal.info.field.file_manager"),
      value: t(fileManagerEligible ? "modal.info.value.eligible" : "modal.info.value.not_eligible"),
    },
  ];

  const runtimeFields = [
    {
      id: "open_count",
      label: t("modal.info.field.open_count"),
      value: countOrDash(runtime.openCount),
    },
    {
      id: "last_opened_at",
      label: t("modal.info.field.last_opened_at"),
      value: runtime.lastOpenedAt ? formatIsoDate(runtime.lastOpenedAt, locale) : "—",
    },
    {
      id: "password_in_session",
      label: t("modal.info.field.password_in_session"),
      value: yesNo(t, passwordInSession),
    },
    {
      id: "session_ram",
      label: t("modal.info.field.session_ram"),
      value: formatBytes(runtime.sessionRamBytes ?? undefined),
    },
    {
      id: "kdf_unlock_ram",
      label: t("modal.info.field.kdf_unlock_ram"),
      value: kdfPreset ? t(KDF_UNLOCK_OPTION_META[kdfPreset].titleKey) : "—",
    },
    {
      id: "logical_file_count",
      label: t("modal.info.field.file_count"),
      value: countOrDash(runtime.logicalFileCount),
    },
  ];

  const storageFields = [
    withOpenPath(
      { id: "store_path", label: t("modal.info.field.store_path"), value: storePath },
      storeOpenPath,
    ),
    withOpenPath(
      { id: "backups_path", label: t("modal.info.field.backups_path"), value: backupsPath },
      backupsOpenPath,
    ),
    {
      id: "store_size",
      label: t("modal.info.field.store_size"),
      value: measured(runtime.storeBytes, t),
    },
    {
      id: "files_size",
      label: t("modal.info.field.files_size"),
      value: measured(runtime.filesBytes, t),
    },
    // Only a vault that set data aside shows the row.
    ...(typeof runtime.heldBytes === "number" && runtime.heldBytes > 0
      ? [
          {
            id: "held_size",
            label: t("modal.info.field.held_size"),
            value: formatBytes(runtime.heldBytes),
          },
        ]
      : []),
  ];

  const cryptoFields = [
    {
      id: "kdf_preset",
      label: t("modal.info.field.kdf_preset"),
      value: kdfPreset ? t(KDF_UNLOCK_OPTION_META[kdfPreset].titleKey) : "—",
    },
    {
      id: "password_changed_at",
      label: t("modal.info.field.password_changed_at"),
      value: settings?.security.password_changed_at
        ? formatIsoDate(settings.security.password_changed_at, locale)
        : "—",
    },
  ];

  const unlockedPath = unlockedFolder?.path ?? "";
  const unlockedFields = [
    {
      id: "unlocked_folder_choice",
      label: t("modal.info.field.unlocked_folder_choice"),
      value: unlockedFolder ? choiceNameLabel(unlockedFolder.choice, t) : t("modal.info.loading"),
    },
    withOpenPath(
      {
        id: "unlocked_folder_path",
        label: t("modal.info.field.unlocked_folder_path"),
        value: emptyDash(unlockedPath),
      },
      unlockedPath,
    ),
    ...(vault.storageMode === "encrypted_dir"
      ? [
          {
            id: "unlocked_folder_mounted",
            label: t("modal.info.field.unlocked_folder_mounted"),
            value: yesNo(t, unlockedFolder?.mounted === true),
          },
          ...(settings
            ? [
                {
                  id: "unlocked_folder_encrypted",
                  label: t("modal.info.field.unlocked_folder_encrypted"),
                  value: t(
                    `modal.info.value.encrypted_switch.${settings.unlocked_folder.encrypted}`,
                  ),
                },
              ]
            : []),
        ]
      : []),
  ];

  const configFields = settings
    ? [
        ...(settings.storage.mode === "upriv_plain"
          ? [
              {
                id: "plain_files",
                label: t("modal.info.field.plain_files"),
                value: t(`modal.info.value.plain_files.${settings.storage.plain_files}`),
              },
            ]
          : []),
        {
          id: "backup_enabled",
          label: t("modal.info.field.backup_enabled"),
          value: yesNo(t, settings.backup.enabled),
        },
        {
          id: "backup_skip_unchanged",
          label: t("modal.settings.field.backup.skip_unchanged"),
          value: yesNo(t, settings.backup.skip_unchanged),
        },
        {
          id: "backup_keep_last",
          label: t("modal.settings.field.backup.keep_last"),
          value: String(settings.backup.keep_last),
        },
        {
          id: "auto_close",
          label: t("modal.info.field.auto_close"),
          value: settings.auto_close.enabled
            ? t("modal.info.value.auto_close_on_warn", {
                minutes: String(settings.auto_close.idle_minutes),
                seconds: String(idleWarnLeadSeconds(settings.auto_close.idle_minutes)),
              })
            : t("modal.info.value.no"),
        },
        {
          id: "auto_close_when_busy",
          label: t("modal.info.field.auto_close_when_busy"),
          value: t(`modal.settings.field.auto_close.when_busy.${settings.auto_close.when_busy}`),
        },
        {
          id: "file_manager_confirm_delete",
          label: t("modal.settings.field.file_manager.confirm_delete"),
          value: yesNo(t, settings.file_manager.confirm_delete),
        },
      ]
    : [{ id: "config_unavailable", label: t("modal.info.field.config"), value: "—" }];

  const listing = t("modal.info.loading");
  const backups = backupSections?.flatMap((section) => section.entries) ?? null;
  const inUse = backupSections?.find((section) => section.kind === "in_use");
  const backupFields = [
    {
      id: "backup_folder_in_use",
      label: t("modal.info.field.backup_folder_in_use"),
      value: backupSections
        ? inUse
          ? sectionValue(inUse, t)
          : fixedChoiceLabel("data_folder", t)
        : listing,
      ...(inUse ? { openPath: inUse.path } : {}),
    },
    ...(backupSections ?? [])
      .filter((section) => section.entries.length > 0)
      .map((section) =>
        withOpenPath(
          {
            id: `backup_folder_${section.folder}`,
            label: t("modal.info.field.backup_folder_holding", {
              count: section.entries.length,
            }),
            value: sectionValue(section, t),
          },
          section.path,
        ),
      ),
    {
      id: "backup_count",
      label: t("modal.info.field.backup_count"),
      value: backups ? String(backups.length) : listing,
    },
    {
      id: "backup_latest",
      label: t("modal.info.field.backup_latest"),
      value: backups ? latestBackupName(backups) : listing,
    },
    {
      id: "backup_total_size",
      label: t("modal.info.field.backup_total_size"),
      value: backups ? formatBytes(backupTotalBytes(backups)) : listing,
    },
  ];

  return [
    { id: "identity", title: t("modal.info.section.identity"), fields: identityFields },
    { id: "status", title: t("modal.info.section.status"), fields: statusFields },
    { id: "runtime", title: t("modal.info.section.runtime"), fields: runtimeFields },
    { id: "storage", title: t("modal.info.section.storage"), fields: storageFields },
    {
      id: "unlocked_folder",
      title: t("modal.info.section.unlocked_folder"),
      fields: unlockedFields,
    },
    { id: "crypto", title: t("modal.info.section.crypto"), fields: cryptoFields },
    { id: "config", title: t("modal.info.section.config"), fields: configFields },
    { id: "backups", title: t("modal.info.section.backups"), fields: backupFields },
  ];
}
