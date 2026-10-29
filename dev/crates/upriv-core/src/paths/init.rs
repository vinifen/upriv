//! Create / open a vault-root layout (marker + empty dirs).

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::path::{Path, PathBuf};

use crate::config::{parse_settings_toml_str, serialize_settings_toml_str, AppSettings};
use crate::error::{Result, UprivError};
use crate::paths::{VaultRoot, VAULT_ROOT_SETTINGS_REL};
use crate::time::utc_filename_stamp;

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
    let effective_locale = locale
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("en")
        .to_string();
    let mut settings = AppSettings::default();
    settings.ui.locale = effective_locale;
    serialize_settings_toml_str(&settings).map(String::into_bytes)
}

/// Kind of `path` after following a symlink, `None` when it does not exist.
/// Any other failure stays an I/O error so an unreachable folder is not read
/// as a missing one.
fn entry_kind_or_absent(path: &Path) -> Result<Option<crate::host_fs::EntryKind>> {
    use crate::host_fs::EntryKind;

    let absent = |error: &std::io::Error| error.kind() == std::io::ErrorKind::NotFound;
    match crate::host_fs::entry_kind(path) {
        Ok(EntryKind::Symlink) => match crate::host_fs::metadata(path) {
            Ok(meta) if meta.is_dir() => Ok(Some(EntryKind::Dir)),
            Ok(meta) if meta.is_file() => Ok(Some(EntryKind::File)),
            Ok(_) => Ok(Some(EntryKind::Symlink)),
            Err(error) if absent(&error) => Ok(None),
            Err(error) => Err(error.into()),
        },
        Ok(kind) => Ok(Some(kind)),
        Err(error) if absent(&error) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Validate an existing `.upriv/` tree. Does not create or overwrite files.
///
/// Fails when `.upriv` exists but required pieces are missing/corrupt so callers
/// can alert the user instead of silently rewriting settings.
pub fn validate_existing_vault_root(dir: impl AsRef<Path>) -> Result<()> {
    use crate::host_fs::EntryKind;

    let dir = dir.as_ref();
    let upriv = dir.join(".upriv");
    match entry_kind_or_absent(&upriv)? {
        None => {
            return Err(UprivError::VaultRootNotFound(
                dir.join(VAULT_ROOT_SETTINGS_REL),
            ))
        }
        Some(EntryKind::Dir) => {}
        Some(_) => {
            return Err(UprivError::VaultRootIncomplete {
                path: upriv,
                detail: ".upriv exists but is not a directory".into(),
            })
        }
    }

    let settings = dir.join(VAULT_ROOT_SETTINGS_REL);
    if entry_kind_or_absent(&settings)? != Some(EntryKind::File) {
        return Err(UprivError::VaultRootIncomplete {
            path: settings,
            detail: "missing .upriv/settings.toml".into(),
        });
    }

    let raw = crate::host_fs::read_to_string(&settings).map_err(UprivError::from)?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(UprivError::VaultRootIncomplete {
            path: settings,
            detail: ".upriv/settings.toml is empty".into(),
        });
    }

    // The same parse as a settings load: `[package] version = 1` and a readable schema.
    match parse_settings_toml_str(trimmed) {
        Ok(_) => Ok(()),
        Err(UprivError::VaultRootIncomplete { detail, .. }) => {
            Err(UprivError::VaultRootIncomplete {
                path: settings,
                detail,
            })
        }
        Err(error) => Err(error),
    }
}

fn ensure_standard_dirs(dir: &Path) -> Result<()> {
    // Do not create `workspace/` here — mount parent is user-configured
    // (`[workspace].path`) and must not appear as an unexplained folder.
    for relative in [
        ".upriv/vaults",
        ".upriv/logs",
        ".upriv/app",
        ".upriv/runtime",
    ] {
        crate::host_fs::create_dir_all(dir.join(relative))?;
    }
    Ok(())
}

/// Open an existing vault-root or create a fresh default layout.
///
/// - Valid marker + settings → open as-is (never overwrite `settings.toml`)
/// - `.upriv` present but incomplete → [`UprivError::VaultRootIncomplete`]
///   (`replace = None`)
/// - No `.upriv` → create default structure
pub fn open_or_initialize_vault_root(
    dir: impl AsRef<Path>,
    replace: Option<IncompleteReplacePolicy>,
    prefs: Option<&VaultRootBootstrapPrefs>,
) -> Result<OpenedVaultRoot> {
    open_or_initialize_vault_root_impl(dir, replace, prefs)
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
    match validate_existing_vault_root(dir) {
        Ok(()) => VaultRootDirStatus::Valid,
        Err(UprivError::VaultRootNotFound(_)) => VaultRootDirStatus::Absent,
        Err(UprivError::Io(_)) => VaultRootDirStatus::Unreadable,
        Err(_) => VaultRootDirStatus::Incomplete,
    }
}

/// How to handle a broken `.upriv/` (its `settings.toml` is missing or unreadable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncompleteReplacePolicy {
    /// Keep everything under `.upriv/` (vaults, backups, logs, groups) and
    /// write a fresh `settings.toml`. App settings go back to defaults.
    ResetSettings,
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
#[cfg(test)]
pub(crate) fn open_or_initialize_vault_root_with_options(
    dir: impl AsRef<Path>,
    replace_incomplete: bool,
) -> Result<OpenedVaultRoot> {
    open_or_initialize_vault_root_with_policy(
        dir,
        if replace_incomplete {
            Some(IncompleteReplacePolicy::Rename)
        } else {
            None
        },
    )
}

/// Result of [`open_or_initialize_vault_root_with_policy`].
#[derive(Debug)]
pub struct OpenedVaultRoot {
    pub root: VaultRoot,
    /// True when this call created a new `.upriv/` (absent init, or incomplete
    /// renamed / deleted). Reset settings keeps the existing `.upriv/`: false.
    pub created: bool,
}

/// Open / create vault-root. When `.upriv` is incomplete, `replace` selects dispose policy
/// (`None` → [`UprivError::VaultRootIncomplete`]).
///
/// `created` is authoritative for bootstrap stamp (avoids TOCTOU vs a prior inspect).
///
/// Equivalent to [`open_or_initialize_vault_root_with_policy_and_bootstrap`] with
/// `prefs = None` (the default `"en"` locale is written on create).
#[cfg(test)]
pub(crate) fn open_or_initialize_vault_root_with_policy(
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
/// - Absent / Incomplete→rename or delete → `created = true`; prefs (trimmed,
///   non-empty locale today) are written atomically as part of the initial
///   settings.toml — no separate post-create stamp is required, so a partial
///   stamp failure cannot leave a fresh root stuck on the built-in defaults.
/// - Incomplete→reset settings → `created = false`; the same prefs seed the
///   rewritten settings.toml and the rest of `.upriv/` is kept.
#[cfg(test)]
pub(crate) fn open_or_initialize_vault_root_with_policy_and_bootstrap(
    dir: impl AsRef<Path>,
    replace: Option<IncompleteReplacePolicy>,
    prefs: Option<&VaultRootBootstrapPrefs>,
) -> Result<OpenedVaultRoot> {
    open_or_initialize_vault_root_impl(dir, replace, prefs)
}

fn open_or_initialize_vault_root_impl(
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
            // `inspect` and `validate` are separate disk reads — a transient I/O
            // error can clear between them. Ask the caller to retry.
            Err(UprivError::Io(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "vault-root state changed during setup; retry",
            )))
        }
        VaultRootDirStatus::Incomplete => {
            let policy = match replace {
                Some(policy) => policy,
                None => {
                    validate_existing_vault_root(dir)?;
                    return Err(UprivError::Io(std::io::Error::new(
                        std::io::ErrorKind::Interrupted,
                        "vault-root state changed during setup; retry",
                    )));
                }
            };
            let upriv = dir.join(".upriv");
            match policy {
                IncompleteReplacePolicy::ResetSettings => {
                    return Ok(OpenedVaultRoot {
                        root: reset_settings_in_place(dir, prefs)?,
                        created: false,
                    });
                }
                IncompleteReplacePolicy::Delete if upriv.host_exists() => {
                    // Refuse to recursively delete if `.upriv` or any entry under it
                    // is a symlink (could escape the vault-root). Prefer Rename.
                    // `workspace/` is intentionally left in place — only the broken
                    // `.upriv/` tree is removed when safe. A file named `.upriv`
                    // is not a tree; remove that file so Repair can recreate it.
                    let meta =
                        crate::host_fs::symlink_metadata(&upriv).map_err(UprivError::from)?;
                    if meta.file_type().is_symlink() {
                        return Err(UprivError::Io(std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            "refusing to delete a symlinked .upriv; use Rename",
                        )));
                    }
                    if meta.is_file() {
                        crate::host_fs::remove_file(&upriv)?;
                    } else {
                        refuse_delete_if_symlinks_under(&upriv)?;
                        crate::host_fs::remove_dir_all(&upriv)?;
                    }
                }
                IncompleteReplacePolicy::Rename if upriv.host_exists() => {
                    rename_incomplete_upriv(&upriv)?;
                }
                IncompleteReplacePolicy::Delete | IncompleteReplacePolicy::Rename => {}
            }
            Ok(OpenedVaultRoot {
                root: initialize_vault_root_with_bootstrap(dir, prefs)?,
                created: true,
            })
        }
    }
}

