//! Create / open a vault-root layout (marker + empty dirs).

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};
use crate::paths::{VaultRoot, VAULT_ROOT_SETTINGS_REL};
use crate::time::utc_filename_stamp;

/// Default `.upriv/settings.toml` for a newly initialized root.
const DEFAULT_SETTINGS_TOML: &str = r#"# Upriv marker + app settings (vault-root directory)

[package]
version = 1
label = "Upriv"
vaults_dir = ".upriv/vaults"
state_file = ".upriv/state.json"
logs_dir = ".upriv/logs"
app_dir = ".upriv/app"
workspace_dir = "workspace"

[ui]
locale = "en"
theme = "dark"
vault_list_sort = "order"
vault_list_sort_direction = "asc"
vault_list_view = "default"
always_show_hidden_vaults = false
file_manager_dock_expanded = false

[logging]
enabled = true
level = "info"
entries_per_file = 1000

[app]
# Vault-root mode (nearby vs custom) is NOT configured in this file.
# It lives in the app-home `.upriv-root` alias:
#   missing or status=inactive → nearby mode
#   status=active + path → custom vault-root
"#;

/// Minimal TOML shape required for a usable vault-root marker.
#[derive(Debug, serde::Deserialize)]
struct SettingsTomlRequired {
    package: PackageTomlRequired,
}

#[derive(Debug, serde::Deserialize)]
struct PackageTomlRequired {
    vaults_dir: String,
}

/// Validate an existing `.upriv/` tree. Does not create or overwrite files.
///
/// Fails when `.upriv` exists but required pieces are missing/corrupt so callers
/// can alert the user instead of silently rewriting settings.
pub fn validate_existing_vault_root(dir: impl AsRef<Path>) -> Result<()> {
    let dir = dir.as_ref();
    let upriv = dir.join(".upriv");
    if !upriv.exists() {
        return Err(UprivError::VaultRootNotFound(
            dir.join(VAULT_ROOT_SETTINGS_REL),
        ));
    }
    if !upriv.is_dir() {
        return Err(UprivError::VaultRootIncomplete {
            path: upriv,
            detail: ".upriv exists but is not a directory".into(),
        });
    }

    let settings = dir.join(VAULT_ROOT_SETTINGS_REL);
    if !settings.is_file() {
        return Err(UprivError::VaultRootIncomplete {
            path: settings,
            detail: "missing .upriv/settings.toml".into(),
        });
    }

    let raw = std::fs::read_to_string(&settings).map_err(UprivError::from)?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(UprivError::VaultRootIncomplete {
            path: settings,
            detail: ".upriv/settings.toml is empty".into(),
        });
    }

    // Parse required keys — do not use substring checks (comments/tokens can fake them).
    let parsed: SettingsTomlRequired =
        toml::from_str(trimmed).map_err(|error| UprivError::VaultRootIncomplete {
            path: settings.clone(),
            detail: format!(".upriv/settings.toml is not valid TOML: {error}"),
        })?;
    if parsed.package.vaults_dir.trim().is_empty() {
        return Err(UprivError::VaultRootIncomplete {
            path: settings,
            detail: ".upriv/settings.toml [package].vaults_dir is empty".into(),
        });
    }
    Ok(())
}

fn ensure_standard_dirs(dir: &Path) -> Result<()> {
    for relative in [
        ".upriv/vaults",
        ".upriv/logs",
        ".upriv/app",
        ".upriv/runtime",
        "workspace",
    ] {
        std::fs::create_dir_all(dir.join(relative))?;
    }
    Ok(())
}

/// Open an existing vault-root or create a fresh default layout.
///
/// - Valid marker + settings → open as-is (never overwrite `settings.toml`)
/// - `.upriv` present but incomplete → [`UprivError::VaultRootIncomplete`]
///   (unless [`open_or_initialize_vault_root_with_options`] with `replace_incomplete`)
/// - No `.upriv` → create default structure
pub fn open_or_initialize_vault_root(dir: impl AsRef<Path>) -> Result<VaultRoot> {
    open_or_initialize_vault_root_with_options(dir, false)
}

