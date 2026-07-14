//! Resolve vault-root on launch: explicit → alias (fixed) → nearby (auto).
//!
//! Alias file (`.upriv-root`) lives in the **app home**:
//! - **Prod / AppImage:** directory of `$APPIMAGE` / portable install
//! - **Electron `--dev`:** `UPRIV_NEARBY_ANCHOR` (`upriv/dev/`) — same
//!   place as “create structure here”, so the simulation stays consistent
//!
//! The file is created only when the user picks another folder. Switching back
//! to auto-nearby **deactivates** it (keeps the path); it is not deleted.
//! `status=active` → fixed path in use; `status=inactive` → nearby / auto in use.
//! When `auto_detect=true`, nearby wins and an active alias is ignored (settings are source of truth).

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};
use crate::paths::{is_vault_root_marker, VaultRoot};

/// Dotfile in the app home — path pointer to a vault-root (not a vault itself).
pub const VAULT_ROOT_ALIAS_FILE: &str = ".upriv-root";

/// Max parent levels walked by [`discover_vault_root_near`].
/// Caps the walk so a misplaced install under `$HOME` does not scan the whole tree
/// (PRD portable layout: root is at/near the app, not arbitrarily deep).
const NEARBY_MAX_DEPTH: usize = 8;

/// Parsed `.upriv-root` contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRootAlias {
    /// Absolute path to the folder that contains `.upriv/settings.toml`.
    pub path: PathBuf,
    /// `true` = fixed-path mode uses this path; `false` = remembered but unused.
    pub active: bool,
}

/// How the vault-root was located.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultRootSource {
    /// `--vault`, `UPRIV_VAULT_ROOT`, or an explicit path from the caller.
    Explicit,
    /// `.upriv-root` in the app home (fixed-path / active alias).
    Alias,
    /// Marker found at/near the app home (auto-detect).
    Nearby,
}

/// Outcome of launch-time resolution.
#[derive(Debug, Clone)]
pub enum ResolveVaultRoot {
    Found {
        root: VaultRoot,
        source: VaultRootSource,
    },
    /// No valid root — UI should offer create-nearby vs choose-path (+ alias).
    NeedsSetup {
        /// Where `.upriv-root` would be written (app home).
        alias_path: PathBuf,
        /// Preferred directory for “create default structure here” (same as app home).
        nearby_anchor: PathBuf,
    },
}

/// Inputs for [`resolve_vault_root`].
#[derive(Debug, Clone, Default)]
pub struct ResolveVaultRootOptions {
    /// Highest priority: CLI / env / caller override.
    pub explicit: Option<PathBuf>,
    /// When `true` (default): search nearby only (active `.upriv-root` is ignored).
    /// When `false`: use `.upriv-root` path (fixed mode), ignoring nearby.
    pub auto_detect: bool,
    /// Directory that contains the executable (tests inject a temp dir).
    /// When set, becomes the app home (alias + nearby) and env override is ignored.
    pub binary_dir: Option<PathBuf>,
}

/// Directory that owns the binary.
pub fn binary_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| UprivError::Io(std::io::Error::other("executable has no parent directory")))
}

/// “Beside the app” home: owns `.upriv-root` and is the create-nearby target.
///
/// Order:
/// 1. `UPRIV_NEARBY_ANCHOR` (Electron `--dev` → `upriv/dev/`)
/// 2. Directory of `$APPIMAGE` (Linux AppImage — portable folder on disk, not the FUSE mount)
/// 3. Directory of the running binary
pub fn app_home_dir() -> Result<PathBuf> {
    if let Some(path) = env_nearby_anchor() {
        return Ok(path);
    }
    if let Some(path) = env_appimage_dir() {
        return Ok(path);
    }
    binary_dir()
}

/// Parent directory of the AppImage file when running under AppImageKit (`$APPIMAGE`).
fn env_appimage_dir() -> Option<PathBuf> {
    std::env::var_os("APPIMAGE").and_then(|value| {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() {
            return None;
        }
        path.parent()
            .map(Path::to_path_buf)
            .filter(|p| !p.as_os_str().is_empty())
    })
}

