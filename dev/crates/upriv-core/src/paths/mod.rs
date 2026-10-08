//! Vault-root path contract (PRD §5 / SDD §3 / `prod-example/README.md`).
//!
//! - [`VaultRoot`] — paths under an opened root  
//! - [`resolve_vault_root`] — launch discovery (explicit → `custom_root` active alias → `default_root`)  
//! - [`initialize_vault_root`] — create default `.upriv/` layout  
//!
//! App settings TOML (`.upriv/settings.toml`) lives in [`crate::config`].
//! Alias (`.upriv-root` in app home) is created only for “another folder”.
//! Default-root mode ignores an active alias (alias file is the on-disk source of truth for
//! mode/path — not `settings.toml`) and deactivates it on save.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
mod distribution;
pub(crate) mod fs_env;
mod init;
mod relocate;
mod resolve;
mod slug_alloc;
mod workspace;

pub use distribution::{
    default_vault_root_anchor, default_vault_root_anchor_for, detect_app_distribution,
    distribution_str, env_app_distribution, infer_app_distribution, init_app_distribution,
    suggested_vault_root, AppDistribution, ENV_DISTRIBUTION,
};
pub use fs_env::env_default_root_anchor;
pub use init::{
    initialize_vault_root, initialize_vault_root_with_bootstrap, inspect_vault_root_at,
    open_or_initialize_vault_root, rename_incomplete_upriv, validate_existing_vault_root,
    IncompleteReplacePolicy, OpenedVaultRoot, VaultRootBootstrapPrefs, VaultRootDirStatus,
};
#[cfg(test)]
#[allow(unused_imports)]
pub(crate) use init::{
    open_or_initialize_vault_root_with_options, open_or_initialize_vault_root_with_policy,
    open_or_initialize_vault_root_with_policy_and_bootstrap,
};
pub use relocate::{relocate_upriv_dir, UprivDirRelocate};
pub use resolve::{
    app_home_dir, binary_dir, deactivate_vault_root_alias_everywhere, discover_vault_root_upward,
    read_vault_root_alias, resolve_vault_root, setup_default_root_anchor, vault_root_alias_path,
    write_vault_root_alias, write_vault_root_alias_for_root, ResolveVaultRoot,
    ResolveVaultRootOptions, VaultRootAlias, VaultRootMode, VaultRootSource, VAULT_ROOT_ALIAS_FILE,
};
pub use slug_alloc::display_name_to_vault_id;
pub use workspace::{
    app_workspace_place, encrypted_shortcut_active, is_absolute_filesystem_path,
    is_absolute_workspace_address, is_reserved_upriv_workspace_path,
    path_is_under_reserved_upriv_tree, resolve_vault_mount_point, resolved_workspace_parent,
    suggested_default_workspace_path, validate_workspace_global_path, validate_workspace_table,
    VaultMountSection, VaultShortcut, WorkspaceOsEntry, WorkspacePlace, WorkspaceSettings,
    WorkspaceSystem, WorkspaceTable, RESERVED_UPRIV_WORKSPACE_CHILDREN,
};

/// Crate-internal: validate/open a default_root candidate path (used by `config::app_settings`).
pub(crate) use resolve::open_default_root_candidate;

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};

#[cfg(test)]
pub(crate) static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Restores env vars on drop (panic-safe) for path/distribution tests.
#[cfg(test)]
pub(crate) struct EnvGuard {
    keys: Vec<&'static str>,
    previous: Vec<(String, Option<std::ffi::OsString>)>,
}

#[cfg(test)]
impl EnvGuard {
    pub fn capture(keys: &[&'static str]) -> Self {
        let previous = keys
            .iter()
            .map(|k| ((*k).to_string(), std::env::var_os(k)))
            .collect();
        Self {
            keys: keys.to_vec(),
            previous,
        }
    }
}

#[cfg(test)]
impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.previous.drain(..) {
            match value {
                Some(v) => std::env::set_var(&key, v),
                None => std::env::remove_var(&key),
            }
        }
        let _ = &self.keys;
    }
}

/// Marker file that identifies a Upriv vault-root directory.
pub const VAULT_ROOT_SETTINGS_REL: &str = ".upriv/settings.toml";

const SETTINGS_REL: &str = VAULT_ROOT_SETTINGS_REL;
const VAULTS_DIR_REL: &str = ".upriv/vaults";
const STATE_FILE_REL: &str = ".upriv/state.json";
const LOGS_DIR_REL: &str = ".upriv/logs";
const APP_DIR_REL: &str = ".upriv/app";
const RUNTIME_DIR_REL: &str = ".upriv/runtime";

