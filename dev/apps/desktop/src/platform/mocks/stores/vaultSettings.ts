import type { VaultSettingsConfig } from "@upriv/shared";

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
  "finance-2025": {
    vault: {
      display_name: "Finance 2025",
      order: 7,
      password_hint: "Q4 spreadsheet",
      note: "",
      hidden: true,
      id: "finance-2025",
    },
    backup: { enabled: true, mode: "keep_last", keep_last: 5 },
  },
  "travel-planner": {
    vault: {
      display_name: "Travel Planner",
      order: 10,
      id: "travel-planner",
    },
    auto_close: { enabled: true, idle_minutes: 3, warn_before_seconds: 30 },
  },
  "plain-folder-demo": {
    vault: {
      display_name: "Plain Folder Demo",
      order: 12,
      note: "Plaintext workspace while open; wipe on close.",
      id: "plain-folder-demo",
    },
    storage: { mode: "upriv_plain" },
  },
  "encrypted-dir-demo": {
    vault: {
      display_name: "Encrypted Dir Demo",
      order: 13,
      note: "Encrypted contents/ at rest; decrypt in RAM while open.",
      id: "encrypted-dir-demo",
    },
    storage: { mode: "encrypted_dir" },
  },
  "upriv-plain-demo": {
    vault: {
      display_name: "Upriv Plain Demo",
      order: 17,
      note: "Ciphertext in contents/ when closed; plaintext workspace/ while open.",
      id: "upriv-plain-demo",
    },
    storage: { mode: "upriv_plain" },
  },
  "old-archive": {
    vault: {
      display_name: "Old Archive",
      order: 6,
      password_hint: "",
      note: "",
      hidden: true,
      id: "old-archive",
    },
  },
};

const RUNTIME_VAULT_SETTINGS = new Map<string, VaultSettingsConfig>();

export function registerMockVaultSettings(config: VaultSettingsConfig): void {
  RUNTIME_VAULT_SETTINGS.set(config.vault.id, structuredClone(config));
}

export function unregisterMockVaultSettings(vaultId: string): void {
  RUNTIME_VAULT_SETTINGS.delete(vaultId);
}

export function getMockVaultSettings(vaultId: string): VaultSettingsConfig {
  const runtime = RUNTIME_VAULT_SETTINGS.get(vaultId);
  if (runtime) return structuredClone(runtime);

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
