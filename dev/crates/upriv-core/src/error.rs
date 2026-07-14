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

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, UprivError>;
