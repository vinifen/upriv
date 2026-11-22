//! Per-vault `vaults/<id>/config.toml` types (aligned with TS `VaultSettingsConfig`).

use serde::{Deserialize, Serialize};

use crate::folder_list::backup::VaultBackupChoice;
use crate::folder_list::unlocked::VaultUnlockedFolder;
use crate::folder_list::DeviceGroups;
use crate::store::{VaultStorage, VaultStorageMode};

/// `[backup] mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultBackupMode {
    #[default]
    KeepLast,
    KeepAll,
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

/// `[vault]` identity section (required for a listable vault).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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

/// `[backup]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultBackupSection {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub mode: VaultBackupMode,
    #[serde(default = "default_keep_last")]
    pub keep_last: u32,
    /// Close skips a new zip when vault files match the last backup still on
    /// disk. `.upriv-workspace.json` is not a change. `false` writes a zip on
    /// every close.
    #[serde(default = "default_true")]
    pub skip_unchanged: bool,
    /// The vault's backup folder list, per device.
    #[serde(default, skip_serializing_if = "DeviceGroups::is_empty")]
    pub devices: DeviceGroups<VaultBackupChoice>,
}

impl Default for VaultBackupSection {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: VaultBackupMode::KeepLast,
            keep_last: 1,
            skip_unchanged: true,
            devices: DeviceGroups::default(),
        }
    }
}

/// `[security]`. Wipe settings for a plain-text vault's folder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultSecuritySection {
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
            wipe_passes: 1,
            wipe_pattern: VaultWipePattern::Random,
            password_changed_at: None,
        }
    }
}

/// Settings control and the idle clock share this range.
pub const IDLE_MINUTES_MIN: u32 = 1;
pub const IDLE_MINUTES_MAX: u32 = 1440;

pub(crate) fn clamp_idle_minutes(minutes: u32) -> u32 {
    minutes.clamp(IDLE_MINUTES_MIN, IDLE_MINUTES_MAX)
}

/// `[auto_close]`. Minutes without activity inside Upriv before this vault closes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultAutoCloseSection {
    #[serde(default)]
    pub enabled: bool,
    /// Load and save clamp this to [`IDLE_MINUTES_MIN`]..=[`IDLE_MINUTES_MAX`].
    #[serde(default = "default_idle_minutes")]
    pub idle_minutes: u32,
    #[serde(default)]
    pub when_busy: AutoCloseWhenBusy,
}

/// What auto-close does when its time is up while work keeps the vault open
/// (a file importing into the file manager).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoCloseWhenBusy {
    /// Close as soon as nothing keeps the vault open. New work may still start.
    #[default]
    Wait,
    /// Stop that work and close on time.
    Close,
}

impl Default for VaultAutoCloseSection {
    fn default() -> Self {
        Self {
            enabled: false,
            idle_minutes: 15,
            when_busy: AutoCloseWhenBusy::Wait,
        }
    }
}

/// `[file_manager]`. In-app file manager choices for this vault.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultFileManagerSection {
    /// Ask before deleting a file or folder. Default true.
    #[serde(default = "default_true")]
    pub confirm_delete: bool,
}

impl Default for VaultFileManagerSection {
    fn default() -> Self {
        Self {
            confirm_delete: true,
        }
    }
}

/// `[seven_zip]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultSevenZipSection {
    #[serde(default = "default_true")]
    pub encrypt_file_names: bool,
    #[serde(default)]
    pub archive_mode: VaultArchiveMode,
    #[serde(default)]
    pub compression_level: u8,
    #[serde(default)]
    pub solid: bool,
}

impl Default for VaultSevenZipSection {
    fn default() -> Self {
        Self {
            encrypt_file_names: true,
            archive_mode: VaultArchiveMode::EncryptOnly,
            compression_level: 0,
            solid: false,
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

/// Full vault `config.toml` model — must stay aligned with TS `VaultSettingsConfig`
/// **before** settings write becomes a real RPC, or a full-file save drops sections.
/// `[kdf]` stays out: unlock cost lives in `vault.header`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultConfig {
    pub vault: VaultIdentitySection,
    /// The copy of the sealed storage value ([`VaultStorage`]): it shows the
    /// mode before the password and decides nothing alone. Only the create,
    /// an import, the Storage change, a reset at open, and the rebuild write
    /// it; a missing or unknown `[storage]` reads as the default.
    #[serde(default)]
    pub storage: VaultStorage,
    #[serde(default)]
    pub unlocked_folder: VaultUnlockedFolder,
    #[serde(default)]
    pub backup: VaultBackupSection,
    #[serde(default)]
    pub security: VaultSecuritySection,
    #[serde(default)]
    pub auto_close: VaultAutoCloseSection,
    #[serde(default)]
    pub file_manager: VaultFileManagerSection,
    #[serde(default)]
    pub seven_zip: VaultSevenZipSection,
    /// Present while the vault is being deleted, or a delete of it did not
    /// finish. Only the delete writes it, and it leaves with `config.toml`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleting: Option<VaultDeletingSection>,
}

/// `[deleting]`: a delete of this vault started (`vault_delete`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultDeletingSection {
    /// The backups outside the data folder go too.
    pub outside_backups: bool,
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