/// Status of `.upriv/` at `dir` (does not create or repair).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NearbyVaultRootStatus {
    /// No `.upriv` directory.
    Absent,
    /// Marker + required settings present.
    Valid,
    /// `.upriv` exists but is missing/corrupt required files.
    Incomplete,
    /// `.upriv` exists but could not be read (I/O) — not the same as incomplete content.
    Unreadable,
}

/// Inspect whether `dir` already has a usable nearby vault-root.
pub fn inspect_vault_root_at(dir: impl AsRef<Path>) -> NearbyVaultRootStatus {
    let dir = dir.as_ref();
    let upriv = dir.join(".upriv");
    if !upriv.exists() {
        return NearbyVaultRootStatus::Absent;
    }
    match validate_existing_vault_root(dir) {
        Ok(()) => NearbyVaultRootStatus::Valid,
        Err(UprivError::Io(_)) => NearbyVaultRootStatus::Unreadable,
        Err(_) => NearbyVaultRootStatus::Incomplete,
    }
}

/// How to dispose of a broken nearby `.upriv/` before creating a fresh one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncompleteReplacePolicy {
    /// Delete `.upriv/` permanently, then create a fresh layout.
    Delete,
    /// Rename `.upriv` → `.upriv-invalidated-<timestamp>` (append more stamps on collision).
    Rename,
}

/// Like [`open_or_initialize_vault_root`], but when `replace_incomplete` is true and
/// `.upriv` is broken, dispose of it and create a fresh default layout.
///
/// **Safety:** `replace_incomplete = true` uses [`IncompleteReplacePolicy::Rename`]
/// (not Delete). Prefer [`open_or_initialize_vault_root_with_policy`] when the UI
/// must choose rename vs delete explicitly.
pub fn open_or_initialize_vault_root_with_options(
    dir: impl AsRef<Path>,
    replace_incomplete: bool,
) -> Result<VaultRoot> {
    open_or_initialize_vault_root_with_policy(
        dir,
        if replace_incomplete {
            Some(IncompleteReplacePolicy::Rename)
        } else {
            None
        },
    )
}

/// Open / create vault-root. When `.upriv` is incomplete, `replace` selects dispose policy
/// (`None` → [`UprivError::VaultRootIncomplete`]).
pub fn open_or_initialize_vault_root_with_policy(
    dir: impl AsRef<Path>,
    replace: Option<IncompleteReplacePolicy>,
) -> Result<VaultRoot> {
    let dir = dir.as_ref();

    match inspect_vault_root_at(dir) {
        NearbyVaultRootStatus::Valid => {
            ensure_standard_dirs(dir)?;
            VaultRoot::discover(dir)
        }
        NearbyVaultRootStatus::Absent => initialize_vault_root(dir),
        NearbyVaultRootStatus::Unreadable => {
            // Surface the underlying I/O error (do not offer replace as if corrupt).
            validate_existing_vault_root(dir)?;
            unreachable!("inspect_vault_root_at reported Unreadable");
        }
        NearbyVaultRootStatus::Incomplete => {
            let Some(policy) = replace else {
                validate_existing_vault_root(dir)?;
                unreachable!("inspect_vault_root_at reported Incomplete");
            };
            let upriv = dir.join(".upriv");
            if upriv.exists() {
                match policy {
                    IncompleteReplacePolicy::Delete => {
                        // Refuse to recursively delete if `.upriv` or any entry under it
                        // is a symlink (could escape the vault-root). Prefer Rename.
                        // `workspace/` is intentionally left in place — only the broken
                        // `.upriv/` tree is removed when safe.
                        refuse_delete_if_symlinks_under(&upriv)?;
                        std::fs::remove_dir_all(&upriv)?;
                    }
                    IncompleteReplacePolicy::Rename => {
                        rename_incomplete_upriv(&upriv)?;
                    }
                }
            }
            initialize_vault_root(dir)
        }
    }
}

