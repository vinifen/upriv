import type { I18nKey } from "../../i18n/catalog";
import type { VaultBackupEntry } from "../backups";
import { formatBytes } from "../format/bytes";
import { formatIsoDate } from "../format/datetime";
import { vaultLastAccessedLabel } from "../vault-list/lastAccessed";
import type { InfoSection, InfoTranslate } from "../info";
import { securityModeToUi } from "../vault-settings/types";
import { KDF_UNLOCK_OPTION_META } from "../vault-settings/kdf";
import { resolveVaultListStatus, vaultStatusI18nKey, type VaultPipelineListStatus } from "../vault";
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

const SECURITY_UI_KEYS = {
  session_ram: "modal.settings.option.security.session_ram",
  prompt_open_close: "modal.settings.option.security.prompt_open_close",
  disk_close: "modal.settings.option.security.disk_close",
  disk_open_close: "modal.settings.option.security.disk_open_close",
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
  return backups.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0);
}

function latestBackupStamp(backups: VaultBackupEntry[]): string {
  if (backups.length === 0) return "—";
  const sorted = [...backups].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return sorted[0]?.stamp ?? "—";
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
    backups,
    runtime,
    passwordInSession,
    workspacePath,
    workspacePathIsActive,
    storePath,
    backupsPath,
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
    {
      id: "password_hint_storage",
      label: t("modal.info.field.password_hint_storage"),
      value: t("modal.info.value.password_hint_plaintext"),
    },
  ];

  const statusFields = [
    {
      id: "display_status",
      label: t("modal.info.field.display_status"),
      value: t(vaultStatusI18nKey[displayStatus] as I18nKey),
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
    { id: "store_path", label: t("modal.info.field.store_path"), value: storePath },
    { id: "backups_path", label: t("modal.info.field.backups_path"), value: backupsPath },
    {
      id: "workspace_path",
      label: t(
        workspacePathIsActive
          ? "modal.info.field.workspace_path"
          : "modal.info.field.workspace_path_expected",
      ),
      value: emptyDash(workspacePath),
    },
    {
      id: "store_size",
      label: t("modal.info.field.store_size"),
      value: formatBytes(runtime.storeBytes ?? undefined),
    },
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

  const configFields = settings
    ? [
        {
          id: "mount_workspace_path",
          label: t("modal.info.field.mount_workspace_path"),
          value: emptyDash(settings.mount.workspace_path),
        },
        {
          id: "backup_enabled",
          label: t("modal.info.field.backup_enabled"),
          value: yesNo(t, settings.backup.enabled),
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
            ? t("modal.info.value.auto_close_on", {
                minutes: String(settings.auto_close.idle_minutes),
              })
            : t("modal.info.value.no"),
        },
        {
          id: "security_mode",
          label: t("modal.info.field.security_mode"),
          value: t(SECURITY_UI_KEYS[securityModeToUi(settings.security.mode)]),
        },
        {
          id: "policy_external_apps",
          label: t("modal.settings.field.policy.external_editors"),
          value: t(
            settings.policy.allow_external_editors
              ? "modal.settings.option.policy.external_editors_yes"
              : "modal.settings.option.policy.external_editors_no",
          ),
        },
        {
          id: "policy_copy_out",
          label: t("modal.settings.field.policy.copy_outside"),
          value: t(
            settings.policy.disallow_copy_outside_mount
              ? "modal.settings.option.policy.copy_block"
              : "modal.settings.option.policy.copy_allow",
          ),
        },
        {
          id: "require_unmount_on_sleep",
          label: t("modal.settings.field.close.require_unmount_on_sleep"),
          value: yesNo(t, settings.policy.require_unmount_on_sleep),
        },
        {
          id: "secure_wipe",
          label: t("modal.settings.field.close.secure_wipe"),
          value: yesNo(t, settings.security.secure_wipe_workspace),
        },
      ]
    : [{ id: "config_unavailable", label: t("modal.info.field.config"), value: "—" }];

  const backupFields = [
    {
      id: "backup_count",
      label: t("modal.info.field.backup_count"),
      value: String(backups.length),
    },
    {
      id: "backup_latest",
      label: t("modal.info.field.backup_latest"),
      value: latestBackupStamp(backups),
    },
    {
      id: "backup_total_size",
      label: t("modal.info.field.backup_total_size"),
      value: formatBytes(backupTotalBytes(backups)),
    },
  ];

  return [
    { id: "identity", title: t("modal.info.section.identity"), fields: identityFields },
    { id: "status", title: t("modal.info.section.status"), fields: statusFields },
    { id: "runtime", title: t("modal.info.section.runtime"), fields: runtimeFields },
    { id: "storage", title: t("modal.info.section.storage"), fields: storageFields },
    { id: "crypto", title: t("modal.info.section.crypto"), fields: cryptoFields },
    { id: "config", title: t("modal.info.section.config"), fields: configFields },
    { id: "backups", title: t("modal.info.section.backups"), fields: backupFields },
  ];
}
