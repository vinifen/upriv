use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub vault: VaultSection,
    #[serde(default)]
    pub storage: StorageSection,
    #[serde(default)]
    pub close: CloseSection,
    #[serde(default)]
    pub backup: BackupSection,
    #[serde(default)]
    pub security: SecuritySection,
    #[serde(default)]
    pub auto_close: AutoCloseSection,
    #[serde(default)]
    pub seven_zip: SevenZipSection,
    #[serde(default)]
    pub policy: PolicySection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultSection {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub order: Option<u32>,
    #[serde(default = "default_vault_file")]
    pub vault_file: String,
    #[serde(default = "default_store_dir")]
    pub store_dir: String,
    #[serde(default = "default_backups_dir")]
    pub backups_dir: String,
    #[serde(default)]
    pub auth_dir: Option<String>,
    #[serde(default)]
    pub session_file: Option<String>,
    #[serde(default)]
    pub quick_auth_file: Option<String>,
    #[serde(default)]
    pub password_hint: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub hidden: bool,
}

fn default_vault_file() -> String {
    "archive/vault.7z".to_string()
}

fn default_store_dir() -> String {
    "store".to_string()
}

fn default_backups_dir() -> String {
    "backups".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StorageSection {
    #[serde(default)]
    pub mode: StorageMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMode {
    #[default]
    #[serde(rename = "encrypted_dir")]
    EncryptedDir,
    Plain,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CloseSection {
    #[serde(default)]
    pub default_action: CloseAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseAction {
    #[default]
    Close,
    Seal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSection {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub mode: BackupMode,
    #[serde(default = "default_keep_last")]
    pub keep_last: u32,
}

fn default_keep_last() -> u32 {
    1
}

impl Default for BackupSection {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: BackupMode::KeepLast,
            keep_last: default_keep_last(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupMode {
    #[default]
    KeepLast,
    KeepAll,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecuritySection {
    #[serde(default)]
    pub mode: SecurityMode,
    #[serde(default = "default_true")]
    pub secure_wipe_workspace: bool,
    #[serde(default = "default_wipe_passes")]
    pub wipe_passes: u32,
    #[serde(default)]
    pub wipe_pattern: WipePattern,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_changed_at: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_wipe_passes() -> u32 {
    1
}

impl Default for SecuritySection {
    fn default() -> Self {
        Self {
            mode: SecurityMode::SessionRam,
            secure_wipe_workspace: default_true(),
            wipe_passes: default_wipe_passes(),
            wipe_pattern: WipePattern::Random,
            password_changed_at: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecurityMode {
    AlwaysPrompt,
    #[default]
    SessionRam,
    #[serde(rename = "ram_on_close_only")]
    RamOnCloseOnly,
    DiskClose,
    DiskOpenClose,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WipePattern {
    #[default]
    Random,
    Zeros,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AutoCloseSection {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_idle_minutes")]
    pub idle_minutes: u32,
    #[serde(default = "default_warn_before_seconds")]
    pub warn_before_seconds: u32,
    #[serde(default)]
    pub close_on_app_exit: bool,
}

fn default_idle_minutes() -> u32 {
    30
}

fn default_warn_before_seconds() -> u32 {
    120
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SevenZipSection {
    #[serde(default = "default_true")]
    pub encrypt_file_names: bool,
    #[serde(default)]
    pub archive_mode: ArchiveMode,
    #[serde(default = "default_compression_level")]
    pub compression_level: u8,
    #[serde(default)]
    pub solid: bool,
    #[serde(default = "default_method")]
    pub method: String,
}

fn default_compression_level() -> u8 {
    5
}

fn default_method() -> String {
    "lzma2".to_string()
}

impl Default for SevenZipSection {
    fn default() -> Self {
        Self {
            encrypt_file_names: default_true(),
            archive_mode: ArchiveMode::EncryptOnly,
            compression_level: default_compression_level(),
            solid: false,
            method: default_method(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveMode {
    CompressEncrypt,
    #[default]
    EncryptOnly,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicySection {
    #[serde(default = "default_true")]
    pub allow_external_editors: bool,
    #[serde(default)]
    pub disallow_copy_outside_mount: bool,
    #[serde(default)]
    pub require_unmount_on_sleep: bool,
}

/// Persisted closed/sealed metadata (`persistence.json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPersistence {
    pub format_version: u32,
    pub vault_id: String,
    pub display_name: String,
    pub sync_generation: u64,
    pub archive_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_close_ok_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_store_write_at: Option<String>,
    pub persistence: PersistenceState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersistenceState {
    Open,
    Closed,
    #[default]
    Sealed,
}