/// Walk `upriv` with `symlink_metadata` (do not follow links). Refuse Delete when
/// `.upriv` itself or any nested entry is a symlink — use Rename instead.
fn refuse_delete_if_symlinks_under(upriv: &Path) -> Result<()> {
    let meta = std::fs::symlink_metadata(upriv).map_err(UprivError::from)?;
    if meta.file_type().is_symlink() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "refusing to delete .upriv: path is a symbolic link (use Rename)",
        )));
    }
    if !meta.is_dir() {
        return Ok(());
    }
    walk_refuse_symlinks(upriv)
}

fn walk_refuse_symlinks(dir: &Path) -> Result<()> {
    let entries = std::fs::read_dir(dir)?;
    for entry in entries {
        let entry = entry.map_err(UprivError::from)?;
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(UprivError::from)?;
        if meta.file_type().is_symlink() {
            return Err(UprivError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "refusing to delete .upriv: tree contains a symbolic link (use Rename)",
            )));
        }
        if meta.is_dir() {
            walk_refuse_symlinks(&path)?;
        }
    }
    Ok(())
}

/// Rename `.upriv` → `.upriv-invalidated-<stamp>`; if that name exists, append `-<stamp>` again.
pub fn rename_incomplete_upriv(upriv: &Path) -> Result<PathBuf> {
    let parent = upriv.parent().ok_or_else(|| {
        UprivError::Io(std::io::Error::other(
            "incomplete .upriv has no parent directory",
        ))
    })?;
    let stamp = utc_filename_stamp();
    let mut name = format!(".upriv-invalidated-{stamp}");
    let mut dest = parent.join(&name);
    while dest.exists() {
        name = format!("{name}-{stamp}");
        dest = parent.join(&name);
    }
    match std::fs::rename(upriv, &dest) {
        Ok(()) => Ok(dest),
        Err(error)
            if error.kind() == std::io::ErrorKind::CrossesDevices
                || error.raw_os_error() == Some(18) =>
        {
            // EXDEV — rename across filesystems is not supported for Incomplete repair.
            Err(UprivError::Io(std::io::Error::new(
                std::io::ErrorKind::CrossesDevices,
                "cannot rename incomplete .upriv across filesystems; use Delete policy instead",
            )))
        }
        Err(error) => Err(error.into()),
    }
}