/// On-disk vault body leaf: `vaults/<id>/store/` (`header/` + `index/` + `data/`).
pub const STORE_DIR_NAME: &str = "store";

/// Atomically write `bytes` to `path` (temp + `sync_all` + rename + parent fsync).
/// On a storage-access folder, a provider that refuses to rename onto an
/// existing document is overwritten in place from the same bytes.
/// On failure, best-effort removes the temp file.
/// After rename, fsync the parent directory on Unix and return that error.
///
/// Creates missing parent directories. Prefer
/// [`write_bytes_atomic_existing_parent`] for vault-root `settings.toml` so a
/// deleted `.upriv` is not silently recreated mid-session.
pub(crate) fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    write_bytes_atomic_inner(path, bytes, true)
}

/// Flush one file to stable storage. One call per document, on every OS:
/// `fsync` on Linux and Android, `FlushFileBuffers` on Windows, `F_FULLFSYNC`
/// on Mac and iOS. Opened for write because Windows rejects `FlushFileBuffers`
/// on a read-only handle.
pub(crate) fn sync_file_durable(path: &Path) -> Result<()> {
    let file = open_nofollow(path, NofollowMode::ReadWrite)?;
    sync_handle(&file)
}

/// Open the final path component without following it.
#[derive(Clone, Copy)]
pub(crate) enum NofollowMode {
    Read,
    ReadWrite,
    CreateNew,
}

/// Open `path` without following a symlink or Windows reparse point at the
/// final component. Directory symlinks earlier in the path are still followed,
/// so a vault folder that is itself a link keeps working.
pub(crate) fn open_nofollow(
    path: &Path,
    mode: NofollowMode,
) -> std::io::Result<crate::host_fs::File> {
    use std::io::{Error, ErrorKind};

    if let Ok(kind) = crate::host_fs::entry_kind(path) {
        if kind == crate::host_fs::EntryKind::Symlink {
            return Err(Error::new(ErrorKind::InvalidInput, "refusing a symlink"));
        }
        if !matches!(mode, NofollowMode::CreateNew) && kind != crate::host_fs::EntryKind::File {
            return Err(Error::new(ErrorKind::InvalidInput, "refusing a non-file"));
        }
    }

    let mut opts = crate::host_fs::OpenOptions::new();
    match mode {
        NofollowMode::Read => {
            opts.read(true);
        }
        NofollowMode::ReadWrite => {
            opts.read(true).write(true);
        }
        NofollowMode::CreateNew => {
            opts.read(true).write(true).create_new(true);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        opts.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = opts.open(path).map_err(|error| {
        if is_symlink_open_error(&error) {
            Error::new(ErrorKind::InvalidInput, "refusing a symlink")
        } else {
            error
        }
    })?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if file.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(Error::new(ErrorKind::InvalidInput, "refusing a symlink"));
        }
    }
    if !file.metadata()?.host_is_file() {
        return Err(Error::new(ErrorKind::InvalidInput, "refusing a non-file"));
    }
    Ok(file)
}

/// Why [`open_nofollow`] refused a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NofollowReject {
    Symlink,
    NonFile,
}

/// `Some` when `error` is the refusal from [`open_nofollow`].
pub(crate) fn nofollow_reject(error: &std::io::Error) -> Option<NofollowReject> {
    if error.kind() != std::io::ErrorKind::InvalidInput {
        return None;
    }
    if error.to_string().contains("non-file") {
        Some(NofollowReject::NonFile)
    } else {
        Some(NofollowReject::Symlink)
    }
}

fn is_symlink_open_error(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(libc::ELOOP)
    }
    #[cfg(not(unix))]
    {
        let _ = error;
        false
    }
}

/// Flush a directory so a new file name survives a crash. Unix only.
///
/// A storage-access directory cannot be fsynced. The provider rename already
/// returned, and opening the path would sync a local stand-in instead.
#[cfg(unix)]
pub(crate) fn sync_dir_durable(path: &Path) -> Result<()> {
    if crate::host_fs::is_bridge_path(path) {
        return Ok(());
    }
    let file = crate::host_fs::File::open(path)?;
    sync_handle(&file)
}

