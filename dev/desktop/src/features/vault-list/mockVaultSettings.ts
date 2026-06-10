import type { VaultSettingsConfig } from "./vaultSettingsTypes";

function vaultPaths(id: string, displayName: string): Pick<
  VaultSettingsConfig["vault"],
  "id" | "vault_file" | "store_dir" | "backups_dir"
> {
  return {
    id,
    vault_file: `archive/${displayName}.7z`,
    store_dir: "store",
    backups_dir: "backups",
  };
}

const DEFAULTS: VaultSettingsConfig = {
  vault: {
    id: "",
    display_name: "",
    order: 0,
    vault_file: "",
    store_dir: "store",
    backups_dir: "backups",
    password_hint: "",
    note: "",
    hidden: false,
  },
  storage: { mode: "encrypted_dir" },
  close: { default_action: "close" },
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
    compression_level: 5,
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
      order: 4,
      password_hint: "hint: childhood street",
      note: "Personal notes and drafts.",
      ...vaultPaths("my-encrypted-notes", "My Encrypted Notes"),
    },
    backup: { enabled: true, mode: "keep_last", keep_last: 1 },
    seven_zip: { archive_mode: "encrypt_only" },
    auto_close: { enabled: false },
  },
  "vault-example-2": {
    vault: {
      display_name: "Vault ExaMple 2",
      order: 1,
      password_hint: "Example passphrase reminder",
      note: "Mock demo: unlock with gatefail, then lock to see archive test error.",
      ...vaultPaths("vault-example-2", "Vault ExaMple 2"),
    },
    backup: { enabled: true, mode: "keep_all" },
    auto_close: { enabled: true, idle_minutes: 15 },
    seven_zip: { archive_mode: "compress_encrypt" },
  },
  "cold-storage": {
    vault: {
      display_name: "Cold Storage",
      order: 3,
      password_hint: "Winter project archive",
      note: "Mock demo: open fails — insufficient RAM.",
      ...vaultPaths("cold-storage", "Cold Storage"),
    },
  },
  "finance-2025": {
    vault: {
      display_name: "Finance 2025",
      order: 5,
      password_hint: "Q4 spreadsheet",
      note: "",
      hidden: true,
      ...vaultPaths("finance-2025", "Finance 2025"),
    },
    backup: { enabled: true, mode: "keep_last", keep_last: 5 },
  },
  "travel-planner": {
    vault: {
      display_name: "Travel Planner",
      order: 10,
      ...vaultPaths("travel-planner", "Travel Planner"),
    },
    auto_close: { enabled: true, idle_minutes: 3, warn_before_seconds: 30 },
  },
  "plain-folder-demo": {
    vault: {
      display_name: "Plain Folder Demo",
      order: 12,
      note: "Plain storage demo vault.",
      ...vaultPaths("plain-folder-demo", "Plain Folder Demo"),
    },
    storage: { mode: "plain" },
    close: { default_action: "seal" },
  },
  "old-archive": {
    vault: {
      display_name: "Old Archive",
      order: 6,
      password_hint: "",
      note: "",
      hidden: true,
      ...vaultPaths("old-archive", "Old Archive"),
    },
  },
};

const RUNTIME_VAULT_SETTINGS = new Map<string, VaultSettingsConfig>();

export function registerMockVaultSettings(config: VaultSettingsConfig): void {
  RUNTIME_VAULT_SETTINGS.set(config.vault.id, structuredClone(config));
}

export function getMockVaultSettings(vaultId: string): VaultSettingsConfig {
  const runtime = RUNTIME_VAULT_SETTINGS.get(vaultId);
  if (runtime) return structuredClone(runtime);

  const custom = MOCK_BY_VAULT[vaultId] as VaultSettingsOverrides | undefined;
  const displayName = custom?.vault?.display_name ?? vaultId;

  return {
    vault: {
      ...DEFAULTS.vault,
      ...vaultPaths(vaultId, displayName),
      display_name: displayName,
      ...custom?.vault,
    },
    storage: { ...DEFAULTS.storage, ...custom?.storage },
    close: { ...DEFAULTS.close, ...custom?.close },
    backup: { ...DEFAULTS.backup, ...custom?.backup },
    security: { ...DEFAULTS.security, ...custom?.security },
    auto_close: { ...DEFAULTS.auto_close, ...custom?.auto_close },
    seven_zip: { ...DEFAULTS.seven_zip, ...custom?.seven_zip },
    policy: { ...DEFAULTS.policy, ...custom?.policy },
  };
}

export function vaultSettingsToListPatch(config: VaultSettingsConfig) {
  const passwordHint = config.vault.password_hint.trim();
  return {
    displayName: config.vault.display_name,
    order: config.vault.order,
    note: config.vault.note,
    hidden: config.vault.hidden,
    passwordHint: passwordHint || undefined,
  };
}