/// Create the standard Upriv layout in `dir` and return the opened [`VaultRoot`].
///
/// Prefer [`open_or_initialize_vault_root`] for user-chosen folders. This helper
/// always creates missing dirs; it only writes `settings.toml` when absent.
pub fn initialize_vault_root(dir: impl AsRef<Path>) -> Result<VaultRoot> {
    let dir = dir.as_ref();
    std::fs::create_dir_all(dir)?;

    let settings_path = dir.join(VAULT_ROOT_SETTINGS_REL);
    if !settings_path.is_file() {
        crate::paths::write_bytes_atomic(&settings_path, DEFAULT_SETTINGS_TOML.as_bytes())?;
    }

    ensure_standard_dirs(dir)?;
    VaultRoot::discover(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{is_vault_root_marker, VaultRoot};

    #[test]
    fn initialize_creates_marker_and_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root(dir.path()).unwrap();
        assert!(is_vault_root_marker(root.root()));
        assert!(root.vaults_dir().is_dir());
        assert!(root.workspace_dir().is_dir());
        assert!(root.logs_dir().is_dir());
    }

    #[test]
    fn initialize_does_not_overwrite_settings() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            "[package]\nversion = 1\nvaults_dir = \".upriv/vaults\"\n",
        )
        .unwrap();
        let _ = initialize_vault_root(dir.path()).unwrap();
        let raw = std::fs::read_to_string(&settings).unwrap();
        assert!(raw.contains("vaults_dir"));
        assert!(!raw.contains("label = \"Upriv\""));
    }

    #[test]
    fn open_existing_does_not_recreate() {
        let dir = tempfile::tempdir().unwrap();
        let first = initialize_vault_root(dir.path()).unwrap();
        let settings = first.settings_path();
        let before = std::fs::read_to_string(&settings).unwrap();
        std::fs::write(&settings, format!("{before}\n# kept\n")).unwrap();

        let again = open_or_initialize_vault_root(dir.path()).unwrap();
        let after = std::fs::read_to_string(again.settings_path()).unwrap();
        assert!(after.contains("# kept"));
    }

    #[test]
    fn incomplete_upriv_errors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let err = open_or_initialize_vault_root(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn empty_settings_errors() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(&settings, "   \n").unwrap();
        let err = validate_existing_vault_root(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn corrupt_toml_settings_are_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            r#"
[package]
version =a broken
vaults_dir = ".upriv/vaults"
"#,
        )
        .unwrap();
        let err = validate_existing_vault_root(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
        assert_eq!(
            inspect_vault_root_at(dir.path()),
            NearbyVaultRootStatus::Incomplete
        );
        assert!(VaultRoot::discover(dir.path()).is_err());
    }

    #[test]
    fn comment_only_markers_do_not_validate() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            "# [package]\n# vaults_dir = \".upriv/vaults\"\n[ui]\nlocale = \"en\"\n",
        )
        .unwrap();
        let err = validate_existing_vault_root(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn inspect_absent_valid_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            inspect_vault_root_at(dir.path()),
            NearbyVaultRootStatus::Absent
        );
        initialize_vault_root(dir.path()).unwrap();
        assert_eq!(
            inspect_vault_root_at(dir.path()),
            NearbyVaultRootStatus::Valid
        );

        let broken = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(broken.path().join(".upriv")).unwrap();
        assert_eq!(
            inspect_vault_root_at(broken.path()),
            NearbyVaultRootStatus::Incomplete
        );
    }

    #[test]
    fn replace_incomplete_options_renames_and_recreates() {
        let dir = tempfile::tempdir().unwrap();
        let upriv = dir.path().join(".upriv");
        std::fs::create_dir_all(&upriv).unwrap();
        std::fs::write(upriv.join("keep-me.txt"), b"data").unwrap();
        assert!(matches!(
            open_or_initialize_vault_root(dir.path()).unwrap_err(),
            UprivError::VaultRootIncomplete { .. }
        ));
        // `with_options(true)` → Rename (safer than Delete).
        let root = open_or_initialize_vault_root_with_options(dir.path(), true).unwrap();
        assert!(is_vault_root_marker(root.root()));
        assert!(root.settings_path().is_file());
        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".upriv-invalidated-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(dir.path().join(&backups[0]).join("keep-me.txt").is_file());
    }

    #[test]
    fn replace_incomplete_delete_refuses_inner_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let upriv = dir.path().join(".upriv");
        std::fs::create_dir_all(&upriv).unwrap();
        let outside = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.path(), upriv.join("escape")).unwrap();
            let err = open_or_initialize_vault_root_with_policy(
                dir.path(),
                Some(IncompleteReplacePolicy::Delete),
            )
            .unwrap_err();
            assert!(matches!(err, UprivError::Io(_)));
            assert!(upriv.exists());
            // Rename still works.
            let root = open_or_initialize_vault_root_with_policy(
                dir.path(),
                Some(IncompleteReplacePolicy::Rename),
            )
            .unwrap();
            assert!(is_vault_root_marker(root.root()));
        }
        #[cfg(not(unix))]
        {
            let _ = (upriv, outside);
        }
    }

    #[test]
    fn replace_incomplete_delete_removes_and_recreates() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let root = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::Delete),
        )
        .unwrap();
        assert!(is_vault_root_marker(root.root()));
        assert!(root.settings_path().is_file());
        assert!(!dir.path().join(".upriv-invalidated").exists());
        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".upriv-invalidated-"))
            .collect();
        assert!(backups.is_empty());
    }

    #[test]
    fn replace_incomplete_rename_keeps_old_tree() {
        let dir = tempfile::tempdir().unwrap();
        let upriv = dir.path().join(".upriv");
        std::fs::create_dir_all(&upriv).unwrap();
        std::fs::write(upriv.join("keep-me.txt"), b"data").unwrap();
        let root = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::Rename),
        )
        .unwrap();
        assert!(is_vault_root_marker(root.root()));
        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".upriv-invalidated-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(dir.path().join(&backups[0]).join("keep-me.txt").is_file());
    }
}