fn sync_handle(file: &crate::host_fs::File) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let rc = unsafe { libc::fcntl(std::os::fd::AsRawFd::as_raw_fd(file), libc::F_FULLFSYNC) };
        if rc != 0 {
            file.sync_all()?;
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        file.sync_all()?;
        Ok(())
    }
}

/// Like [`write_bytes_atomic`], but fails if the parent directory is missing
/// (does **not** `create_dir_all`).
pub(crate) fn write_bytes_atomic_existing_parent(path: &Path, bytes: &[u8]) -> Result<()> {
    write_bytes_atomic_inner(path, bytes, false)
}

fn write_bytes_atomic_inner(path: &Path, bytes: &[u8], create_parents: bool) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        if create_parents {
            crate::host_fs::create_dir_all(parent)?;
        } else if !parent.host_is_dir() {
            return Err(UprivError::VaultRootNotFound(path.to_path_buf()));
        }
    }
    // A storage-access provider will not rename onto a file that already
    // exists, so the temp file was a full extra copy of a growing index.
    // Overwrite that document once.
    if crate::host_fs::is_bridge_path(path) && path.host_is_file() {
        return overwrite_bridge_file(path, bytes);
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_extension(format!("tmp.{}.{}", std::process::id(), nonce));
    let result = (|| -> Result<()> {
        let mut file = crate::host_fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Err(error) = crate::host_fs::rename(&tmp, path) {
            if !crate::host_fs::is_bridge_path(path) {
                return Err(UprivError::from(error));
            }
            // The provider will not rename onto an existing document. The temp
            // file already holds the new bytes.
            if let Err(overwrite_error) = overwrite_bridge_file(path, bytes) {
                if path.host_is_file() || crate::host_fs::rename(&tmp, path).is_err() {
                    return Err(overwrite_error);
                }
            }
            let _ = crate::host_fs::remove_file(&tmp);
        }
        // The file body is durable before the rename. The directory entry is
        // not, until the parent is synced. A failure here is a failed write:
        // ignoring it reported success for a rename a crash could still drop.
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            sync_dir_durable(parent)?;
        }
        Ok(())
    })();
    if result.is_err() {
        // A storage-access replace may already have removed the destination.
        // Keep the temp file in that case; it still holds the new bytes.
        let destination_missing = crate::host_fs::is_bridge_path(path) && !path.host_is_file();
        if !destination_missing {
            let _ = crate::host_fs::remove_file(&tmp);
        }
    }
    result
}

/// Replace one storage-access document. Used when rename cannot take a name
/// that already exists. Callers keep the temp file until this returns `Ok`.
fn overwrite_bridge_file(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = crate::host_fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    match crate::host_fs::metadata(path) {
        Ok(meta) if meta.len() == bytes.len() as u64 => return Ok(()),
        _ => {}
    }
    // `"wt"` opened the old document without truncating it. Replace the
    // document so the previous bytes cannot stay after the new write.
    let _ = crate::host_fs::remove_file(path);
    let mut file = crate::host_fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    let meta = crate::host_fs::metadata(path)?;
    if meta.len() != bytes.len() as u64 {
        return Err(UprivError::Io(std::io::Error::other(
            "storage-access replace left a different length",
        )));
    }
    Ok(())
}

/// True when `path` contains the Upriv vault-root marker (`.upriv/settings.toml`).
pub fn is_vault_root_marker(path: impl AsRef<Path>) -> bool {
    path.as_ref().join(SETTINGS_REL).host_is_file()
}

/// Canonical paths under a vault-root directory.
#[derive(Debug, Clone)]
pub struct VaultRoot {
    root: PathBuf,
}

impl VaultRoot {
    /// Open an existing vault-root (must contain a **valid** `.upriv/settings.toml`).
    ///
    /// Uses the same rules as inspect/default_root: missing `.upriv` → NotFound;
    /// `.upriv` present but broken/empty → Incomplete (not NotFound).
    pub fn discover(path: impl AsRef<Path>) -> Result<Self> {
        let root = crate::host_fs::canonicalize(path.as_ref()).map_err(UprivError::from)?;
        crate::paths::validate_existing_vault_root(&root)?;
        Ok(Self { root })
    }

    /// Use a vault-root path without requiring the marker (unit tests).
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn settings_path(&self) -> PathBuf {
        self.root.join(SETTINGS_REL)
    }

    pub fn state_path(&self) -> PathBuf {
        self.root.join(STATE_FILE_REL)
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.root.join(LOGS_DIR_REL)
    }

    pub fn app_dir(&self) -> PathBuf {
        self.root.join(APP_DIR_REL)
    }