/// Write a fresh `settings.toml` into an existing `.upriv/` directory and keep
/// everything else in it. Refuses when `.upriv` is not a directory.
fn reset_settings_in_place(
    dir: &Path,
    prefs: Option<&VaultRootBootstrapPrefs>,
) -> Result<VaultRoot> {
    let upriv = dir.join(".upriv");
    if entry_kind_or_absent(&upriv)? != Some(crate::host_fs::EntryKind::Dir) {
        return Err(UprivError::VaultRootIncomplete {
            path: upriv,
            detail: ".upriv is not a directory; rename or delete it instead".into(),
        });
    }
    let bytes = initial_settings_toml_for(prefs)?;
    crate::paths::write_bytes_atomic_existing_parent(&dir.join(VAULT_ROOT_SETTINGS_REL), &bytes)?;
    ensure_standard_dirs(dir)?;
    VaultRoot::discover(dir)
}

/// Walk `upriv` with `symlink_metadata` (do not follow links). Refuse Delete when
/// `.upriv` itself or any nested entry is a symlink — use Rename instead.
fn refuse_delete_if_symlinks_under(upriv: &Path) -> Result<()> {
    let meta = crate::host_fs::symlink_metadata(upriv).map_err(UprivError::from)?;
    if meta.file_type().is_symlink() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "refusing to delete .upriv: path is a symbolic link (use Rename)",
        )));
    }
    if !meta.host_is_dir() {
        return Ok(());
    }
    walk_refuse_symlinks(upriv)
}

