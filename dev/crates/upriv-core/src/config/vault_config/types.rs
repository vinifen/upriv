//! Per-vault `vaults/<id>/config.toml` types (aligned with TS `VaultSettingsConfig`).

use serde::{Deserialize, Serialize};

/// Storage mode from `[storage] mode` (TS `StorageMode`).
///
/// - `encrypted_dir` — default. Rest = `contents/`. While open: decrypt in RAM
///   (FUSE/WinFsp on desktop; in-app file manager on mobile).
/// - `upriv_plain` — rest = `contents/`. While open: plaintext under the open
///   mount folder on disk (wipe on close). Not app `[workspace].path`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultStorageMode {
    #[default]
    EncryptedDir,
    UprivPlain,
}

/// `[backup] mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultBackupMode {
    #[default]
    KeepLast,
    KeepAll,
}

/// `[security] mode`.
///
/// `ram_on_close_only` is a legacy TOML value from the `.7z`-on-close era.
/// Load/save maps it to [`Self::SessionRam`] — close uses session keys, not a
/// freshly typed password.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultSecurityMode {
    AlwaysPrompt,
    #[default]
    SessionRam,
    RamOnCloseOnly,
    DiskClose,
    DiskOpenClose,
}

impl VaultSecurityMode {
    /// Rewrite deprecated close-password modes to the current contract.
    pub fn normalized(self) -> Self {
        match self {
            Self::RamOnCloseOnly => Self::SessionRam,
            other => other,
        }
    }
}

/// `[security] wipe_pattern`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultWipePattern {
    #[default]
    Random,
    Zeros,
}

/// `[seven_zip] archive_mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultArchiveMode {
    CompressEncrypt,
    #[default]
    EncryptOnly,
}

/// `[seven_zip] method` (only lzma2 today).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultSevenZipMethod {
    #[default]
    Lzma2,
}

/// `[vault]` identity section (required for a listable vault).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultIdentitySection {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub password_hint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct VaultStorageSection {
    #[serde(default)]
    pub mode: VaultStorageMode,
}

/// `[mount]` — where this vault’s open session appears on disk / FUSE.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultMountSection {
    /// `"default"` inherits app `[workspace].path`; otherwise an absolute path.
    #[serde(default = "default_mount_workspace_path")]
    pub workspace_path: String,
}

fn default_mount_workspace_path() -> String {
    crate::paths::WORKSPACE_PATH_DEFAULT.to_string()
}

impl Default for VaultMountSection {
    fn default() -> Self {
        Self {
            workspace_path: default_mount_workspace_path(),
        }
    }
}

/// `[backup]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultBackupSection {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub mode: VaultBackupMode,
    #[serde(default = "default_keep_last")]
    pub keep_last: u32,
}

impl Default for VaultBackupSection {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: VaultBackupMode::KeepLast,
            keep_last: 1,
        }
    }
}

/// `[security]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultSecuritySection {
    #[serde(default)]
    pub mode: VaultSecurityMode,
    #[serde(default = "default_true")]
    pub secure_wipe_workspace: bool,
    #[serde(default = "default_wipe_passes")]
    pub wipe_passes: u32,
    #[serde(default)]
    pub wipe_pattern: VaultWipePattern,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_changed_at: Option<String>,
}

impl Default for VaultSecuritySection {
    fn default() -> Self {
        Self {
            mode: VaultSecurityMode::SessionRam,
            secure_wipe_workspace: true,
            wipe_passes: 1,
            wipe_pattern: VaultWipePattern::Random,
            password_changed_at: None,
        }
    }
}

/// `[auto_close]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultAutoCloseSection {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_idle_minutes")]
    pub idle_minutes: u32,
    #[serde(default = "default_warn_before_seconds")]
    pub warn_before_seconds: u32,
    #[serde(default)]
    pub close_on_app_exit: bool,
}

impl Default for VaultAutoCloseSection {
    fn default() -> Self {
        Self {
            enabled: false,
            idle_minutes: 15,
            warn_before_seconds: 60,
            close_on_app_exit: false,
        }
    }
}

/// `[seven_zip]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultSevenZipSection {
    #[serde(default = "default_true")]
    pub encrypt_file_names: bool,
    #[serde(default)]
    pub archive_mode: VaultArchiveMode,
    #[serde(default)]
    pub compression_level: u8,
    #[serde(default)]
    pub solid: bool,
    #[serde(default)]
    pub method: VaultSevenZipMethod,
}

impl Default for VaultSevenZipSection {
    fn default() -> Self {
        Self {
            encrypt_file_names: true,
            archive_mode: VaultArchiveMode::EncryptOnly,
            compression_level: 0,
            solid: false,
            method: VaultSevenZipMethod::Lzma2,
        }
    }
}

/// `[policy]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultPolicySection {
    #[serde(default)]
    pub allow_external_editors: bool,
    #[serde(default = "default_true")]
    pub disallow_copy_outside_mount: bool,
    #[serde(default = "default_true")]
    pub require_unmount_on_sleep: bool,
}

impl Default for VaultPolicySection {
    fn default() -> Self {
        Self {
            allow_external_editors: false,
            disallow_copy_outside_mount: true,
            require_unmount_on_sleep: true,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_keep_last() -> u32 {
    1
}

fn default_wipe_passes() -> u32 {
    1
}

fn default_idle_minutes() -> u32 {
    15
}

fn default_warn_before_seconds() -> u32 {
    60
}

/// Full vault `config.toml` model — must stay aligned with TS `VaultSettingsConfig`
/// **before** settings write becomes a real RPC, or a full-file save drops sections.
/// `[kdf]` stays out: unlock cost lives in `vault.header`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultConfig {
    pub vault: VaultIdentitySection,
    #[serde(default)]
    pub storage: VaultStorageSection,
    #[serde(default)]
    pub mount: VaultMountSection,
    #[serde(default)]
    pub backup: VaultBackupSection,
    #[serde(default)]
    pub security: VaultSecuritySection,
    #[serde(default)]
    pub auto_close: VaultAutoCloseSection,
    #[serde(default)]
    pub seven_zip: VaultSevenZipSection,
    #[serde(default)]
    pub policy: VaultPolicySection,
}

impl VaultConfig {
    pub fn id(&self) -> &str {
        &self.vault.id
    }

    pub fn display_name(&self) -> &str {
        &self.vault.display_name
    }

    pub fn storage_mode(&self) -> VaultStorageMode {
        self.storage.mode
    }
}
