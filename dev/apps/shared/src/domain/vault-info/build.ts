import type { VaultBackupEntry, VaultBackupSection } from "../backups";
import { deviceName, type OsNames } from "../device";
import { choiceNameLabel, fixedChoiceLabel } from "../folder-lists";
import { formatBytes } from "../format/bytes";
import { formatIsoDate } from "../format/datetime";
import { vaultLastAccessedLabel } from "../vault-list/lastAccessed";
import {
  loadingField,
  withOpenPath,
  type InfoField,
  type InfoSection,
  type InfoTranslate,
} from "../info";
import { KDF_UNLOCK_OPTION_META } from "../vault-settings/kdf";
import type { VaultSettingsConfig } from "../vault-settings";
import type { VaultKeyStatus } from "../vault/keyChanges";
import type { VaultSession } from "../vault/types";
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
  deleting: "modal.info.value.session.deleting",
  importing: "modal.info.value.session.importing",
} as const satisfies Record<VaultSession, string>;

const PASSWORD_CHANGE_KEYS = {
  none: "modal.info.value.password_change.none",
  pending: "modal.info.value.password_change.pending",
  unfinished: "modal.info.value.password_change.unfinished",
} as const;

/** The key copies of an open vault's files, from its key status. */
function keyCopiesValue(status: VaultKeyStatus, t: InfoTranslate): string {
  if (status.keyCopiesUpdating) return t("modal.info.value.key_copies.updating");
  return t(
    status.keyCopiesDue ? "modal.info.value.key_copies.due" : "modal.info.value.key_copies.done",
  );
}