fn walk_refuse_symlinks(dir: &Path) -> Result<()> {
    let entries = crate::host_fs::read_dir(dir)?;
    for entry in entries {
        let entry = entry.map_err(UprivError::from)?;
        let path = entry.path();
        let meta = crate::host_fs::symlink_metadata(&path).map_err(UprivError::from)?;
        if meta.file_type().is_symlink() {
            return Err(UprivError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "refusing to delete .upriv: tree contains a symbolic link (use Rename)",
            )));
        }
        if meta.host_is_dir() {
            walk_refuse_symlinks(&path)?;
        }
    }
    Ok(())
}

/// Rename `.upriv` → `.upriv-invalidated-<stamp>`; on collision append `-<n>`.
pub fn rename_incomplete_upriv(upriv: &Path) -> Result<PathBuf> {
    let parent = upriv.parent().ok_or_else(|| {
        UprivError::Io(std::io::Error::other(
            "incomplete .upriv has no parent directory",
        ))
    })?;
    let stamp = utc_filename_stamp();
    let mut dest = parent.join(format!(".upriv-invalidated-{stamp}"));
    let mut n = 2;
    while dest.host_exists() {
        dest = parent.join(format!(".upriv-invalidated-{stamp}-{n}"));
        n += 1;
    }
    match crate::host_fs::rename(upriv, &dest) {
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
    crate::host_fs::create_dir_all(dir)?;

    let settings_path = dir.join(VAULT_ROOT_SETTINGS_REL);
    if !settings_path.host_is_file() {
        let bytes = initial_settings_toml_for(prefs)?;
        crate::paths::write_bytes_atomic(&settings_path, &bytes)?;
    }

    ensure_standard_dirs(dir)?;
    VaultRoot::discover(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::paths::{is_vault_root_marker, VaultRoot};

    #[test]
    fn initialize_creates_marker_and_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root(dir.path()).unwrap();
        assert!(is_vault_root_marker(root.root()));
        assert!(root.vaults_dir().host_is_dir());
        assert!(!root.root().join("workspace").host_is_dir());
        assert!(root.logs_dir().host_is_dir());
        let settings = crate::host_fs::read_to_string(root.settings_path()).unwrap();
        assert!(
            settings.contains("[workspace.linux]"),
            "initial settings.toml must include per-system workspace rows, got:\n{settings}"
        );
    }

    #[test]
    fn initialize_does_not_overwrite_settings() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        crate::host_fs::create_dir_all(settings.parent().unwrap()).unwrap();
        crate::host_fs::write(&settings, "[package]\nversion = 1\n[ui]\nlocale = \"es\"\n")
            .unwrap();
        let _ = initialize_vault_root(dir.path()).unwrap();
        let raw = crate::host_fs::read_to_string(&settings).unwrap();
        assert_eq!(raw, "[package]\nversion = 1\n[ui]\nlocale = \"es\"\n");
    }

    #[test]
    fn open_existing_does_not_recreate() {
        let dir = tempfile::tempdir().unwrap();
        let first = initialize_vault_root(dir.path()).unwrap();
        let settings = first.settings_path();
        let before = crate::host_fs::read_to_string(&settings).unwrap();
        crate::host_fs::write(&settings, format!("{before}\n# kept\n")).unwrap();

        let again = open_or_initialize_vault_root(dir.path(), None, None).unwrap();
        let after = crate::host_fs::read_to_string(again.root.settings_path()).unwrap();
        assert!(after.contains("# kept"));
    }

    #[test]
    fn incomplete_upriv_errors() {
        let dir = tempfile::tempdir().unwrap();
        crate::host_fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let err = open_or_initialize_vault_root(dir.path(), None, None).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn empty_settings_errors() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        crate::host_fs::create_dir_all(settings.parent().unwrap()).unwrap();
        crate::host_fs::write(&settings, "   \n").unwrap();
        let err = validate_existing_vault_root(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn corrupt_toml_settings_are_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join(".upriv/settings.toml");
        crate::host_fs::create_dir_all(settings.parent().unwrap()).unwrap();
        crate::host_fs::write(
            &settings,
            r#"
[package]
version =a broken
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
        crate::host_fs::create_dir_all(settings.parent().unwrap()).unwrap();
        crate::host_fs::write(
            &settings,
            "# [package]\n# version = 1\n[ui]\nlocale = \"en\"\n",
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
        crate::host_fs::create_dir_all(broken.path().join(".upriv")).unwrap();
        assert_eq!(
            inspect_vault_root_at(broken.path()),
            VaultRootDirStatus::Incomplete
        );
    }

    #[test]
    fn replace_incomplete_options_renames_and_recreates() {
        let dir = tempfile::tempdir().unwrap();
        let upriv = dir.path().join(".upriv");
        crate::host_fs::create_dir_all(&upriv).unwrap();
        crate::host_fs::write(upriv.join("keep-me.txt"), b"data").unwrap();
        assert!(matches!(
            open_or_initialize_vault_root(dir.path(), None, None).unwrap_err(),
            UprivError::VaultRootIncomplete { .. }
        ));
        // `with_options(true)` → Rename (safer than Delete).
        let opened = open_or_initialize_vault_root_with_options(dir.path(), true).unwrap();
        assert!(is_vault_root_marker(opened.root.root()));
        assert!(opened.root.settings_path().host_is_file());
        let backups: Vec<_> = crate::host_fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".upriv-invalidated-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(dir
            .path()
            .join(&backups[0])
            .join("keep-me.txt")
            .host_is_file());
    }

    #[test]
    fn replace_incomplete_delete_refuses_inner_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let upriv = dir.path().join(".upriv");
        crate::host_fs::create_dir_all(&upriv).unwrap();
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
            assert!(upriv.host_exists());
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
    fn replace_incomplete_delete_removes_a_file_named_upriv() {
        let dir = tempfile::tempdir().unwrap();
        crate::host_fs::write(dir.path().join(".upriv"), b"not a directory").unwrap();
        let opened = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::Delete),
        )
        .unwrap();
        assert!(opened.created);
        assert!(dir.path().join(".upriv").host_is_dir());
        assert!(opened.root.settings_path().host_is_file());
    }

    #[test]
    fn replace_incomplete_delete_removes_and_recreates() {
        let dir = tempfile::tempdir().unwrap();
        crate::host_fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let opened = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::Delete),
        )
        .unwrap();
        assert!(opened.created);
        let root = opened.root;
        assert!(is_vault_root_marker(root.root()));
        assert!(root.settings_path().host_is_file());
        assert!(!dir.path().join(".upriv-invalidated").host_exists());
        let backups: Vec<_> = crate::host_fs::read_dir(dir.path())
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
        crate::host_fs::create_dir_all(&upriv).unwrap();
        crate::host_fs::write(upriv.join("keep-me.txt"), b"data").unwrap();
        let opened = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::Rename),
        )
        .unwrap();
        assert!(opened.created);
        let root = opened.root;
        assert!(is_vault_root_marker(root.root()));
        let backups: Vec<_> = crate::host_fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(".upriv-invalidated-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(dir
            .path()
            .join(&backups[0])
            .join("keep-me.txt")
            .host_is_file());
    }

    #[test]
    fn rename_incomplete_uses_incrementing_suffix_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let upriv = dir.path().join(".upriv");
        crate::host_fs::create_dir_all(&upriv).unwrap();
        crate::host_fs::write(upriv.join("marker"), "x").unwrap();
        let stamp = crate::time::utc_filename_stamp();
        let first = dir.path().join(format!(".upriv-invalidated-{stamp}"));
        crate::host_fs::create_dir_all(&first).unwrap();

        let dest = rename_incomplete_upriv(&upriv).unwrap();
        assert_eq!(
            dest,
            dir.path().join(format!(".upriv-invalidated-{stamp}-2"))
        );
        assert!(dest.join("marker").host_is_file());
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
        let raw = crate::host_fs::read_to_string(root.settings_path()).unwrap();
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
        let raw = crate::host_fs::read_to_string(root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"en\""));

        let other = tempfile::tempdir().unwrap();
        let prefs = bootstrap_locale("   ");
        let root = initialize_vault_root_with_bootstrap(other.path(), Some(&prefs)).unwrap();
        let raw = crate::host_fs::read_to_string(root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"en\""));

        let empty = tempfile::tempdir().unwrap();
        let default_prefs = VaultRootBootstrapPrefs::default();
        let root =
            initialize_vault_root_with_bootstrap(empty.path(), Some(&default_prefs)).unwrap();
        let raw = crate::host_fs::read_to_string(root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"en\""));
    }

    #[test]
    fn initialize_with_bootstrap_serializes_escaped_locale() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = bootstrap_locale("en\"; rogue = \"x");
        let root = initialize_vault_root_with_bootstrap(dir.path(), Some(&prefs)).unwrap();
        let raw = crate::host_fs::read_to_string(root.settings_path()).unwrap();
        let parsed = crate::config::parse_settings_toml_str(&raw).unwrap();
        assert_eq!(parsed.ui.locale, "en\"; rogue = \"x");
    }

    #[test]
    fn open_absent_with_bootstrap_stamps_at_creation() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = bootstrap_locale("pt-BR");
        let opened =
            open_or_initialize_vault_root_with_policy_and_bootstrap(dir.path(), None, Some(&prefs))
                .unwrap();
        assert!(opened.created);
        let raw = crate::host_fs::read_to_string(opened.root.settings_path()).unwrap();
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
        let before = crate::host_fs::read_to_string(&settings).unwrap();

        let prefs = bootstrap_locale("pt-BR");
        let opened =
            open_or_initialize_vault_root_with_policy_and_bootstrap(dir.path(), None, Some(&prefs))
                .unwrap();
        assert!(!opened.created);
        let after = crate::host_fs::read_to_string(&settings).unwrap();
        assert_eq!(before, after);
        assert!(after.contains("locale = \"en\""));
    }

    /// A drive pulled during a settings write left a 0-byte `settings.toml`
    /// beside healthy vaults. Reset settings keeps every vault and backup.
    #[test]
    fn reset_settings_keeps_vaults_beside_an_empty_settings_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root(dir.path()).unwrap();
        let vault_config = root.vaults_dir().join("notes/config.toml");
        crate::host_fs::create_dir_all(vault_config.parent().unwrap()).unwrap();
        crate::host_fs::write(&vault_config, b"[vault]\nid = \"notes\"\n").unwrap();
        crate::host_fs::write(dir.path().join(".upriv/vault_groups.toml"), b"# groups\n").unwrap();
        crate::host_fs::write(root.settings_path(), b"").unwrap();
        assert_eq!(
            inspect_vault_root_at(dir.path()),
            VaultRootDirStatus::Incomplete
        );

        let opened = open_or_initialize_vault_root_with_policy_and_bootstrap(
            dir.path(),
            Some(IncompleteReplacePolicy::ResetSettings),
            Some(&bootstrap_locale("pt-BR")),
        )
        .unwrap();

        assert!(!opened.created);
        assert_eq!(inspect_vault_root_at(dir.path()), VaultRootDirStatus::Valid);
        let raw = crate::host_fs::read_to_string(opened.root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"pt-BR\""));
        assert_eq!(
            crate::host_fs::read(&vault_config).unwrap(),
            b"[vault]\nid = \"notes\"\n"
        );
        assert!(dir.path().join(".upriv/vault_groups.toml").host_is_file());
        let invalidated = crate::host_fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(".upriv-invalidated-")
            });
        assert!(!invalidated);
    }

    #[test]
    fn reset_settings_refuses_when_upriv_is_a_file() {
        let dir = tempfile::tempdir().unwrap();
        crate::host_fs::write(dir.path().join(".upriv"), b"not a folder").unwrap();
        let err = open_or_initialize_vault_root_with_policy(
            dir.path(),
            Some(IncompleteReplacePolicy::ResetSettings),
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
        assert_eq!(
            crate::host_fs::read(dir.path().join(".upriv")).unwrap(),
            b"not a folder"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_upriv_folder_still_validates() {
        let target = tempfile::tempdir().unwrap();
        initialize_vault_root(target.path()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(target.path().join(".upriv"), dir.path().join(".upriv"))
            .unwrap();
        assert_eq!(inspect_vault_root_at(dir.path()), VaultRootDirStatus::Valid);
    }

    #[test]
    fn incomplete_replace_with_bootstrap_stamps_fresh_layout() {
        let dir = tempfile::tempdir().unwrap();
        crate::host_fs::create_dir_all(dir.path().join(".upriv")).unwrap();
        let prefs = bootstrap_locale("es");
        let opened = open_or_initialize_vault_root_with_policy_and_bootstrap(
            dir.path(),
            Some(IncompleteReplacePolicy::Rename),
            Some(&prefs),
        )
        .unwrap();
        assert!(opened.created);
        let raw = crate::host_fs::read_to_string(opened.root.settings_path()).unwrap();
        assert!(raw.contains("locale = \"es\""));
    }
}
