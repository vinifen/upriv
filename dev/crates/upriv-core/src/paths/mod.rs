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

mod distribution;
pub(crate) mod fs_env;
mod init;
mod resolve;

pub use distribution::{
    default_vault_root_anchor, default_vault_root_anchor_for, detect_app_distribution,
    distribution_str, env_app_distribution, infer_app_distribution, init_app_distribution,
    suggested_vault_root, AppDistribution, ENV_DISTRIBUTION,
};
pub use fs_env::env_default_root_anchor;
pub use init::{
    initialize_vault_root, inspect_vault_root_at, open_or_initialize_vault_root,
    open_or_initialize_vault_root_with_options, open_or_initialize_vault_root_with_policy,
    rename_incomplete_upriv, validate_existing_vault_root, IncompleteReplacePolicy,
    VaultRootDirStatus,
};
pub use resolve::{
    app_home_dir, binary_dir, deactivate_vault_root_alias_everywhere, discover_vault_root_upward,
    read_vault_root_alias, resolve_vault_root, setup_default_root_anchor, vault_root_alias_path,
    write_vault_root_alias, write_vault_root_alias_for_root, ResolveVaultRoot,
    ResolveVaultRootOptions, VaultRootAlias, VaultRootMode, VaultRootSource, VAULT_ROOT_ALIAS_FILE,
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
const WORKSPACE_DIR_REL: &str = "workspace";
const RUNTIME_DIR_REL: &str = ".upriv/runtime";

/// Atomically write `bytes` to `path` (temp + `sync_all` + rename).
/// On failure, best-effort removes the temp file.
/// After rename, best-effort fsync of the parent directory on Unix.
pub(crate) fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_extension(format!("tmp.{}.{}", std::process::id(), nonce));
    let result = (|| -> Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        // Best-effort: persist the directory entry after rename (Unix).
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// True when `path` contains the Upriv vault-root marker (`.upriv/settings.toml`).
pub fn is_vault_root_marker(path: impl AsRef<Path>) -> bool {
    path.as_ref().join(SETTINGS_REL).is_file()
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
        let root = path.as_ref().canonicalize().map_err(UprivError::from)?;
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

    pub fn workspace_dir(&self) -> PathBuf {
        self.root.join(WORKSPACE_DIR_REL)
    }

    /// User-visible mount target: `workspace/{display_name}/`.
    pub fn workspace_vault_dir(&self, display_name: &str) -> PathBuf {
        self.workspace_dir()
            .join(sanitize_path_component(display_name))
    }

    pub fn vaults_dir(&self) -> PathBuf {
        self.root.join(VAULTS_DIR_REL)
    }

    pub fn vault_dir(&self, vault_id: &str) -> PathBuf {
        self.vaults_dir().join(sanitize_path_component(vault_id))
    }

    pub fn vault_config_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("config.toml")
    }

    pub fn vault_persistence_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("persistence.json")
    }

    /// Main archive: `vaults/<id>/archive/{display_name}.7z` (display name not normalized).
    pub fn vault_archive_path(&self, vault_id: &str, display_name: &str) -> PathBuf {
        self.vault_dir(vault_id)
            .join("archive")
            .join(format!("{}.7z", sanitize_path_component(display_name)))
    }

    pub fn vault_store_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("store")
    }

    pub fn vault_backups_dir(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("backups")
    }

    pub fn runtime_lock_path(&self, vault_id: &str) -> PathBuf {
        self.root
            .join(RUNTIME_DIR_REL)
            .join(format!("{}.lock", sanitize_path_component(vault_id)))
    }
}

/// Reject `..`, empty, separators, Windows reserved names / illegal chars, and controls
/// so joins cannot escape the vault-root or create invalid OS paths.
fn sanitize_path_component(name: &str) -> &str {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('<')
        || trimmed.contains('>')
        || trimmed.contains(':')
        || trimmed.contains('"')
        || trimmed.contains('|')
        || trimmed.contains('?')
        || trimmed.contains('*')
        || trimmed.chars().any(|c| c.is_control())
        || is_windows_reserved_device_name(trimmed)
    {
        "_"
    } else {
        trimmed
    }
}

/// Windows device names (`CON`, `NUL`, `COM1`, …) including `name.ext` forms.
fn is_windows_reserved_device_name(name: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn prod_example_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("prod-example")
    }

    #[test]
    fn discovers_prod_example_root() {
        let root = VaultRoot::discover(prod_example_root()).expect("prod-example vault root");
        assert!(root.settings_path().is_file());
        assert!(root.vault_config_path("plain-folder-demo").is_file());
        assert!(root.vault_config_path("my-encrypted-notes").is_file());
        assert!(root
            .vault_archive_path("my-encrypted-notes", "My Encrypted Notes")
            .is_file());
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
        std::fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let err = VaultRoot::discover(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn workspace_path_keeps_display_name() {
        let root = VaultRoot::new("/tmp/fake-root");
        assert_eq!(
            root.workspace_vault_dir("My Encrypted Notes"),
            PathBuf::from("/tmp/fake-root/workspace/My Encrypted Notes")
        );
    }

    #[test]
    fn sanitize_rejects_windows_reserved_and_illegal() {
        assert_eq!(sanitize_path_component("CON"), "_");
        assert_eq!(sanitize_path_component("nul.txt"), "_");
        assert_eq!(sanitize_path_component("a:b"), "_");
        assert_eq!(sanitize_path_component("a*b"), "_");
        assert_eq!(sanitize_path_component("ok-name"), "ok-name");
    }
}
