import type { VaultSettingsConfig } from "@upriv/shared";

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function vaultSettingsToRawConfig(config: VaultSettingsConfig): RawVaultConfig {
  return {
    vault: {
      id: config.vault.id,
      display_name: config.vault.display_name,
      order: config.vault.order,
      vault_file: config.vault.vault_file,
      store_dir: config.vault.store_dir,
      backups_dir: config.vault.backups_dir,
      password_hint: optionalString(config.vault.password_hint),
      note: optionalString(config.vault.note),
      hidden: config.vault.hidden,
    },
    storage: { mode: config.storage.mode },
    close: { default_action: config.close.default_action },
    backup: { ...config.backup },
    security: {
      mode: config.security.mode,
      secure_wipe_workspace: config.security.secure_wipe_workspace,
      wipe_passes: config.security.wipe_passes,
      wipe_pattern: config.security.wipe_pattern,
      password_changed_at: config.security.password_changed_at,
    },
    auto_close: { ...config.auto_close },
    seven_zip: { ...config.seven_zip },
    policy: { ...config.policy },
  };
}

export function mergeVaultSettings(
  existing: RawVaultConfig,
  config: VaultSettingsConfig,
): RawVaultConfig {
  return {
    ...existing,
    vault: {
      ...existing.vault,
      id: config.vault.id,
      display_name: config.vault.display_name,
      order: config.vault.order,
      vault_file: config.vault.vault_file,
      store_dir: config.vault.store_dir,
      backups_dir: config.vault.backups_dir,
      password_hint: optionalString(config.vault.password_hint),
      note: optionalString(config.vault.note),
      hidden: config.vault.hidden,
    },
    storage: { mode: config.storage.mode },
    close: { default_action: config.close.default_action },
    backup: {
      enabled: config.backup.enabled,
      mode: config.backup.mode,
      keep_last: config.backup.keep_last,
    },
    security: {
      ...existing.security,
      mode: config.security.mode,
      secure_wipe_workspace: config.security.secure_wipe_workspace,
      wipe_passes: config.security.wipe_passes,
      wipe_pattern: config.security.wipe_pattern,
      password_changed_at: config.security.password_changed_at,
    },
    auto_close: {
      enabled: config.auto_close.enabled,
      idle_minutes: config.auto_close.idle_minutes,
      warn_before_seconds: config.auto_close.warn_before_seconds,
      close_on_app_exit: config.auto_close.close_on_app_exit,
    },
    seven_zip: {
      encrypt_file_names: config.seven_zip.encrypt_file_names,
      archive_mode: config.seven_zip.archive_mode,
      compression_level: config.seven_zip.compression_level,
      solid: config.seven_zip.solid,
      method: config.seven_zip.method,
    },
    policy: {
      allow_external_editors: config.policy.allow_external_editors,
      disallow_copy_outside_mount: config.policy.disallow_copy_outside_mount,
      require_unmount_on_sleep: config.policy.require_unmount_on_sleep,
    },
  };
}

export interface RawVaultConfig {
  vault: {
    id: string;
    display_name: string;
    order?: number;
    vault_file: string;
    store_dir?: string;
    backups_dir?: string;
    password_hint?: string;
    note?: string;
    hidden?: boolean;
  };
  storage: { mode: "encrypted_dir" | "plain" };
  close?: { default_action?: "close" | "seal" };
  backup?: { enabled?: boolean; mode?: "keep_last" | "keep_all"; keep_last?: number };
  security?: {
    mode?: string;
    secure_wipe_workspace?: boolean;
    wipe_passes?: number;
    wipe_pattern?: "random" | "zeros";
    password_changed_at?: string;
  };
  auto_close?: {
    enabled?: boolean;
    idle_minutes?: number;
    warn_before_seconds?: number;
    close_on_app_exit?: boolean;
  };
  seven_zip?: {
    encrypt_file_names?: boolean;
    archive_mode?: "compress_encrypt" | "encrypt_only";
    compression_level?: number;
    solid?: boolean;
    method?: string;
  };
  policy?: {
    allow_external_editors?: boolean;
    disallow_copy_outside_mount?: boolean;
    require_unmount_on_sleep?: boolean;
  };
}

export function mapRawVaultConfig(raw: RawVaultConfig): VaultSettingsConfig {
  return {
    vault: {
      id: raw.vault.id,
      display_name: raw.vault.display_name,
      order: raw.vault.order ?? 0,
      vault_file: raw.vault.vault_file,
      store_dir: raw.vault.store_dir ?? "store",
      backups_dir: raw.vault.backups_dir ?? "backups",
      password_hint: raw.vault.password_hint ?? "",
      note: raw.vault.note ?? "",
      hidden: raw.vault.hidden ?? false,
    },
    storage: { mode: raw.storage.mode },
    close: { default_action: raw.close?.default_action ?? "close" },
    backup: {
      enabled: raw.backup?.enabled ?? false,
      mode: raw.backup?.mode ?? "keep_last",
      keep_last: raw.backup?.keep_last ?? 1,
    },
    security: {
      mode: (raw.security?.mode ?? "session_ram") as VaultSettingsConfig["security"]["mode"],
      secure_wipe_workspace: raw.security?.secure_wipe_workspace ?? true,
      wipe_passes: raw.security?.wipe_passes ?? 1,
      wipe_pattern: raw.security?.wipe_pattern ?? "random",
      password_changed_at: raw.security?.password_changed_at,
    },
    auto_close: {
      enabled: raw.auto_close?.enabled ?? false,
      idle_minutes: raw.auto_close?.idle_minutes ?? 30,
      warn_before_seconds: raw.auto_close?.warn_before_seconds ?? 120,
      close_on_app_exit: raw.auto_close?.close_on_app_exit ?? false,
    },
    seven_zip: {
      encrypt_file_names: raw.seven_zip?.encrypt_file_names ?? true,
      archive_mode: raw.seven_zip?.archive_mode ?? "encrypt_only",
      compression_level: raw.seven_zip?.compression_level ?? 5,
      solid: raw.seven_zip?.solid ?? false,
      method: (raw.seven_zip?.method ?? "lzma2") as "lzma2",
    },
    policy: {
      allow_external_editors: raw.policy?.allow_external_editors ?? true,
      disallow_copy_outside_mount: raw.policy?.disallow_copy_outside_mount ?? false,
      require_unmount_on_sleep: raw.policy?.require_unmount_on_sleep ?? false,
    },
  };
}
