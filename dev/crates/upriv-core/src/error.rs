use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum UprivError {
    #[error("vault root not found: missing {0}")]
    VaultRootNotFound(PathBuf),

    #[error("vault config not found: {0}")]
    VaultNotFound(String),

    #[error("vault already exists: {0}")]
    VaultAlreadyExists(String),

    #[error("vault is open: {0}")]
    VaultAlreadyOpen(String),

    #[error("invalid encrypted store: {0}")]
    InvalidStore(String),

    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("mount error: {0}")]
    Mount(String),

    #[error("invalid storage mode for this operation: expected {expected}, got {actual}")]
    StorageModeMismatch { expected: String, actual: String },

    #[error("workspace already exists: {0}")]
    WorkspaceExists(PathBuf),

    #[error("workspace not found: {0}")]
    WorkspaceNotFound(PathBuf),

    #[error("archive not found: {0}")]
    ArchiveNotFound(PathBuf),

    #[error("7-Zip binary not found")]
    SevenZipNotFound,

    #[error("7-Zip command failed: {command}")]
    SevenZipCommand {
        command: String,
        #[source]
        source: std::io::Error,
    },

    #[error("7-Zip exited with status {status}: {stderr}")]
    SevenZipFailed { status: i32, stderr: String },

    #[error("secure wipe refused: symlinks are not allowed at {0}")]
    SymlinkNotAllowed(PathBuf),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    TomlDeserialize(#[from] toml::de::Error),

    #[error(transparent)]
    TomlSerialize(#[from] toml::ser::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, UprivError>;