    /// Suggested default only: `<root>/workspace`.
    ///
    /// **Do not use for vault open.** Live mount parents come from the
    /// per-system `[workspace]` / `[mount]` tables via
    /// [`resolve_vault_mount_point`]. This helper is a hint only.
    pub fn workspace_dir(&self) -> PathBuf {
        suggested_default_workspace_path(&self.root)
    }

    /// Suggested leaf under the default workspace parent: `workspace/{display_name}/`.
    ///
    /// **Do not use for vault open.** Prefer [`resolve_vault_mount_point`] with the
    /// effective path for this system.
    pub fn workspace_vault_dir(&self, display_name: &str) -> PathBuf {
        self.workspace_dir()
            .join(sanitize_display_leaf(display_name))
    }

    pub fn vaults_dir(&self) -> PathBuf {
        self.root.join(VAULTS_DIR_REL)
    }

    pub fn vault_dir(&self, vault_id: &str) -> Result<PathBuf> {
        Ok(self.vaults_dir().join(vault_id_component(vault_id)?))
    }

    pub fn vault_config_path(&self, vault_id: &str) -> Result<PathBuf> {
        Ok(self.vault_dir(vault_id)?.join("config.toml"))
    }

    pub fn vault_persistence_path(&self, vault_id: &str) -> Result<PathBuf> {
        Ok(self.vault_dir(vault_id)?.join("persistence.json"))
    }

    /// Vault body at rest: `vaults/<id>/store/` (`header/` + index + chunks).
    pub fn vault_store_dir(&self, vault_id: &str) -> Result<PathBuf> {
        Ok(self.vault_dir(vault_id)?.join(STORE_DIR_NAME))
    }

    /// Suggested export filename only (`{display_name}.zip` or `.7z`).
    /// Never a path under `vaults/<id>/` — a durable twin beside `store/` is forbidden.
    /// Sanitizes path-illegal characters for the OS save dialog; does **not** change `display_name`.
    pub fn vault_suggested_export_filename(display_name: &str, seven_zip: bool) -> String {
        let name = sanitize_filename_base(display_name);
        if seven_zip {
            format!("{name}.7z")
        } else {
            format!("{name}.zip")
        }
    }

    pub fn vault_backups_dir(&self, vault_id: &str) -> Result<PathBuf> {
        Ok(self.vault_dir(vault_id)?.join("backups"))
    }

    pub fn runtime_lock_path(&self, vault_id: &str) -> Result<PathBuf> {
        Ok(self
            .root
            .join(RUNTIME_DIR_REL)
            .join(format!("{}.lock", vault_id_component(vault_id)?)))
    }
}

/// Reject `..`, empty, separators, Windows reserved names / illegal chars, and controls
/// so joins cannot escape the vault-root or create invalid OS paths.
pub(crate) fn vault_id_component(name: &str) -> Result<&str> {
    let trimmed = name.trim();
    if !slug_id_is_valid(trimmed) {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("invalid vault id path component: {trimmed}"),
        )));
    }
    Ok(trimmed)
}