/// Absolute path of the alias file in `home` (app home or test dir).
pub fn vault_root_alias_path(home: impl AsRef<Path>) -> PathBuf {
    home.as_ref().join(VAULT_ROOT_ALIAS_FILE)
}

fn alias_file_contents(path: &Path, active: bool) -> Result<String> {
    let path_str = path_as_alias_line(path)?;
    let status = if active { "active" } else { "inactive" };
    let status_note = if active {
        "fixed-path mode — this path is the vault-root (nearby `.upriv` is ignored)."
    } else {
        "not in use — auto-detect / nearby `.upriv` is active; path kept if you switch back."
    };
    Ok(format!(
        "\
# Upriv vault-root alias (not a vault — path pointer only).
# Absolute path to the folder that contains `.upriv/settings.toml`.
# Created only when the user chooses \"another folder\".
# status={status} — {status_note}
# Do not put passwords or secrets in this file.
#
status={status}
{path_str}
"
    ))
}

/// UTF-8 path for the alias file line — rejects non-UTF-8 and newlines.
fn path_as_alias_line(path: &Path) -> Result<String> {
    let Some(s) = path.to_str() else {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "vault-root path is not valid UTF-8",
        )));
    };
    if s.contains('\n') || s.contains('\r') {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "vault-root path must not contain newline characters",
        )));
    }
    Ok(s.to_string())
}

/// Read `.upriv-root` if present. Missing file → `Ok(None)`.
///
/// Lines starting with `#` are comments. `status=active|inactive` sets the flag
/// (default **active** when omitted — legacy files). First other non-empty line
/// is the absolute vault-root path.
pub fn read_vault_root_alias(home: impl AsRef<Path>) -> Result<Option<VaultRootAlias>> {
    let path = vault_root_alias_path(home);
    if !path.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)?;
    let mut active = true;
    let mut saw_status = false;
    let mut target: Option<PathBuf> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("status=") {
            saw_status = true;
            active = match value.trim().to_ascii_lowercase().as_str() {
                "active" => true,
                "inactive" => false,
                other => {
                    // Unknown value must not silently re-enable fixed mode (typo → inactive).
                    eprintln!(
                        "upriv-core: .upriv-root has unknown status={other:?}; treating as inactive"
                    );
                    false
                }
            };
            continue;
        }
        if target.is_none() {
            target = Some(PathBuf::from(trimmed));
        }
    }
    let Some(target) = target else {
        return Ok(None);
    };
    Ok(Some(VaultRootAlias {
        path: target,
        active: if saw_status { active } else { true },
    }))
}

/// Atomically write `.upriv-root` (temp + `sync_all` + rename) so a crash cannot
/// leave a 0-byte alias that the next launch treats as missing.
fn write_alias_file_atomic(alias_path: &Path, contents: &str) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = alias_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = alias_path.with_extension(format!("tmp.{}.{}", std::process::id(), nonce));
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, alias_path)?;
    Ok(())
}

/// Write / rewrite the alias as **active** (fixed-path mode). `target` must be a vault-root.
pub fn write_vault_root_alias(home: impl AsRef<Path>, target: impl AsRef<Path>) -> Result<()> {
    let root = VaultRoot::discover(target.as_ref())?;
    let alias = vault_root_alias_path(home);
    write_alias_file_atomic(&alias, &alias_file_contents(root.root(), true)?)
}

/// Mark an existing alias **inactive** (auto-nearby in use). Keeps the path.
/// Missing file is OK (never created).
pub fn deactivate_vault_root_alias(home: impl AsRef<Path>) -> Result<()> {
    let home = home.as_ref();
    let Some(alias) = read_vault_root_alias(home)? else {
        return Ok(());
    };
    let file = vault_root_alias_path(home);
    write_alias_file_atomic(&file, &alias_file_contents(&alias.path, false)?)
}

/// Deactivate alias in app home and, if different, beside the real binary (stale file).
pub fn deactivate_vault_root_alias_everywhere() -> Result<()> {
    let home = app_home_dir()?;
    deactivate_vault_root_alias(&home)?;
    if let Ok(bin) = binary_dir() {
        if bin != home {
            if let Err(error) = deactivate_vault_root_alias(&bin) {
                eprintln!(
                    "upriv-core: failed to deactivate stale .upriv-root beside binary {}: {error}",
                    bin.display()
                );
            }
        }
    }
    Ok(())
}