const STORAGE_KEYS = {
  encrypted_dir: "modal.storage.option.encrypted_dir",
  upriv_plain: "modal.storage.option.upriv_plain",
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

/** A size row: loading while it is measured, then the size (a dash when it did not run). */
function sizeField(id: string, label: string, value: number | null | "measuring"): InfoField {
  return value === "measuring"
    ? loadingField(id, label)
    : { id, label, value: formatBytes(value ?? undefined) };
}

/** A folder holding zips, with the device that wrote there. */
function sectionValue(section: VaultBackupSection, osNames: OsNames, t: InfoTranslate): string {
  return section.device
    ? `${section.path} · ${deviceName(section.device.id, section.device.system, osNames, t)}`
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
    keyStatus,
    paths,
    locale,
    osNames,
  } = snapshot;
  const config = settings === "reading" ? null : settings;

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
      value: t(vaultStatusLabelKey(displayStatus, vault.id, pipeline, vault)),
    },
    {
      id: "session",
      label: t("modal.info.field.session"),
      value: vault.session ? t(SESSION_KEYS[vault.session]) : t("modal.info.value.session.none"),
    },
    // A vault in recovery for a cut-off import says when that import began.
    ...(vault.importUnfinished
      ? [
          settings === "reading"
            ? loadingField("import_started_at", t("modal.info.field.import_started_at"))
            : {
                id: "import_started_at",
                label: t("modal.info.field.import_started_at"),
                value: config?.importing?.started_at
                  ? formatIsoDate(config.importing.started_at, locale)
                  : "—",
              },
        ]
      : []),
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
    paths
      ? withOpenPath(
          { id: "store_path", label: t("modal.info.field.store_path"), value: paths.storePath },
          paths.storeOpenPath,
        )
      : loadingField("store_path", t("modal.info.field.store_path")),
    paths
      ? withOpenPath(
          {
            id: "backups_path",
            label: t("modal.info.field.backups_path"),
            value: paths.backupsPath,
          },
          paths.backupsOpenPath,
        )
      : loadingField("backups_path", t("modal.info.field.backups_path")),
    sizeField("store_size", t("modal.info.field.store_size"), runtime.storeBytes),
    sizeField("files_size", t("modal.info.field.files_size"), runtime.filesBytes),
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
    settings === "reading"
      ? loadingField("password_changed_at", t("modal.info.field.password_changed_at"))
      : {
          id: "password_changed_at",
          label: t("modal.info.field.password_changed_at"),
          value: config?.security.password_changed_at
            ? formatIsoDate(config.security.password_changed_at, locale)
            : "—",
        },
    {
      id: "key_count",
      label: t("modal.info.field.key_count"),
      value: countOrDash(vault.keyCount && vault.keyCount > 0 ? vault.keyCount : null),
    },
    {
      id: "password_change",
      label: t("modal.info.field.password_change"),
      value: t(PASSWORD_CHANGE_KEYS[vault.passwordChange ?? "none"]),
    },
    // Only an open session knows which files wait and where the key copies stand.
    ...(keyStatus === "reading"
      ? [loadingField("files_waiting", t("modal.info.field.files_waiting"))]
      : keyStatus
        ? [
            {
              id: "files_waiting",
              label: t("modal.info.field.files_waiting"),
              value: String(keyStatus.filesWaiting),
            },
            {
              id: "key_copies",
              label: t("modal.info.field.key_copies"),
              value: keyCopiesValue(keyStatus, t),
            },
          ]
        : []),
  ];

  const unlockedPath = unlockedFolder?.path ?? "";
  const unlockedFields: InfoField[] = [
    unlockedFolder
      ? {
          id: "unlocked_folder_choice",
          label: t("modal.info.field.unlocked_folder_choice"),
          value: choiceNameLabel(unlockedFolder.choice, t),
        }
      : loadingField("unlocked_folder_choice", t("modal.info.field.unlocked_folder_choice")),
    unlockedFolder
      ? withOpenPath(
          {
            id: "unlocked_folder_path",
            label: t("modal.info.field.unlocked_folder_path"),
            value: emptyDash(unlockedPath),
          },
          unlockedPath,
        )
      : loadingField("unlocked_folder_path", t("modal.info.field.unlocked_folder_path")),
    ...(vault.storageMode === "encrypted_dir"
      ? [
          unlockedFolder
            ? {
                id: "unlocked_folder_mounted",
                label: t("modal.info.field.unlocked_folder_mounted"),
                value: yesNo(t, unlockedFolder.mounted),
              }
            : loadingField(
                "unlocked_folder_mounted",
                t("modal.info.field.unlocked_folder_mounted"),
              ),
          ...(settings === "reading"
            ? [
                loadingField(
                  "unlocked_folder_encrypted",
                  t("modal.info.field.unlocked_folder_encrypted"),
                ),
              ]
            : config
              ? [
                  {
                    id: "unlocked_folder_encrypted",
                    label: t("modal.info.field.unlocked_folder_encrypted"),
                    value: t(
                      `modal.info.value.encrypted_switch.${config.unlocked_folder.encrypted}`,
                    ),
                  },
                ]
              : []),
        ]
      : []),
  ];

  /** `config.toml`'s rows, each with its value once the file is read. */
  const configRows: { id: string; label: string; value: (read: VaultSettingsConfig) => string }[] =
    [
      ...(vault.storageMode === "upriv_plain"
        ? [
            {
              id: "plain_files",
              label: t("modal.info.field.plain_files"),
              value: (read: VaultSettingsConfig) =>
                t(`modal.info.value.plain_files.${read.storage.plain_files}`),
            },
          ]
        : []),
      {
        id: "backup_enabled",
        label: t("modal.info.field.backup_enabled"),
        value: (read) => yesNo(t, read.backup.enabled),
      },
      {
        id: "backup_when",
        label: t("modal.settings.field.backup.when"),
        value: (read) =>
          t(
            read.backup.skip_unchanged
              ? "modal.settings.option.backup.changed"
              : "modal.settings.option.backup.every_close",
          ),
      },
      {
        id: "backup_keep_current",
        label: t("modal.settings.field.backup.keep_current"),
        value: (read) => yesNo(t, read.backup.keep_current),
      },
      {
        id: "backup_keep_last",
        label: t("modal.settings.field.backup.keep_last"),
        value: (read) => String(read.backup.keep_last),
      },
      {
        id: "auto_close",
        label: t("modal.info.field.auto_close"),
        value: (read) =>
          read.auto_close.enabled
            ? t("modal.info.value.auto_close_on_warn", {
                minutes: String(read.auto_close.idle_minutes),
                seconds: String(idleWarnLeadSeconds(read.auto_close.idle_minutes)),
              })
            : t("modal.info.value.no"),
      },
      {
        id: "auto_close_when_busy",
        label: t("modal.info.field.auto_close_when_busy"),
        value: (read) =>
          t(`modal.settings.field.auto_close.when_busy.${read.auto_close.when_busy}`),
      },
      {
        id: "file_manager_confirm_delete",
        label: t("modal.settings.field.file_manager.confirm_delete"),
        value: (read) => yesNo(t, read.file_manager.confirm_delete),
      },
    ];
  const configFields: InfoField[] =
    settings === "reading"
      ? configRows.map((row) => loadingField(row.id, row.label))
      : config
        ? configRows.map((row) => ({ id: row.id, label: row.label, value: row.value(config) }))
        : [{ id: "config_unavailable", label: t("modal.info.field.config"), value: "—" }];

  const backups = backupSections?.flatMap((section) => section.entries) ?? null;
  const inUse = backupSections?.find((section) => section.kind === "in_use");
  /** A backups row: loading while the list is read. */
  const listed = (id: string, label: string, value: (read: VaultBackupEntry[]) => string) =>
    backups ? { id, label, value: value(backups) } : loadingField(id, label);
  const backupFields: InfoField[] = [
    backupSections
      ? {
          id: "backup_folder_in_use",
          label: t("modal.info.field.backup_folder_in_use"),
          value: inUse ? sectionValue(inUse, osNames, t) : fixedChoiceLabel("data_folder", t),
          ...(inUse ? { openPath: inUse.path } : {}),
        }
      : loadingField("backup_folder_in_use", t("modal.info.field.backup_folder_in_use")),
    ...(backupSections ?? [])
      .filter((section) => section.entries.length > 0)
      .map((section) =>
        withOpenPath(
          {
            id: `backup_folder_${section.folder}`,
            label: t("modal.info.field.backup_folder_holding", {
              count: section.entries.length,
            }),
            value: sectionValue(section, osNames, t),
          },
          section.path,
        ),
      ),
    listed("backup_count", t("modal.info.field.backup_count"), (read) => String(read.length)),
    listed("backup_latest", t("modal.info.field.backup_latest"), latestBackupName),
    listed("backup_total_size", t("modal.info.field.backup_total_size"), (read) =>
      formatBytes(backupTotalBytes(read)),
    ),
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
