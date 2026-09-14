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

    /// Config save refused: quiet-gated field while session open / mid-close.
    #[error("vault config busy: close vault before changing {target}")]
    VaultConfigBusy { target: String },

    /// `.upriv/vault_groups.toml` missing schema / unreadable (groups layer only — not Gate).
    #[error("vault groups invalid at {path}: {detail}")]
    VaultGroupsInvalid { path: PathBuf, detail: String },

    /// Named group is gone (groups layer — not a corrupt file).
    #[error("vault group not found: {0}")]
    VaultGroupNotFound(String),

    /// Registry folder already exists (`vaults/<id>/`).
    #[error("vault already exists: {0}")]
    VaultAlreadyExists(PathBuf),

    /// Unlock / wrap AEAD failed — treat as wrong password (do not distinguish tamper).
    #[error("wrong password")]
    WrongPassword,

    /// Vault session is already open in this process.
    #[error("vault already open: {0}")]
    VaultAlreadyOpen(String),

    /// Close / session op but the vault is not open in this process.
    #[error("vault not open: {0}")]
    VaultNotOpen(String),

    /// Surface unlock throttle (5 failures / 60 s → 60 s block).
    #[error("vault unlock blocked for {retry_after_secs}s")]
    VaultUnlockBlocked { retry_after_secs: u64 },

    /// Argon2id could not allocate the header `m` cost.
    #[error("insufficient RAM to derive vault key")]
    InsufficientRam,

    /// `contents/` header/index unreadable, unknown version, or AEAD fail after a good wrap.
    #[error("vault store invalid at {path}: {detail}")]
    VaultStoreInvalid { path: PathBuf, detail: String },

    /// `upriv_plain` workspace extract/wipe is not implemented — refuse create/open.
    #[error("upriv_plain is not implemented")]
    UprivPlainUnavailable,

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
