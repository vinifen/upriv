//! Create / open a vault-root layout (marker + empty dirs).

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};
use crate::paths::{VaultRoot, VAULT_ROOT_SETTINGS_REL};
use crate::time::utc_filename_stamp;

/// Default `.upriv/settings.toml` for a newly initialized root.
///
/// `[ui].locale` is `"en"` here; callers that need a different UI locale should
/// use [`initialize_vault_root_with_bootstrap`] (or the
/// `_with_policy_and_bootstrap` entry point) so the correct locale is written
/// **in the same file write** — no separate post-create stamp is needed.
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
keep_last_entries = 10000

[app]
# Vault-root mode (`default_root` vs `custom_root`) is NOT configured in this file.
# It lives in the app-home `.upriv-root` alias:
#   missing or status=inactive → default_root mode
#   status=active + path → custom_root
"#;

/// Bootstrap UI prefs applied only when creating a new `.upriv/` (absent init or
/// incomplete→replace init). Never applied when opening an already-valid root.
///
/// Today only carries `locale`. Extend this bag with future pre-root UI prefs
/// (theme selector on Gate, high-contrast, etc.) without renaming the setup APIs
/// again — the wire and API shape stay the same.
///
/// See AGENT.md § "Selecting an existing `.upriv`" — selecting a Valid existing
/// root must not rewrite its `settings.toml`, so `VaultRootBootstrapPrefs` are
/// silently ignored on that path.
#[derive(Debug, Clone, Default)]
pub struct VaultRootBootstrapPrefs {
    /// UI locale (`en` | `pt-BR` | `es`). `None` / empty / whitespace-only →
    /// keep the built-in `"en"` default when writing `settings.toml` on create.
    pub locale: Option<String>,
}

/// Build the initial `.upriv/settings.toml` body from bootstrap prefs.
///
/// Currently only `[ui].locale` is customized — `None` / empty / whitespace-only
/// falls back to the built-in `"en"` default. Rejects locale strings that would
/// break the TOML literal (quote, backslash, newline, control chars) so a
/// malformed locale cannot corrupt the marker file.
fn initial_settings_toml_for(prefs: Option<&VaultRootBootstrapPrefs>) -> Result<Vec<u8>> {
    let locale = prefs.and_then(|p| p.locale.as_deref());
    let effective = locale
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("en");
    if effective
        .chars()
        .any(|c| c == '"' || c == '\\' || c.is_control())
    {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "locale contains characters not allowed in settings.toml",
        )));
    }
    if effective == "en" {
        return Ok(DEFAULT_SETTINGS_TOML.as_bytes().to_vec());
    }
    Ok(DEFAULT_SETTINGS_TOML
        .replace("locale = \"en\"", &format!("locale = \"{effective}\""))
        .into_bytes())
}

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
pub enum VaultRootDirStatus {
    /// No `.upriv` directory.
    Absent,
    /// Marker + required settings present.
    Valid,
    /// `.upriv` exists but is missing/corrupt required files.
    Incomplete,
    /// `.upriv` exists but could not be read (I/O) — not the same as incomplete content.
    Unreadable,
}

/// Inspect whether `dir` already has a usable default_root vault-root.
pub fn inspect_vault_root_at(dir: impl AsRef<Path>) -> VaultRootDirStatus {
    let dir = dir.as_ref();
    let upriv = dir.join(".upriv");
    if !upriv.exists() {
        return VaultRootDirStatus::Absent;
    }
    match validate_existing_vault_root(dir) {
        Ok(()) => VaultRootDirStatus::Valid,
        Err(UprivError::Io(_)) => VaultRootDirStatus::Unreadable,
        Err(_) => VaultRootDirStatus::Incomplete,
    }
}

/// How to dispose of a broken default_root `.upriv/` before creating a fresh one.
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
    Ok(open_or_initialize_vault_root_with_policy(
        dir,
        if replace_incomplete {
            Some(IncompleteReplacePolicy::Rename)
        } else {
            None
        },
    )?
    .root)
}

/// Result of [`open_or_initialize_vault_root_with_policy`].
#[derive(Debug)]
pub struct OpenedVaultRoot {
    pub root: VaultRoot,
    /// True when this call created a new `.upriv/` (absent init or incomplete→replace).
    pub created: bool,
}