/// Delete the alias file permanently. Prefer [`deactivate_vault_root_alias`] for
/// switching to auto (keeps the remembered path). This removes the file entirely.
pub fn delete_vault_root_alias(home: impl AsRef<Path>) -> Result<()> {
    let alias = vault_root_alias_path(home);
    match std::fs::remove_file(&alias) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// Delete alias in app home and, if different, beside the real binary.
pub fn delete_vault_root_alias_everywhere() -> Result<()> {
    let home = app_home_dir()?;
    delete_vault_root_alias(&home)?;
    if let Ok(bin) = binary_dir() {
        if bin != home {
            let _ = delete_vault_root_alias(bin);
        }
    }
    Ok(())
}

/// Search upward from `start` for `.upriv/settings.toml`.
///
/// At the **starting** directory only, also checks one level of child folders
/// (portable layout: binary folder beside a sibling vault-root). Parent dirs are
/// checked themselves but not their siblings — avoids picking up unrelated
/// roots under `/tmp` or the home directory.
pub fn discover_vault_root_near(start: impl AsRef<Path>) -> Option<PathBuf> {
    let start = start.as_ref().canonicalize().ok()?;
    let mut current = start.clone();
    for depth in 0..NEARBY_MAX_DEPTH {
        if is_vault_root_marker(&current) {
            return current.canonicalize().ok();
        }
        if depth == 0 {
            if let Ok(entries) = std::fs::read_dir(&current) {
                // Deterministic pick when multiple sibling roots exist.
                let mut siblings: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|path| path.is_dir() && is_vault_root_marker(path))
                    .collect();
                siblings.sort();
                if let Some(path) = siblings.into_iter().next() {
                    return path.canonicalize().ok();
                }
            }
        }
        current = current.parent()?.to_path_buf();
    }
    None
}

/// Open a nearby candidate: preserve Incomplete / permission Io; absence → `Ok(None)`.
fn open_nearby_candidate(path: &Path) -> Result<Option<VaultRoot>> {
    match VaultRoot::discover(path) {
        Ok(root) => Ok(Some(root)),
        Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error @ UprivError::Io(_)) => Err(error),
        Err(UprivError::VaultRootNotFound(_)) => Ok(None),
        Err(UprivError::VaultRootAliasInvalid(_)) => Ok(None),
    }
}

/// Open `path` as vault-root, preserving incomplete vs missing vs permission I/O.
fn open_or_classify(path: &Path) -> Result<VaultRoot> {
    match VaultRoot::discover(path) {
        Ok(root) => Ok(root),
        Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => Err(
            UprivError::VaultRootNotFound(path.join(crate::paths::VAULT_ROOT_SETTINGS_REL)),
        ),
        Err(error @ UprivError::Io(_)) => Err(error),
        Err(_) => Err(UprivError::VaultRootNotFound(
            path.join(crate::paths::VAULT_ROOT_SETTINGS_REL),
        )),
    }
}

fn resolve_app_home(options: &ResolveVaultRootOptions) -> Result<PathBuf> {
    if let Some(dir) = &options.binary_dir {
        return Ok(dir.clone());
    }
    app_home_dir()
}

