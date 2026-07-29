import type { StorageMode } from "../../vault";
import type { VaultSettingsConfig } from "..";

/** Minimal valid `VaultSettingsConfig` for domain tests. */
export function vaultSettingsFixture(
  overrides: {
    storageMode?: StorageMode;
    closeAction?: VaultSettingsConfig["close"]["default_action"];
    securityMode?: VaultSettingsConfig["security"]["mode"];
    sevenZip?: Partial<VaultSettingsConfig["seven_zip"]>;
    vault?: Partial<VaultSettingsConfig["vault"]>;
  } = {},
): VaultSettingsConfig {
  const storageMode = overrides.storageMode ?? "encrypted_dir";
  return {
    vault: {
      id: "demo",
      display_name: "Demo",
      order: 1,
      vault_file: "archive/Demo.7z",
      store_dir: "store",
      backups_dir: "backups",
      password_hint: "",
      note: "",
      hidden: false,
      ...overrides.vault,
    },
    storage: { mode: storageMode },
    close: { default_action: overrides.closeAction ?? "close" },
    backup: { enabled: true, mode: "keep_last", keep_last: 1 },
    security: {
      mode: overrides.securityMode ?? "session_ram",
      secure_wipe_workspace: true,
      wipe_passes: 1,
      wipe_pattern: "random",
    },
    auto_close: {
      enabled: false,
      idle_minutes: 15,
      warn_before_seconds: 60,
      close_on_app_exit: false,
    },
    seven_zip: {
      encrypt_file_names: true,
      archive_mode: "encrypt_only",
      compression_level: 0,
      solid: false,
      method: "lzma2",
      ...overrides.sevenZip,
    },
    policy: {
      allow_external_editors: false,
      disallow_copy_outside_mount: true,
      require_unmount_on_sleep: true,
    },
  };
}
