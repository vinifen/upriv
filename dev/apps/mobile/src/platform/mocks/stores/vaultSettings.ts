import type { VaultSettingsConfig } from "@upriv/shared";
import { cloneJson } from "../cloneJson";

const DEFAULTS: VaultSettingsConfig = {
  vault: {
    id: "",
    display_name: "",
    order: 0,
    password_hint: "",
    note: "",
    hidden: false,
  },
  storage: { mode: "encrypted_dir" },
  mount: { workspace_path: "default" },
  backup: { enabled: true, mode: "keep_last", keep_last: 1 },
  security: {
    mode: "session_ram",
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
  },
  policy: {
    allow_external_editors: false,
    disallow_copy_outside_mount: true,
    require_unmount_on_sleep: true,
  },
};

type VaultSettingsOverrides = {
  [K in keyof VaultSettingsConfig]?: Partial<VaultSettingsConfig[K]>;
};

const MOCK_BY_VAULT: Record<string, VaultSettingsOverrides> = {
  "my-encrypted-notes": {
    vault: {
      display_name: "My Encrypted Notes",
      order: 1,
      password_hint: "hint: childhood street",
      note: "Daily scratch pad — sync after laptop backup.",
      id: "my-encrypted-notes",
    },
    backup: { enabled: true, mode: "keep_last", keep_last: 1 },
    seven_zip: { archive_mode: "encrypt_only" },
    auto_close: { enabled: false },
  },
  "vault-example-2": {
    vault: {
      display_name: "Vault ExaMple 2",
      order: 2,
      password_hint: "Example passphrase reminder",
      note: "Mock demo: unlock with gatefail, then lock to see the header test error.",
      id: "vault-example-2",
    },
    backup: { enabled: true, mode: "keep_all" },
    auto_close: { enabled: true, idle_minutes: 15 },
    seven_zip: { archive_mode: "compress_encrypt", compression_level: 5 },
  },
  "cold-storage": {
    vault: {
      display_name: "Cold Storage",
      order: 3,
      password_hint: "Winter project archive",
      note: "Mock demo: open fails — insufficient RAM.",
      id: "cold-storage",
    },
  },
  "personal-photos": {
    vault: {
      display_name: "Personal Photos",
      order: 4,
      note: "RAW exports only; JPEG previews live elsewhere.",
      id: "personal-photos",
    },
  },
  "work-documents": {
    vault: {
      display_name: "Work Documents",
      order: 5,
      id: "work-documents",
    },
  },
};

const RUNTIME_VAULT_SETTINGS = new Map<string, VaultSettingsConfig>();

export function registerMockVaultSettings(config: VaultSettingsConfig): void {
  RUNTIME_VAULT_SETTINGS.set(config.vault.id, cloneJson(config));
}

export function unregisterMockVaultSettings(vaultId: string): void {
  RUNTIME_VAULT_SETTINGS.delete(vaultId);
}

export function getMockVaultSettings(vaultId: string): VaultSettingsConfig {
  const runtime = RUNTIME_VAULT_SETTINGS.get(vaultId);
  if (runtime) return cloneJson(runtime);

  const custom = MOCK_BY_VAULT[vaultId] as VaultSettingsOverrides | undefined;
  const displayName = custom?.vault?.display_name ?? vaultId;

  return {
    vault: {
      ...DEFAULTS.vault,
      id: vaultId,
      display_name: displayName,
      ...custom?.vault,
    },
    storage: { ...DEFAULTS.storage, ...custom?.storage },
    mount: { ...DEFAULTS.mount, ...custom?.mount },
    backup: { ...DEFAULTS.backup, ...custom?.backup },
    security: { ...DEFAULTS.security, ...custom?.security },
    auto_close: { ...DEFAULTS.auto_close, ...custom?.auto_close },
    seven_zip: { ...DEFAULTS.seven_zip, ...custom?.seven_zip },
    policy: { ...DEFAULTS.policy, ...custom?.policy },
  };
}