/// Resolve the vault-root for app launch.
///
/// Order: explicit → fixed alias → nearby (auto). See crate README for strict/loose.
pub fn resolve_vault_root(options: ResolveVaultRootOptions) -> Result<ResolveVaultRoot> {
    let app_home = resolve_app_home(&options)?;
    let nearby_anchor = app_home.clone();
    let alias_path = vault_root_alias_path(&app_home);

    let explicit = options.explicit.clone().or_else(env_vault_root_explicit);

    if let Some(explicit) = explicit.as_ref() {
        let root = open_or_classify(explicit)?;
        return Ok(ResolveVaultRoot::Found {
            root,
            source: VaultRootSource::Explicit,
        });
    }

    if !options.auto_detect {
        return match try_open_alias(&app_home)? {
            Some(root) => Ok(ResolveVaultRoot::Found {
                root,
                source: VaultRootSource::Alias,
            }),
            None => Ok(ResolveVaultRoot::NeedsSetup {
                alias_path,
                nearby_anchor,
            }),
        };
    }

    // Auto: nearby only. Strict when `UPRIV_NEARBY_ANCHOR` is set (exact folder).
    let mut starts = vec![nearby_anchor.clone()];
    if options.binary_dir.is_none() {
        if let Ok(cwd) = std::env::current_dir() {
            if cwd != nearby_anchor {
                starts.push(cwd);
            }
        }
    }

    let strict_anchor = options.binary_dir.is_none() && env_nearby_anchor().is_some();
    if strict_anchor {
        return match open_nearby_candidate(&nearby_anchor)? {
            Some(root) => Ok(ResolveVaultRoot::Found {
                root,
                source: VaultRootSource::Nearby,
            }),
            None => Ok(ResolveVaultRoot::NeedsSetup {
                alias_path,
                nearby_anchor,
            }),
        };
    }

    for start in starts {
        if let Some(root) = open_nearby_candidate(&start)? {
            return Ok(ResolveVaultRoot::Found {
                root,
                source: VaultRootSource::Nearby,
            });
        }
        if let Some(found) = discover_vault_root_near(&start) {
            if found != start {
                if let Some(root) = open_nearby_candidate(&found)? {
                    return Ok(ResolveVaultRoot::Found {
                        root,
                        source: VaultRootSource::Nearby,
                    });
                }
            }
        }
    }

    Ok(ResolveVaultRoot::NeedsSetup {
        alias_path,
        nearby_anchor,
    })
}

#[cfg(test)]
mod starts_order_tests {
    use super::*;
    use crate::paths::{initialize_vault_root, ENV_LOCK};

    /// Regression: `starts` tries nearby_anchor before cwd (do not invert the vec).
    #[test]
    fn nearby_anchor_preferred_over_cwd_root() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("UPRIV_NEARBY_ANCHOR");

        let appimage_dir = tempfile::tempdir().unwrap();
        let appimage = appimage_dir.path().join("Upriv.AppImage");
        std::fs::write(&appimage, b"fake").unwrap();
        initialize_vault_root(appimage_dir.path()).unwrap();

        let cwd_root = tempfile::tempdir().unwrap();
        initialize_vault_root(cwd_root.path()).unwrap();

        std::env::set_var("APPIMAGE", &appimage);
        let prev_cwd = std::env::current_dir().unwrap();
        std::env::set_current_dir(cwd_root.path()).unwrap();
        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: true,
            binary_dir: None,
        });
        let _ = std::env::set_current_dir(prev_cwd);
        std::env::remove_var("APPIMAGE");

        match resolved.unwrap() {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Nearby);
                assert_eq!(
                    root.root(),
                    appimage_dir.path().canonicalize().unwrap(),
                    "anchor must win over cwd when both have a valid root"
                );
            }
            other => panic!("expected anchor root, got {other:?}"),
        }
    }
}

fn try_open_alias(app_home: &Path) -> Result<Option<VaultRoot>> {
    let Some(alias) = read_vault_root_alias(app_home)? else {
        return Ok(None);
    };
    match VaultRoot::discover(&alias.path) {
        Ok(root) => Ok(Some(root)),
        Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(UprivError::VaultRootAliasInvalid(alias.path))
        }
        Err(error @ UprivError::Io(_)) => Err(error),
        Err(_) => Err(UprivError::VaultRootAliasInvalid(alias.path)),
    }
}

/// Preferred folder for “create structure here” / auto search / alias home.
/// Electron `--dev` sets `UPRIV_NEARBY_ANCHOR` to `upriv/dev/`.
pub fn env_nearby_anchor() -> Option<PathBuf> {
    std::env::var_os("UPRIV_NEARBY_ANCHOR").and_then(|value| {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() {
            None
        } else {
            Some(path)
        }
    })
}

