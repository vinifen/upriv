//! Domain errors for `upriv-core`. Keep messages English (logs / RPC wire).
//! UI maps wire `code` strings to i18n — see `@upriv/shared` vault errors.

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum UprivError {
    /// Path is not a vault-root (missing `.upriv/settings.toml`).
    #[error("vault root not found: missing {0}")]
    VaultRootNotFound(PathBuf),

    /// `.upriv` exists but required files/content are missing or invalid.
    #[error("vault root incomplete at {path}: {detail}")]
    VaultRootIncomplete { path: PathBuf, detail: String },

    /// `.upriv-root` alias exists but does not point at a valid vault-root.
    #[error("vault root alias invalid: {0}")]
    VaultRootAliasInvalid(PathBuf),

    /// No vault directory / id under the vault-root (vault layer — not Gate).
    /// Mid-session: toast + invalidate that vault session; do not reopen VaultRootGate.
    #[error("vault not found: {0}")]
    VaultNotFound(PathBuf),

    /// `vaults/<id>/config.toml` missing or invalid.
    #[error("vault config invalid at {path}: {detail}")]
    VaultConfigInvalid { path: PathBuf, detail: String },

    /// `.upriv/vault_groups.toml` missing schema / unreadable (groups layer only — not Gate).
    #[error("vault groups invalid at {path}: {detail}")]
    VaultGroupsInvalid { path: PathBuf, detail: String },

    /// Named group is gone (groups layer — not a corrupt file).
    #[error("vault group not found: {0}")]
    VaultGroupNotFound(String),

    /// Workspace / mount path is not absolute or otherwise invalid.
    #[error("workspace path invalid at {path}: {detail}")]
    WorkspacePathInvalid { path: PathBuf, detail: String },

    /// Workspace / mount path sits under a reserved `.upriv/` system directory.
    #[error("workspace path reserved: {0}")]
    WorkspacePathReserved(PathBuf),

    /// App `[workspace].path` is unset while a vault needs the default mount parent.
    #[error("workspace path unset")]
    WorkspaceUnset,

    /// Configured workspace path is missing or not usable at open time.
    #[error("workspace unavailable: {0}")]
    WorkspaceUnavailable(PathBuf),

    /// `log_get` refused to load a very large file body into memory.
    #[error("log_file_too_large: {size} bytes (max {max}) at {path}")]
    LogFileTooLarge { path: PathBuf, size: u64, max: u64 },

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, UprivError>;
