import type { StorageMode } from "../../vault";
import { vaultWorkspace } from "../../workspace";
import type { VaultSettingsConfig } from "..";

/** Minimal valid `VaultSettingsConfig` for domain tests. */
export function vaultSettingsFixture(
  overrides: {
    storageMode?: StorageMode;
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
      password_hint: "",
      note: "",
      hidden: false,
      ...overrides.vault,
    },
    storage: { mode: storageMode, plain_files: "chosen" },
    mount: vaultWorkspace(),
    backup: { enabled: true, mode: "keep_last", keep_last: 1, skip_unchanged: true },
    security: {
      wipe_passes: 1,
      wipe_pattern: "random",
    },
    auto_close: {
      enabled: false,
      idle_minutes: 15,
    },
    file_manager: { confirm_delete: true },
    seven_zip: {
      encrypt_file_names: true,
      archive_mode: "encrypt_only",
      compression_level: 0,
      solid: false,
      ...overrides.sevenZip,
    },
  };
}