fn env_vault_root_explicit() -> Option<PathBuf> {
    std::env::var_os("UPRIV_VAULT_ROOT").and_then(|value| {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() {
            None
        } else {
            Some(path)
        }
    })
}

/// Anchor used by `vault_root_setup_nearby` (same as [`app_home_dir`]).
pub fn setup_nearby_anchor() -> Result<PathBuf> {
    app_home_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::initialize_vault_root;
    use crate::paths::ENV_LOCK;

    #[test]
    fn auto_finds_nearby_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root(dir.path()).unwrap();
        let nested = dir.path().join("bin");
        std::fs::create_dir_all(&nested).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: true,
            binary_dir: Some(nested),
        })
        .unwrap();

        match resolved {
            ResolveVaultRoot::Found {
                root: found,
                source,
            } => {
                assert_eq!(source, VaultRootSource::Nearby);
                assert_eq!(found.root(), root.root());
            }
            ResolveVaultRoot::NeedsSetup { .. } => panic!("expected nearby find"),
        }
    }

    #[test]
    fn auto_prefers_nearby_over_active_alias() {
        let nearby = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let nearby_root = initialize_vault_root(nearby.path()).unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        let bin = nearby.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        write_vault_root_alias(&bin, elsewhere.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: true,
            binary_dir: Some(bin),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Nearby);
                assert_eq!(root.root(), nearby_root.root());
            }
            ResolveVaultRoot::NeedsSetup { .. } => panic!("expected nearby over active alias"),
        }
    }

    #[test]
    fn auto_uses_nearby_when_alias_inactive() {
        let nearby = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let nearby_root = initialize_vault_root(nearby.path()).unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(nearby.path(), elsewhere.path()).unwrap();
        deactivate_vault_root_alias(nearby.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: true,
            binary_dir: Some(nearby.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Nearby);
                assert_eq!(root.root(), nearby_root.root());
            }
            ResolveVaultRoot::NeedsSetup { .. } => panic!("expected nearby with inactive alias"),
        }
    }

    #[test]
    fn auto_ignores_active_alias_when_nearby_missing() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: true,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap();
        assert!(matches!(resolved, ResolveVaultRoot::NeedsSetup { .. }));
    }

    #[test]
    fn auto_ignores_inactive_alias() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();
        deactivate_vault_root_alias(home.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: true,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap();
        assert!(matches!(resolved, ResolveVaultRoot::NeedsSetup { .. }));

        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(!alias.active);
        assert_eq!(alias.path, elsewhere.path().canonicalize().unwrap());
    }

    #[test]
    fn explicit_invalid_errors() {
        let bin = tempfile::tempdir().unwrap();
        let missing = bin.path().join("no-root-here");
        let err = resolve_vault_root(ResolveVaultRootOptions {
            explicit: Some(missing.clone()),
            auto_detect: true,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootNotFound(_)));
    }

    #[test]
    fn fixed_mode_incomplete_alias_errors_incomplete() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(elsewhere.path().join(".upriv")).unwrap();
        std::fs::write(
            elsewhere.path().join(".upriv/settings.toml"),
            "not valid toml {{{",
        )
        .unwrap();
        // Bypass write_vault_root_alias (requires a valid marker).
        std::fs::write(
            vault_root_alias_path(home.path()),
            format!("status=active\n{}\n", elsewhere.path().display()),
        )
        .unwrap();

        let err = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: false,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn explicit_incomplete_errors_incomplete() {
        let bin = tempfile::tempdir().unwrap();
        let broken = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(broken.path().join(".upriv")).unwrap();
        std::fs::write(broken.path().join(".upriv/settings.toml"), "broken").unwrap();

        let err = resolve_vault_root(ResolveVaultRootOptions {
            explicit: Some(broken.path().to_path_buf()),
            auto_detect: true,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn fixed_mode_invalid_alias_errors() {
        let home = tempfile::tempdir().unwrap();
        let missing = home.path().join("gone");
        std::fs::write(
            vault_root_alias_path(home.path()),
            format!("status=active\n{}\n", missing.display()),
        )
        .unwrap();
        let err = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: false,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootAliasInvalid(_)));
    }

    #[test]
    fn fixed_mode_uses_alias_over_nearby() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(home.path()).unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: false,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Alias);
                assert_eq!(root.root(), elsewhere.path().canonicalize().unwrap());
            }
            _ => panic!("expected active alias over local .upriv"),
        }
    }

    #[test]
    fn deactivate_keeps_path_and_reactivates() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();
        deactivate_vault_root_alias(home.path()).unwrap();

        let raw = std::fs::read_to_string(vault_root_alias_path(home.path())).unwrap();
        assert!(raw.contains("status=inactive"));
        assert!(vault_root_alias_path(home.path()).is_file());

        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();
        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(alias.active);
    }

    #[test]
    fn unknown_alias_status_treated_as_inactive() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        let alias_path = vault_root_alias_path(home.path());
        std::fs::write(
            &alias_path,
            format!("status=actve\n{}\n", elsewhere.path().display()),
        )
        .unwrap();
        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(!alias.active);
        assert_eq!(alias.path, elsewhere.path());
    }

    #[test]
    fn fixed_mode_uses_and_rewrites_alias() {
        let bin = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        initialize_vault_root(first.path()).unwrap();
        initialize_vault_root(second.path()).unwrap();

        write_vault_root_alias(bin.path(), first.path()).unwrap();
        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: false,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Alias);
                assert_eq!(root.root(), first.path().canonicalize().unwrap());
            }
            _ => panic!("expected alias"),
        }

        write_vault_root_alias(bin.path(), second.path()).unwrap();
        let again = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            auto_detect: false,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap();
        match again {
            ResolveVaultRoot::Found { root, .. } => {
                assert_eq!(root.root(), second.path().canonicalize().unwrap());
            }
            _ => panic!("expected rewritten alias"),
        }

        delete_vault_root_alias(bin.path()).unwrap();
        assert!(!vault_root_alias_path(bin.path()).is_file());
    }

    #[test]
    fn explicit_wins() {
        let bin = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        initialize_vault_root(a.path()).unwrap();
        initialize_vault_root(b.path()).unwrap();
        write_vault_root_alias(bin.path(), a.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: Some(b.path().to_path_buf()),
            auto_detect: false,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::Explicit);
                assert_eq!(root.root(), b.path().canonicalize().unwrap());
            }
            _ => panic!("expected explicit"),
        }
    }

    #[test]
    fn app_home_prefers_env_for_alias_and_nearby() {
        let _guard = ENV_LOCK.lock().unwrap();
        let anchor = tempfile::tempdir().unwrap();
        std::env::set_var("UPRIV_NEARBY_ANCHOR", anchor.path());
        std::env::remove_var("APPIMAGE");
        assert_eq!(app_home_dir().unwrap(), anchor.path());
        assert_eq!(setup_nearby_anchor().unwrap(), anchor.path());
        assert_eq!(
            vault_root_alias_path(app_home_dir().unwrap()),
            anchor.path().join(VAULT_ROOT_ALIAS_FILE)
        );
        std::env::remove_var("UPRIV_NEARBY_ANCHOR");
    }

    #[test]
    fn app_home_prefers_appimage_dir_over_binary() {
        let _guard = ENV_LOCK.lock().unwrap();
        let appimage_dir = tempfile::tempdir().unwrap();
        let appimage = appimage_dir.path().join("Upriv.AppImage");
        std::fs::write(&appimage, b"fake").unwrap();
        std::env::remove_var("UPRIV_NEARBY_ANCHOR");
        std::env::set_var("APPIMAGE", &appimage);
        assert_eq!(app_home_dir().unwrap(), appimage_dir.path());
        std::env::remove_var("APPIMAGE");
    }

    #[test]
    fn alias_file_has_comments_and_readable_path() {
        let home = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        initialize_vault_root(target.path()).unwrap();
        write_vault_root_alias(home.path(), target.path()).unwrap();
        let raw = std::fs::read_to_string(vault_root_alias_path(home.path())).unwrap();
        assert!(raw.contains("# Upriv vault-root alias"));
        assert!(raw.contains("status=active"));
        let parsed = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(parsed.active);
        assert_eq!(parsed.path, target.path().canonicalize().unwrap());
    }
}
