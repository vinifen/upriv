//! Domain errors for `upriv-core`. Keep messages English (logs / RPC wire).
//! UI maps wire `code` strings to i18n — see `@upriv/shared` vault errors.

use std::path::PathBuf;

use thiserror::Error;

use crate::folder_list::PathIssue;

#[derive(Debug, Error)]
pub enum UprivError {
    /// Path is not a vault-root (missing `.upriv/settings.toml`).
    #[error("vault root not found: missing {0}")]
    VaultRootNotFound(PathBuf),

    /// `.upriv` exists but required files/content are missing or invalid.
    #[error("vault root incomplete at {path}: {detail}")]
    VaultRootIncomplete { path: PathBuf, detail: String },

    /// The data folder list in the app home cannot be read as one.
    #[error("data folder list unreadable: {detail}")]
    DataFolderListInvalid { detail: String },

    /// The folder a data folder list selects cannot hold a data folder now.
    #[error("this folder cannot hold a data folder now: {}", .0.as_str())]
    DataFolderUnavailable(crate::folder_probe::FolderState),

    /// A vault is open, opening, closing, or being created, or the data
    /// folder is being exported: the data folder in use cannot change.
    #[error("wait until open, close, create, export, password change, and unlock-RAM change finish before switching data folder")]
    VaultRootBusy,

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

    /// The password opens a header block of this vault, but the vault's files
    /// were written under a newer one: an earlier password of this vault.
    #[error("an earlier password of this vault")]
    PasswordOutdated,

    /// No header file reads, or every one is older than the vault's files. The
    /// header can be read back from the files' key copies (`vault_rebuild`).
    #[error("vault header unreadable")]
    VaultHeaderUnreadable,

    /// A password change on this vault did not finish, and this password
    /// cannot settle it: the new password the change was given does.
    #[error("a password change on this vault did not finish")]
    PasswordChangeInterrupted,

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

    /// `log_get` refused to load a very large file body into memory.
    #[error("log_file_too_large: {size} bytes (max {max}) at {path}")]
    LogFileTooLarge { path: PathBuf, size: u64, max: u64 },

    /// Logical path is missing from the open-session index.
    #[error("vault path not found: {0}")]
    VaultPathNotFound(String),

    /// Create / rename / move would collide with an existing node.
    #[error("vault path exists: {0}")]
    VaultPathExists(String),

    /// No held blob of this name holds a file that can be put back: it was
    /// deleted or put back already, or no index names it.
    #[error("vault held file not found: {0}")]
    VaultHeldNotFound(String),

    /// Full-file RPC payload exceeds the stdio / FFI envelope.
    #[error("vault file too large: {size} bytes (max {max}) at {path}")]
    VaultFileTooLarge { path: PathBuf, size: u64, max: u64 },

    /// Part of this file's data is missing or damaged, so it cannot be read in
    /// full. `path` is the logical path. The file stays in the vault, marked,
    /// and the rest of the vault is unaffected.
    #[error("vault file unreadable ({}): {path}", problem.as_str())]
    VaultFileUnreadable {
        path: String,
        problem: crate::store::FileProblem,
    },

    /// Neither index file of this vault opens, though its header does: the
    /// tree is lost and the data is not. The vault can be rebuilt from the
    /// records its blobs carry, or made again from a backup. `detail` says
    /// why the primary file was refused.
    #[error("vault index unreadable: {detail}")]
    VaultIndexUnreadable { detail: String },

    /// A rebuild was asked for a vault whose header and index open: there is
    /// nothing to rebuild, and a rebuild would only lose what the index alone
    /// holds.
    #[error("the vault index opens, so there is nothing to rebuild")]
    VaultIndexReadable,

    /// A password change needs room for its largest file, twice the index,
    /// and a margin on the drive of the data folder.
    #[error("the password change needs {needed} bytes free, {available} free")]
    PasswordChangeSpaceShort { needed: u64, available: u64 },

    /// This vault is being deleted, or a delete of it did not finish: nothing
    /// opens or changes it until the delete ends.
    #[error("this vault is being deleted")]
    VaultDeleting,

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

    /// This vault must be closed first (export, a password or unlock-RAM
    /// change, Finish, or a rebuild).
    #[error("close this vault first")]
    VaultMustBeClosed,

    /// Export, a password or unlock-RAM change, Finish, or a rebuild already
    /// holds this vault.
    #[error("vault is busy")]
    VaultBusy,

    /// A password change was asked for the password the vault already has.
    #[error("the new password is the current one")]
    PasswordUnchanged,