/// Trim and collapse Unicode whitespace to a single ASCII space.
/// Persist this form for vault names and group titles only.
pub(crate) fn normalize_stored_name(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Display-name leaf fallback for workspace mount folders.
pub(crate) fn sanitize_display_leaf(name: &str) -> String {
    let normalized = normalize_stored_name(name);
    if normalized.is_empty()
        || normalized == "."
        || normalized == ".."
        || normalized.contains('/')
        || normalized.contains('\\')
        || normalized.contains('<')
        || normalized.contains('>')
        || normalized.contains(':')
        || normalized.contains('"')
        || normalized.contains('|')
        || normalized.contains('?')
        || normalized.contains('*')
        || normalized.chars().any(|c| c.is_control())
        || is_windows_reserved_device_name(&normalized)
    {
        "_".to_string()
    } else {
        normalized
    }
}

/// Export filename base. Unlike `sanitize_path_component`, which guards path
/// joins and must fail closed, this keeps the user's name recognizable by
/// replacing illegal characters (`Notes: 2026` → `Notes_ 2026`).
/// Outer folder inside a portable `.7z`. Same rules as the suggested filename.
pub(crate) fn seven_zip_outer_folder(display_name: &str) -> String {
    sanitize_filename_base(display_name)
}

fn sanitize_filename_base(display_name: &str) -> String {
    let replaced: String = normalize_stored_name(display_name)
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = normalize_stored_name(&replaced);
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || is_windows_reserved_device_name(&trimmed)
    {
        return "vault".to_string();
    }
    trimmed
}

/// Windows device names (`CON`, `NUL`, `COM1`, …) including `name.ext` forms.
pub(crate) fn is_windows_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Vault / group slug ids (TS `displayNameToVaultId`): `[a-z0-9-]+`, 1–64,
/// no leading/trailing hyphen, not a Windows reserved device name.
pub(crate) fn slug_id_is_valid(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    if id.starts_with('-') || id.ends_with('-') {
        return false;
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return false;
    }
    !is_windows_reserved_device_name(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;

    use crate::test_support::{vault_root_with, VaultSpec};

    #[test]
    fn discovers_minimal_vault_root() {
        let (_tmp, root) = vault_root_with(&[
            VaultSpec::upriv_plain("plain-folder-demo", "Plain Folder Demo", 3),
            VaultSpec::encrypted("my-encrypted-notes", "My Encrypted Notes", 4),
        ]);
        assert!(root.settings_path().host_is_file());
        assert!(root
            .vault_config_path("plain-folder-demo")
            .unwrap()
            .host_is_file());
        assert!(root
            .vault_config_path("my-encrypted-notes")
            .unwrap()
            .host_is_file());
        assert_eq!(
            root.vault_store_dir("my-encrypted-notes").unwrap(),
            root.vault_dir("my-encrypted-notes")
                .unwrap()
                .join(STORE_DIR_NAME)
        );
    }

    #[test]
    fn marker_false_without_settings() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_vault_root_marker(dir.path()));
        let err = VaultRoot::discover(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootNotFound(_)));
    }

    #[test]
    fn discover_empty_upriv_dir_is_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        crate::host_fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let err = VaultRoot::discover(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn workspace_path_keeps_display_name() {
        assert_eq!(
            resolve_vault_mount_point("/tmp/fake-root", "My Encrypted Notes", false).unwrap(),
            PathBuf::from("/tmp/fake-root/workspace/My Encrypted Notes")
        );
        assert_eq!(
            resolve_vault_mount_point("/custom/mount/parent", "My Encrypted Notes", true).unwrap(),
            PathBuf::from("/custom/mount/parent/My Encrypted Notes")
        );
    }

    #[test]
    fn sanitize_rejects_windows_reserved_and_illegal() {
        assert!(vault_id_component("CON").is_err());
        assert!(vault_id_component("nul.txt").is_err());
        assert!(vault_id_component("a:b").is_err());
        assert!(vault_id_component("a*b").is_err());
        assert_eq!(vault_id_component("ok-name").unwrap(), "ok-name");
        assert_eq!(sanitize_display_leaf("CON"), "_");
        assert_eq!(sanitize_display_leaf("A    B"), "A B");
        assert_eq!(
            normalize_stored_name("  TEST    ASDF   ASD  "),
            "TEST ASDF ASD"
        );
    }

    #[test]
    fn suggested_export_filename_sanitizes_and_defaults() {
        assert_eq!(
            VaultRoot::vault_suggested_export_filename("My notes", false),
            "My notes.zip"
        );
        assert_eq!(
            VaultRoot::vault_suggested_export_filename("a/b:c", true),
            "a_b_c.7z"
        );
        assert_eq!(
            VaultRoot::vault_suggested_export_filename("Notes: 2026", false),
            "Notes_ 2026.zip"
        );
        assert_eq!(
            VaultRoot::vault_suggested_export_filename("a\u{7f}b", false),
            "a_b.zip"
        );
        assert_eq!(
            VaultRoot::vault_suggested_export_filename("  ", false),
            "vault.zip"
        );
        assert_eq!(
            VaultRoot::vault_suggested_export_filename("CON", false),
            "vault.zip"
        );
        assert_eq!(
            VaultRoot::vault_suggested_export_filename("My    notes", false),
            "My notes.zip"
        );
    }

    #[test]
    fn slug_id_matches_vault_and_group_rules() {
        assert!(slug_id_is_valid("work"));
        assert!(slug_id_is_valid("my-encrypted-notes"));
        assert!(!slug_id_is_valid(""));
        assert!(!slug_id_is_valid("Foo Bar"));
        assert!(!slug_id_is_valid("-work"));
        assert!(!slug_id_is_valid("CON"));
        assert!(!slug_id_is_valid("aux"));
    }
}