/// Open / create vault-root. When `.upriv` is incomplete, `replace` selects dispose policy
/// (`None` → [`UprivError::VaultRootIncomplete`]).
///
/// `created` is authoritative for bootstrap stamp (avoids TOCTOU vs a prior inspect).
///
/// Equivalent to [`open_or_initialize_vault_root_with_policy_and_bootstrap`] with
/// `prefs = None` (the default `"en"` locale is written on create).
pub fn open_or_initialize_vault_root_with_policy(
    dir: impl AsRef<Path>,
    replace: Option<IncompleteReplacePolicy>,
) -> Result<OpenedVaultRoot> {
    open_or_initialize_vault_root_with_policy_and_bootstrap(dir, replace, None)
}

/// Like [`open_or_initialize_vault_root_with_policy`], but seeds the initial
/// `.upriv/settings.toml` from [`VaultRootBootstrapPrefs`] when creating (absent
/// init or incomplete→replace init).
///
/// - Valid existing root → `created = false`; `prefs` is ignored and
///   `settings.toml` is **not** rewritten (AGENT.md contract — selecting an
///   existing `.upriv` must not clobber its UI prefs).
/// - Absent / Incomplete→replace → `created = true`; prefs (trimmed, non-empty
///   locale today) are written atomically as part of the initial settings.toml
///   — no separate post-create stamp is required, so a partial stamp failure
///   cannot leave a fresh root stuck on the built-in defaults.
pub fn open_or_initialize_vault_root_with_policy_and_bootstrap(
    dir: impl AsRef<Path>,
    replace: Option<IncompleteReplacePolicy>,
    prefs: Option<&VaultRootBootstrapPrefs>,
) -> Result<OpenedVaultRoot> {
    let dir = dir.as_ref();

    match inspect_vault_root_at(dir) {
        VaultRootDirStatus::Valid => {
            ensure_standard_dirs(dir)?;
            Ok(OpenedVaultRoot {
                root: VaultRoot::discover(dir)?,
                created: false,
            })
        }
        VaultRootDirStatus::Absent => Ok(OpenedVaultRoot {
            root: initialize_vault_root_with_bootstrap(dir, prefs)?,
            created: true,
        }),
        VaultRootDirStatus::Unreadable => {
            // Surface the underlying I/O error (do not offer replace as if corrupt).
            validate_existing_vault_root(dir)?;
            unreachable!("inspect_vault_root_at reported Unreadable");
        }
        VaultRootDirStatus::Incomplete => {
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
            Ok(OpenedVaultRoot {
                root: initialize_vault_root_with_bootstrap(dir, prefs)?,
                created: true,
            })
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
///
/// Equivalent to [`initialize_vault_root_with_bootstrap`] with `prefs = None`
/// (the default `"en"` locale is used when writing settings.toml).
pub fn initialize_vault_root(dir: impl AsRef<Path>) -> Result<VaultRoot> {
    initialize_vault_root_with_bootstrap(dir, None)
}

/// Create the standard Upriv layout in `dir` and return the opened [`VaultRoot`].
///
/// When `settings.toml` does not yet exist, it is written from the given
/// bootstrap [`VaultRootBootstrapPrefs`] (today `[ui].locale`, or `"en"` when
/// `prefs`/`locale` is `None`/empty). When `settings.toml` already exists it is
/// **not** touched — preserving user prefs on repeat `initialize_*` calls
/// (test-only path; the setup RPCs go through
/// [`open_or_initialize_vault_root_with_policy_and_bootstrap`], which never
/// writes over a Valid `.upriv`).
pub fn initialize_vault_root_with_bootstrap(
    dir: impl AsRef<Path>,
    prefs: Option<&VaultRootBootstrapPrefs>,
) -> Result<VaultRoot> {
    let dir = dir.as_ref();
    std::fs::create_dir_all(dir)?;

    let settings_path = dir.join(VAULT_ROOT_SETTINGS_REL);
    if !settings_path.is_file() {
        let bytes = initial_settings_toml_for(prefs)?;
        crate::paths::write_bytes_atomic(&settings_path, &bytes)?;
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
            VaultRootDirStatus::Incomplete
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
            VaultRootDirStatus::Absent
        );
        initialize_vault_root(dir.path()).unwrap();
        assert_eq!(inspect_vault_root_at(dir.path()), VaultRootDirStatus::Valid);

        let broken = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(broken.path().join(".upriv")).unwrap();
        assert_eq!(
            inspect_vault_root_at(broken.path()),
            VaultRootDirStatus::Incomplete
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
            .unwrap()
            .root;
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
        let opened = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::Delete),
        )
        .unwrap();
        assert!(opened.created);
        let root = opened.root;
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
        let opened = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::Rename),
        )
        .unwrap();
        assert!(opened.created);
        let root = opened.root;
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

    #[test]
    fn open_valid_root_reports_not_created() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root(dir.path()).unwrap();
        assert!(is_vault_root_marker(root.root()));
        let opened = open_or_initialize_vault_root_with_policy(dir.path(), None).unwrap();
        assert!(!opened.created);
        assert!(is_vault_root_marker(opened.root.root()));
    }

    #[test]
    fn open_absent_reports_created() {
        let dir = tempfile::tempdir().unwrap();
        let opened = open_or_initialize_vault_root_with_policy(dir.path(), None).unwrap();
        assert!(opened.created);
        assert!(is_vault_root_marker(opened.root.root()));
    }

    fn bootstrap_locale(locale: &str) -> VaultRootBootstrapPrefs {
        VaultRootBootstrapPrefs {
            locale: Some(locale.to_string()),
        }
    }

    #[test]
    fn initialize_with_bootstrap_writes_ui_locale() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = bootstrap_locale("pt-BR");
        let root = initialize_vault_root_with_bootstrap(dir.path(), Some(&prefs)).unwrap();
        let raw = std::fs::read_to_string(root.settings_path()).unwrap();
        assert!(
            raw.contains("locale = \"pt-BR\""),
            "expected initial settings.toml to carry pt-BR, got:\n{raw}"
        );
        assert!(!raw.contains("locale = \"en\""));
    }

    #[test]
    fn initialize_with_bootstrap_defaults_to_en_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root_with_bootstrap(dir.path(), None).unwrap();
        let raw = std::fs::read_to_string(root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"en\""));

        let other = tempfile::tempdir().unwrap();
        let prefs = bootstrap_locale("   ");
        let root = initialize_vault_root_with_bootstrap(other.path(), Some(&prefs)).unwrap();
        let raw = std::fs::read_to_string(root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"en\""));

        let empty = tempfile::tempdir().unwrap();
        let default_prefs = VaultRootBootstrapPrefs::default();
        let root =
            initialize_vault_root_with_bootstrap(empty.path(), Some(&default_prefs)).unwrap();
        let raw = std::fs::read_to_string(root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"en\""));
    }

    #[test]
    fn initialize_with_bootstrap_rejects_unsafe_locale() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = bootstrap_locale("en\"; rogue = \"x");
        let err = initialize_vault_root_with_bootstrap(dir.path(), Some(&prefs)).unwrap_err();
        assert!(matches!(err, UprivError::Io(_)));
        // Settings must not be written when locale validation fails.
        assert!(!dir.path().join(".upriv/settings.toml").is_file());
    }

    #[test]
    fn open_absent_with_bootstrap_stamps_at_creation() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = bootstrap_locale("pt-BR");
        let opened =
            open_or_initialize_vault_root_with_policy_and_bootstrap(dir.path(), None, Some(&prefs))
                .unwrap();
        assert!(opened.created);
        let raw = std::fs::read_to_string(opened.root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"pt-BR\""));
    }

    #[test]
    fn open_valid_root_with_bootstrap_does_not_rewrite_settings() {
        // AGENT.md contract: selecting an existing valid `.upriv` must not touch
        // that folder's settings.toml (no bootstrap re-stamp on `created = false`).
        let dir = tempfile::tempdir().unwrap();
        // Seed as `en` (default), then observe that re-opening with pt-BR does not rewrite.
        initialize_vault_root(dir.path()).unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        let before = std::fs::read_to_string(&settings).unwrap();

        let prefs = bootstrap_locale("pt-BR");
        let opened =
            open_or_initialize_vault_root_with_policy_and_bootstrap(dir.path(), None, Some(&prefs))
                .unwrap();
        assert!(!opened.created);
        let after = std::fs::read_to_string(&settings).unwrap();
        assert_eq!(before, after);
        assert!(after.contains("locale = \"en\""));
    }

    #[test]
    fn incomplete_replace_with_bootstrap_stamps_fresh_layout() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let prefs = bootstrap_locale("es");
        let opened = open_or_initialize_vault_root_with_policy_and_bootstrap(
            dir.path(),
            Some(IncompleteReplacePolicy::Rename),
            Some(&prefs),
        )
        .unwrap();
        assert!(opened.created);
        let raw = std::fs::read_to_string(opened.root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"es\""));
    }
}