    /// An unlock-RAM change was asked for the cost already in the header. Not
    /// a broken `config.toml` and not a broken `vault.header`.
    #[error("the unlock RAM is already this one")]
    UnlockRamUnchanged,

    /// A vault in this data folder is open, closing, or held by other work, so
    /// the data folder cannot be exported now.
    #[error("close every vault and wait for its work to finish before exporting the data folder")]
    DataFolderBusy,

    /// A job was stopped: by the person, by an auto-close set to close on
    /// time, or because Upriv is quitting. What it had written was removed.
    #[error("job cancelled")]
    JobCancelled,

    /// A job id is malformed or already names a running job.
    #[error("job id is malformed or already running")]
    JobIdInvalid,

    /// The job is in its last step, which always finishes once it begins.
    #[error("this work can no longer be stopped")]
    JobNotStoppable,

    /// The data folder is being exported. Another export, a new vault, and a
    /// backup delete or pin wait until it ends.
    #[error("the data folder is being exported")]
    DataFolderExportBusy,

    /// A backup export is reading this backup. Delete and pin wait until it ends.
    #[error("this backup is being exported")]
    BackupExporting,

    /// The chosen folder's drive does not have room for the data-folder zip.
    #[error("data folder export needs {needed} bytes, {available} free")]
    DataFolderExportSpaceShort { needed: u64, available: u64 },

    /// An export cannot go inside a `.upriv` folder: a data-folder copy would
    /// contain itself, and any export would write into a data folder.
    #[error("an export cannot write inside .upriv: {0}")]
    ExportDestinationReserved(PathBuf),

    /// The zip name breaks a rule of some system the copy may unzip on.
    #[error("the data folder zip name is not a portable file name")]
    DataFolderExportNameInvalid,

    /// The chosen folder already holds a zip with this name, or one still
    /// being written. Nothing is replaced.
    #[error("the chosen folder already has {0}")]
    DataFolderExportNameTaken(PathBuf),

    /// This device has no ID for this run, so its folder lists are not used
    /// and a plain-text vault does not open.
    #[error("this device has no ID")]
    DeviceUnknown,

    /// Another device still has a plain-text folder of this vault on record.
    /// The vault cannot be deleted until that folder is wiped there or forgotten.
    #[error("plain-text files of this vault remain on device {device} at {path}")]
    VaultPlainElsewhere {
        device: String,
        system: crate::device::DeviceSystem,
        path: String,
    },

    /// This device recorded a plain-text folder of this vault on a drive that
    /// cannot be proven here: unplugged, not answering, or another drive in
    /// its place. The vault does not open until the drive is back or the
    /// record is forgotten.
    #[error(
        "plain-text files of this vault are on device {device} at {path}, which cannot be reached"
    )]
    PlainFolderUnreachable {
        device: String,
        system: crate::device::DeviceSystem,
        path: String,
    },

    /// A change to a folder list that breaks its rules: row numbers, or a
    /// selection that names no row.
    #[error("folder list change refused: {detail}")]
    FolderListInvalid { detail: String },

    /// A row's path that its list refuses for its device's system.
    #[error("folder path refused ({}): {path}", issue.as_str())]
    FolderPathRefused { path: String, issue: PathIssue },

    /// Two rows of one device group, or a row and the folder of a fixed
    /// choice, name the same folder.
    #[error("folder already in the list: {path}")]
    FolderPathDuplicate { path: String },

    /// An unlocked folder row that an open vault uses right now.
    #[error("a vault is open in {path}")]
    FolderInUse { path: String },

    /// A plain-text vault with no unlocked folder selected on this device.
    #[error("no unlocked folder is selected on this device")]
    UnlockedFolderUnset,

    /// No choice of the unlocked folder chain can take the vault's folder.
    #[error("no unlocked folder can take this vault: {0}")]
    UnlockedFolderUnavailable(PathBuf),

    /// FUSE or WinFsp is not installed: no encrypted vault gets an unlocked folder.
    #[error("the unlocked folder driver is not installed")]
    MountDriverMissing,

    /// The folder's file system cannot hold an encrypted vault's unlocked
    /// folder (exFAT or FAT on Windows).
    #[error("this file system cannot hold an unlocked folder: {0}")]
    MountFilesystemUnsupported(PathBuf),

    /// No folder of the backup chain could take the zip, the data folder
    /// included. The reason is the selected folder's.
    #[error("no backup folder can take a zip now: {}", .0.as_str())]
    BackupUnavailable(crate::folder_probe::FolderState),

    /// A backup name that is too long or holds only characters a system refuses.
    #[error("this backup name cannot be used")]
    BackupNameInvalid,

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, UprivError>;

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
        }
    }
}
