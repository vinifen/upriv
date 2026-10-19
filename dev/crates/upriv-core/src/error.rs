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

    /// Portable `.7z` export could not keep logical bytes in RAM.
    #[error("insufficient RAM to export portable .7z")]
    InsufficientRamExport,

    /// `store/` header/index unreadable, unknown version, or AEAD fail after a good wrap.
    #[error("vault store invalid at {path}: {detail}")]
    VaultStoreInvalid { path: PathBuf, detail: String },

    /// This system has not confirmed the plaintext folder at `path` for this
    /// vault. Nothing was written. The app shows the path and what kind of
    /// place it is, and opens again with that path once the user agrees.
    #[error("confirm the plaintext folder at {path}")]
    PlainDestinationUnconfirmed {
        path: PathBuf,
        class: crate::vault::PlainFolderClass,
    },

    /// The plaintext folder cannot be placed at `path`.
    #[error("plaintext folder refused at {path}: {}", reason.as_str())]
    PlainDestinationInvalid {
        path: PathBuf,
        reason: PlainDestinationReason,
    },

    /// A plaintext folder from an earlier session still holds files. The vault
    /// is in recovery until that folder is removed.
    #[error("a plaintext folder from an earlier session is still on disk")]
    PlainLeftover,

    /// Some vault names cannot be written as files on this system.
    #[error("{count} file names cannot be written to the plaintext folder")]
    PlainNamesUnsupported { count: usize, examples: Vec<String> },

    /// The plaintext folder's drive does not have room for the vault's files.
    #[error("plaintext folder needs {needed} bytes, {available} free")]
    PlainSpaceShort { needed: u64, available: u64 },

    /// The plaintext folder refused `count` of the vault's files on open.
    /// What was written is wiped again.
    #[error("{count} files could not be written to the plaintext folder")]
    PlainFolderUnwritable { count: usize },

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

    /// Logical path is missing from the open-session index.
    #[error("vault path not found: {0}")]
    VaultPathNotFound(String),

    /// Create / rename / move would collide with an existing node.
    #[error("vault path exists: {0}")]
    VaultPathExists(String),

    /// Full-file RPC payload exceeds the stdio / FFI envelope.
    #[error("vault file too large: {size} bytes (max {max}) at {path}")]
    VaultFileTooLarge { path: PathBuf, size: u64, max: u64 },

    /// `runtime/<id>.lock` is held by a live process (this host or another).
    #[error("vault locked: {0}")]
    VaultLocked(PathBuf),

    /// Virtual mount failed (missing FUSE/WinFsp, busy mountpoint, …).
    #[error("vault mount failed: {0}")]
    VaultMountFailed(String),

    /// Import `.zip` / `.7z` path is relative, missing, or unreadable.
    /// Not transport `io_error` — that wire code is mapped to the vault-root data-folder toast.
    #[error("import archive unreadable: {0}")]
    ImportArchiveNotFound(PathBuf),

    /// OS path for `vault_fs_import_os_file` is relative, missing, a symlink,
    /// not a regular file, or inside this vault's `store/`.
    /// Not `io_error` (vault-root toast) and not `workspace_path_*` (Gate).
    #[error("import source unreadable: {0}")]
    ImportSourceUnreadable(PathBuf),

    /// This vault must be closed first (export, or password / unlock-RAM rewrap).
    #[error("close this vault first")]
    VaultMustBeClosed,

    /// Export, password change, or unlock-RAM change already holds this vault.
    #[error("vault is busy")]
    VaultBusy,

    /// The safety zip could not be written, so the live `store/` was not rewritten.
    #[error("could not write a backup, so the vault was left unchanged")]
    VaultBackupFailed,

    /// Password or unlock-RAM change asked for the value already in the header.
    /// Not a broken `config.toml` and not a broken `vault.header`.
    #[error("rewrap changes nothing")]
    RewrapUnchanged(RewrapUnchangedKind),

    /// A vault in this data folder is open, closing, or held by other work, so
    /// the data folder cannot be exported now.
    #[error("close every vault and wait for its work to finish before exporting the data folder")]
    DataFolderBusy,

    /// The data folder is being exported. Another export, a new vault, and a
    /// backup delete or pin wait until it ends.
    #[error("the data folder is being exported")]
    DataFolderExportBusy,

    /// The user stopped the data-folder export. Its partial zip was removed.
    #[error("data folder export cancelled")]
    DataFolderExportCancelled,

    /// The chosen folder's drive does not have room for the data-folder zip.
    #[error("data folder export needs {needed} bytes, {available} free")]
    DataFolderExportSpaceShort { needed: u64, available: u64 },

    /// The data-folder zip cannot go inside a `.upriv` folder: the copy would
    /// contain itself, or write into another data folder.
    #[error("data folder export cannot write inside .upriv: {0}")]
    DataFolderExportDestinationReserved(PathBuf),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, UprivError>;

/// Which rewrap was a no-op. The wire code picks the matching "must be different" string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RewrapUnchangedKind {
    Password,
    UnlockRam,
}

/// Why a plaintext folder cannot be placed. Wire `details.reason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlainDestinationReason {
    /// Inside `.upriv`, or the folder would contain the data folder.
    Reserved,
    /// A drive root or the home folder itself.
    SystemFolder,
    /// Inside, around, or the same as another vault's folder.
    Overlap,
    /// The folder already holds files that are not this vault's.
    Occupied,
    /// The path is a file, a link, or not a real folder.
    NotAFolder,
    /// App-private storage on a phone. Other apps could not open the files.
    PrivateStorage,
    /// This system cannot hold a plaintext folder at that kind of place.
    Unsupported,
}

impl PlainDestinationReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::SystemFolder => "system_folder",
            Self::Overlap => "overlap",
            Self::Occupied => "occupied",
            Self::NotAFolder => "not_a_folder",
            Self::PrivateStorage => "private_storage",
            Self::Unsupported => "unsupported",
        }
    }
}
