//! Resolve vault-root on launch: explicit → (`custom_root`: active alias) →
//! (`default_root`: default_root only).
//!
//! `UPRIV_VAULT_ROOT` (or caller `explicit`) always wins over wire mode/path.
//!
//! Alias file (`.upriv-root`) lives in the **app home**:
//! - **Portable / AppImage** (writable folder): directory of `$APPIMAGE` / exe
//! - **System install** (e.g. `/opt`, Program Files): user data dir
//!   (`$XDG_DATA_HOME/upriv`, `%LOCALAPPDATA%\Upriv`, …)
//! - **Electron `--dev`:** `UPRIV_DEFAULT_ROOT_ANCHOR` (`upriv/dev/`) — same
//!   place as “create structure here”, so the simulation stays consistent
//!
//! Electron sets `UPRIV_DEFAULT_ROOT_ANCHOR` after a writability probe; when unset,
//! [`app_home_dir`] applies the same fallback.
//!
//! The file is created only when the user picks another folder. Switching back
//! to `default_root` **deactivates** it (keeps the path); it is not deleted.
//! `status=active` → `custom_root` path in use; `status=inactive` → `default_root` mode.
//!
//! **On-disk source of truth for vault-root mode/path is `.upriv-root`**, not
//! `settings.toml` (which never stores `vault_root_mode` / `upriv_root_path`).
//! Wire fields are derived from the alias on load; when mode is
//! [`VaultRootMode::DefaultRoot`], resolve ignores an active alias and uses
//! default_root only (UI/settings intent for that session).
//!
//! ## Incomplete `.upriv/` policy
//!
//! - At the **primary default_root anchor** (or any path in the strict/`starts`
//!   exact check): [`UprivError::VaultRootIncomplete`] **propagates** so Gate/Repair
//!   can offer rename/delete.
//! - When a candidate is found only via **upward/sibling walk** (not the start
//!   directory itself): Incomplete is **skipped** and search continues — a corrupt
//!   sibling must not block finding another valid root.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths::fs_env::{
    cleanup_stale_write_probes, dir_is_writable, env_appimage_dir, env_default_root_anchor,
    is_inside_macos_app_bundle, same_dir,
};
use crate::paths::{is_vault_root_marker, VaultRoot};

/// How the app locates the vault-root (wire: `"default_root"` | `"custom_root"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultRootMode {
    /// Create/use `.upriv/` at the distribution default root; active alias is ignored.
    #[default]
    DefaultRoot,
    /// Use the absolute path stored in `.upriv-root` (alias).
    CustomRoot,
}

/// Dotfile in the app home — path pointer to a vault-root (not a vault itself).
pub const VAULT_ROOT_ALIAS_FILE: &str = ".upriv-root";

/// Max parent levels walked upward by [`discover_vault_root_upward`].
/// Caps the walk so a misplaced install under `$HOME` does not scan the whole tree
/// (PRD portable layout: root is at the app home, not arbitrarily deep).
const PARENT_WALK_MAX_DEPTH: usize = 8;

/// Parsed `.upriv-root` contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRootAlias {
    /// Absolute path to the folder that contains `.upriv/settings.toml`.
    pub path: PathBuf,
    /// `true` = `custom_root` mode uses this path; `false` = remembered but unused.
    pub active: bool,
}

/// How the vault-root was located (wire: `"explicit"` | `"custom_root"` | `"default_root"`).
///
/// Distinct from [`VaultRootMode`]: **mode** is the user preference; **source** is how
/// resolve found the root this launch. Never treat a mode value as a source (or vice versa).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultRootSource {
    /// `--vault`, `UPRIV_VAULT_ROOT`, or an explicit path from the caller.
    Explicit,
    /// Active `.upriv-root` pointer in the app home (`custom_root` mode).
    CustomRoot,
    /// Marker found at the distribution `default_root` anchor (`default_root` mode).
    DefaultRoot,
}

/// Outcome of launch-time resolution.
#[derive(Debug, Clone)]
pub enum ResolveVaultRoot {
    Found {
        root: VaultRoot,
        source: VaultRootSource,
    },
    /// No valid root — UI should offer create `default_root` vs choose-path (+ alias).
    ///
    /// **Invariant:** `alias_path.parent() == Some(default_root_anchor.as_path())` —
    /// both are the app home. Wire keeps `defaultRootAnchor` / `aliasPath` (not a renamed
    /// `appHome`) so UI and docs stay aligned with the `default_root` mode name.
    NeedsSetup {
        /// Absolute path of the `.upriv-root` file (under app home).
        alias_path: PathBuf,
        /// Folder for “create `.upriv/` here” — same app home as `alias_path`'s parent.
        default_root_anchor: PathBuf,
        distribution: crate::paths::AppDistribution,
    },
}

/// Inputs for [`resolve_vault_root`].
#[derive(Debug, Clone, Default)]
pub struct ResolveVaultRootOptions {
    /// Highest priority: CLI / env / caller override.
    pub explicit: Option<PathBuf>,
    /// [`VaultRootMode::DefaultRoot`] (default): search default_root only (active `.upriv-root` is ignored).
    /// [`VaultRootMode::CustomRoot`]: use `.upriv-root` path, ignoring default_root.
    pub mode: VaultRootMode,
    /// Directory that contains the executable (tests inject a temp dir).
    /// When set, becomes the app home (alias + default_root) and env override is ignored.
    pub binary_dir: Option<PathBuf>,
}

/// Directory that owns the binary.
pub fn binary_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| UprivError::Io(std::io::Error::other("executable has no parent directory")))
}

/// App home: owns `.upriv-root` and is the `default_root` create target.
///
/// Order:
/// 1. `UPRIV_DEFAULT_ROOT_ANCHOR` (Electron always sets this after a writability probe)
/// 2. Directory of `$APPIMAGE` if writable, else [`resolve_user_data_app_home`]
/// 3. Directory of the running binary if writable, else [`resolve_user_data_app_home`]
///
/// Paths under a macOS `.app/Contents/` bundle always use [`resolve_user_data_app_home`]
/// (never probe or store portable data inside the signed bundle).
///
/// Does not create directories; writers use [`crate::paths::write_bytes_atomic`] /
/// `initialize_vault_root` which create as needed.
pub fn app_home_dir() -> Result<PathBuf> {
    let path = if let Some(path) = env_default_root_anchor() {
        path
    } else if let Some(path) = env_appimage_dir() {
        prefer_writable_app_home(path)?
    } else {
        prefer_writable_app_home(binary_dir()?)?
    };
    if path.is_dir() {
        cleanup_stale_write_probes(&path);
    }
    Ok(path)
}

/// Prefer `candidate` when writable; otherwise the per-user data directory.
fn prefer_writable_app_home(candidate: PathBuf) -> Result<PathBuf> {
    if is_inside_macos_app_bundle(&candidate) {
        return resolve_user_data_app_home();
    }
    if dir_is_writable(&candidate) {
        Ok(candidate)
    } else {
        resolve_user_data_app_home()
    }
}

/// User-owned app home for system installs (`/opt`, Program Files, …).
///
/// Pure path resolution — does **not** create the directory. Call
/// [`ensure_user_data_app_home`] before writing under this path.
pub(crate) fn resolve_user_data_app_home() -> Result<PathBuf> {
    let path = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(|v| PathBuf::from(v).join("Upriv"))
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|v| PathBuf::from(v).join("AppData").join("Local").join("Upriv"))
            })
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|v| {
            PathBuf::from(v)
                .join("Library")
                .join("Application Support")
                .join("Upriv")
        })
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .map(|p| p.join("upriv"))
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|v| PathBuf::from(v).join(".local").join("share").join("upriv"))
            })
    };
    path.ok_or_else(|| {
        UprivError::Io(std::io::Error::other(
            "cannot resolve user data app home (HOME / XDG_DATA_HOME / LOCALAPPDATA unset)",
        ))
    })
}

/// Resolve then create the user-data app home (first write under installed home).
pub(crate) fn ensure_user_data_app_home() -> Result<PathBuf> {
    let path = resolve_user_data_app_home()?;
    std::fs::create_dir_all(&path)?;
    crate::paths::fs_env::cleanup_stale_write_probes(&path);
    Ok(path)
}

/// Absolute path of the alias file in `home` (app home or test dir).
pub fn vault_root_alias_path(home: impl AsRef<Path>) -> PathBuf {
    home.as_ref().join(VAULT_ROOT_ALIAS_FILE)
}

fn alias_file_contents(path: &Path, active: bool) -> Result<String> {
    let path_str = path_as_alias_line(path)?;
    let status = if active { "active" } else { "inactive" };
    let status_note = if active {
        "custom_root mode — this path is the vault-root (default_root `.upriv` is ignored)."
    } else {
        "not in use — default-root mode is active; path kept if you switch back."
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

/// UTF-8 path for the alias file line — rejects non-UTF-8, newlines, and relative paths.
fn path_as_alias_line(path: &Path) -> Result<String> {
    if !path.is_absolute() {
        return Err(UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "vault-root path must be absolute",
        )));
    }
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
/// (default **inactive** when omitted — fail closed). First other non-empty line
/// is the absolute vault-root path. File present without a valid absolute path
/// line → [`UprivError::VaultRootAliasInvalid`].
pub fn read_vault_root_alias(home: impl AsRef<Path>) -> Result<Option<VaultRootAlias>> {
    let path = vault_root_alias_path(home);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut active = false;
    let mut saw_status = false;
    let mut normalize_unknown_status = false;
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
                    // Rare typo / corruption: fail closed and rewrite as inactive (no UI).
                    eprintln!(
                        "upriv-core: .upriv-root has unknown status={other:?}; rewriting as inactive"
                    );
                    normalize_unknown_status = true;
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
        return Err(UprivError::VaultRootAliasInvalid(path));
    };
    if !target.is_absolute() {
        return Err(UprivError::VaultRootAliasInvalid(path));
    }
    if normalize_unknown_status {
        // Best-effort heal; still return inactive even if the rewrite fails.
        if let Ok(contents) = alias_file_contents(&target, false) {
            if let Err(error) = write_alias_file_atomic(&path, &contents) {
                eprintln!(
                    "upriv-core: failed to rewrite .upriv-root as inactive: {error}"
                );
            }
        }
    }
    Ok(Some(VaultRootAlias {
        path: target,
        // No status= line → inactive (fail closed).
        active: if saw_status { active } else { false },
    }))
}

/// Atomically write `.upriv-root` (temp + `sync_all` + rename) so a crash cannot
/// leave a 0-byte alias that the next launch treats as missing.
fn write_alias_file_atomic(alias_path: &Path, contents: &str) -> Result<()> {
    crate::paths::write_bytes_atomic(alias_path, contents.as_bytes())
}

/// Write / rewrite the alias as **active** (custom_root mode). `target` must be a vault-root.
pub fn write_vault_root_alias(home: impl AsRef<Path>, target: impl AsRef<Path>) -> Result<()> {
    let root = VaultRoot::discover(target.as_ref())?;
    write_vault_root_alias_for_root(home, &root)
}

/// Write active alias using an already-validated [`VaultRoot`] (avoids a second discover).
pub fn write_vault_root_alias_for_root(home: impl AsRef<Path>, root: &VaultRoot) -> Result<()> {
    let home = home.as_ref();
    if resolve_user_data_app_home()
        .ok()
        .is_some_and(|ud| same_dir(&ud, home))
    {
        let _ = ensure_user_data_app_home()?;
    } else {
        std::fs::create_dir_all(home)?;
    }
    let alias = vault_root_alias_path(home);
    write_alias_file_atomic(&alias, &alias_file_contents(root.root(), true)?)
}

/// Mark an existing alias **inactive** (default-root mode in use). Keeps the path.
/// Missing file is OK (never created).
///
/// No file lock: safe under the desktop single-instance assumption (one daemon writer).
/// Concurrent writers could race; do not call from multiple processes without external locking.
pub(crate) fn deactivate_vault_root_alias(home: impl AsRef<Path>) -> Result<()> {
    let home = home.as_ref();
    let Some(alias) = read_vault_root_alias(home)? else {
        return Ok(());
    };
    let file = vault_root_alias_path(home);
    write_alias_file_atomic(&file, &alias_file_contents(&alias.path, false)?)
}

/// Deactivate alias in app home and, if different, beside the real binary (stale file).
///
/// See [`deactivate_vault_root_alias`] for single-instance / no-flock assumptions.
pub fn deactivate_vault_root_alias_everywhere() -> Result<()> {
    let home = app_home_dir()?;
    deactivate_vault_root_alias(&home)?;
    if let Ok(bin) = binary_dir() {
        if !same_dir(&bin, &home) {
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

/// Walk parents upward from `start` looking for `.upriv/settings.toml`.
///
/// At the **starting** directory only, also checks one level of child folders
/// (portable layout: binary folder beside a sibling vault-root). Parent dirs are
/// checked themselves but not their siblings — avoids picking up unrelated
/// roots under `/tmp` or the home directory.
pub fn discover_vault_root_upward(start: impl AsRef<Path>) -> Option<PathBuf> {
    let start = start.as_ref().canonicalize().ok()?;
    let mut current = start.clone();
    for depth in 0..PARENT_WALK_MAX_DEPTH {
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

/// Open a `default_root` candidate: preserve Incomplete / permission Io; absence → `Ok(None)`.
///
/// [`VaultRoot::discover`] only returns `Io`, [`UprivError::VaultRootNotFound`], or
/// [`UprivError::VaultRootIncomplete`] — unexpected variants propagate as `Err`.
pub(crate) fn open_default_root_candidate(path: &Path) -> Result<Option<VaultRoot>> {
    match VaultRoot::discover(path) {
        Ok(root) => Ok(Some(root)),
        Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error @ UprivError::Io(_)) => Err(error),
        Err(UprivError::VaultRootNotFound(_)) => Ok(None),
        Err(other) => Err(other),
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
        Err(UprivError::VaultRootNotFound(p)) => Err(UprivError::VaultRootNotFound(p)),
        Err(other) => Err(other),
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
/// Order: explicit (`UPRIV_VAULT_ROOT` / caller) → (`custom_root`: active alias) →
/// (`default_root`: default_root only). See crate README for strict/loose.
pub fn resolve_vault_root(options: ResolveVaultRootOptions) -> Result<ResolveVaultRoot> {
    use crate::paths::{detect_app_distribution, AppDistribution};

    let app_home = resolve_app_home(&options)?;
    let default_root_anchor =
        crate::paths::default_vault_root_anchor_for(options.binary_dir.as_deref())?;
    let alias_path = vault_root_alias_path(&app_home);
    let distribution = detect_app_distribution();

    let explicit = options.explicit.clone().or_else(env_vault_root_explicit);

    if let Some(explicit) = explicit.as_ref() {
        let root = open_or_classify(explicit)?;
        return Ok(ResolveVaultRoot::Found {
            root,
            source: VaultRootSource::Explicit,
        });
    }

    let needs_setup = || ResolveVaultRoot::NeedsSetup {
        alias_path: alias_path.clone(),
        default_root_anchor: default_root_anchor.clone(),
        distribution,
    };

    if options.mode == VaultRootMode::CustomRoot {
        return match try_open_alias(&app_home)? {
            Some(root) => Ok(ResolveVaultRoot::Found {
                root,
                source: VaultRootSource::CustomRoot,
            }),
            None => Ok(needs_setup()),
        };
    }

    // Installed packages never walk; Electron always sets `UPRIV_DEFAULT_ROOT_ANCHOR`, so
    // portable/dev are also exact-anchor only when that env is present.
    let only_default_root_anchor = options.binary_dir.is_none()
        && (distribution == AppDistribution::Installed || env_default_root_anchor().is_some());
    if only_default_root_anchor {
        return match open_default_root_candidate(&default_root_anchor)? {
            Some(root) => Ok(ResolveVaultRoot::Found {
                root,
                source: VaultRootSource::DefaultRoot,
            }),
            None => Ok(needs_setup()),
        };
    }

    let mut starts = vec![default_root_anchor.clone()];
    if options.binary_dir.is_none() {
        if let Ok(cwd) = std::env::current_dir() {
            if !same_dir(&cwd, &default_root_anchor) {
                starts.push(cwd);
            }
        }
    }

    for start in starts {
        // Incomplete at a primary start (anchor/cwd) propagates — Gate/Repair.
        if let Some(root) = open_default_root_candidate(&start)? {
            return Ok(ResolveVaultRoot::Found {
                root,
                source: VaultRootSource::DefaultRoot,
            });
        }
        if let Some(found) = discover_vault_root_upward(&start) {
            if !same_dir(&found, &start) {
                // Incomplete on a walk sibling is skipped (see module Incomplete policy).
                match open_default_root_candidate(&found) {
                    Ok(Some(root)) => {
                        return Ok(ResolveVaultRoot::Found {
                            root,
                            source: VaultRootSource::DefaultRoot,
                        });
                    }
                    Ok(None) | Err(UprivError::VaultRootIncomplete { .. }) => {}
                    Err(error) => return Err(error),
                }
            }
        }
    }

    Ok(needs_setup())
}

#[cfg(test)]
mod starts_order_tests {
    use super::*;
    use crate::paths::{initialize_vault_root, ENV_LOCK};

    /// Regression: `starts` tries default_root_anchor before cwd (do not invert the vec).
    #[test]
    fn default_root_anchor_preferred_over_cwd_root() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");

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
            mode: VaultRootMode::DefaultRoot,
            binary_dir: None,
        });
        let _ = std::env::set_current_dir(prev_cwd);
        std::env::remove_var("APPIMAGE");

        match resolved.unwrap() {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::DefaultRoot);
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
    // Custom_root mode requires an *active* alias. Inactive = remembered path only
    // (default_root in use) → treat as no alias for resolve (NeedsSetup).
    if !alias.active {
        return Ok(None);
    }
    match VaultRoot::discover(&alias.path) {
        Ok(root) => Ok(Some(root)),
        Err(error @ UprivError::VaultRootIncomplete { .. }) => Err(error),
        Err(UprivError::Io(ref error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(UprivError::VaultRootAliasInvalid(alias.path))
        }
        Err(error @ UprivError::Io(_)) => Err(error),
        Err(UprivError::VaultRootNotFound(_))
        | Err(UprivError::VaultRootAliasInvalid(_))
        | Err(UprivError::VaultNotFound(_))
        | Err(UprivError::VaultConfigInvalid { .. }) => {
            Err(UprivError::VaultRootAliasInvalid(alias.path))
        }
    }
}

fn env_vault_root_explicit() -> Option<PathBuf> {
    std::env::var_os("UPRIV_VAULT_ROOT").and_then(|value| {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() || !path.is_absolute() {
            None
        } else {
            Some(path)
        }
    })
}

/// Anchor for `vault_root_setup_default_root` / default_root status (distribution-aware).
pub fn setup_default_root_anchor() -> Result<PathBuf> {
    crate::paths::default_vault_root_anchor()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::initialize_vault_root;
    use crate::paths::ENV_LOCK;

    #[test]
    fn default_root_finds_root_at_anchor() {
        let dir = tempfile::tempdir().unwrap();
        let root = initialize_vault_root(dir.path()).unwrap();
        let nested = dir.path().join("bin");
        std::fs::create_dir_all(&nested).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::DefaultRoot,
            binary_dir: Some(nested),
        })
        .unwrap();

        match resolved {
            ResolveVaultRoot::Found {
                root: found,
                source,
            } => {
                assert_eq!(source, VaultRootSource::DefaultRoot);
                assert_eq!(found.root(), root.root());
            }
            ResolveVaultRoot::NeedsSetup { .. } => panic!("expected default_root find"),
        }
    }

    #[test]
    fn default_root_prefers_anchor_over_active_alias() {
        let default_root_dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let default_root = initialize_vault_root(default_root_dir.path()).unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        let bin = default_root_dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        write_vault_root_alias(&bin, elsewhere.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::DefaultRoot,
            binary_dir: Some(bin),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::DefaultRoot);
                assert_eq!(root.root(), default_root.root());
            }
            ResolveVaultRoot::NeedsSetup { .. } => {
                panic!("expected default_root over active alias")
            }
        }
    }

    #[test]
    fn default_root_uses_anchor_when_alias_inactive() {
        let default_root_dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let default_root = initialize_vault_root(default_root_dir.path()).unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(default_root_dir.path(), elsewhere.path()).unwrap();
        deactivate_vault_root_alias(default_root_dir.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::DefaultRoot,
            binary_dir: Some(default_root_dir.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::DefaultRoot);
                assert_eq!(root.root(), default_root.root());
            }
            ResolveVaultRoot::NeedsSetup { .. } => {
                panic!("expected default_root with inactive alias")
            }
        }
    }

    #[test]
    fn default_root_ignores_active_alias_when_anchor_missing() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::DefaultRoot,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap();
        assert!(matches!(resolved, ResolveVaultRoot::NeedsSetup { .. }));
    }

    #[test]
    fn default_root_ignores_inactive_alias() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();
        deactivate_vault_root_alias(home.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::DefaultRoot,
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
            mode: VaultRootMode::DefaultRoot,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootNotFound(_)));
    }

    #[test]
    fn custom_root_incomplete_alias_errors_incomplete() {
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
            mode: VaultRootMode::CustomRoot,
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
            mode: VaultRootMode::DefaultRoot,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootIncomplete { .. }));
    }

    #[test]
    fn custom_root_invalid_alias_errors() {
        let home = tempfile::tempdir().unwrap();
        let missing = home.path().join("gone");
        std::fs::write(
            vault_root_alias_path(home.path()),
            format!("status=active\n{}\n", missing.display()),
        )
        .unwrap();
        let err = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::CustomRoot,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootAliasInvalid(_)));
    }

    #[test]
    fn custom_root_uses_alias_over_default_root() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(home.path()).unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::CustomRoot,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::CustomRoot);
                assert_eq!(root.root(), elsewhere.path().canonicalize().unwrap());
            }
            _ => panic!("expected active alias over local .upriv"),
        }
    }

    #[test]
    fn custom_root_inactive_alias_needs_setup() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        write_vault_root_alias(home.path(), elsewhere.path()).unwrap();
        deactivate_vault_root_alias(home.path()).unwrap();

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::CustomRoot,
            binary_dir: Some(home.path().to_path_buf()),
        })
        .unwrap();
        assert!(
            matches!(resolved, ResolveVaultRoot::NeedsSetup { .. }),
            "inactive alias must not open under custom_root mode"
        );
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
    fn missing_status_line_treated_as_inactive() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        initialize_vault_root(elsewhere.path()).unwrap();
        let alias_path = vault_root_alias_path(home.path());
        std::fs::write(&alias_path, format!("{}\n", elsewhere.path().display())).unwrap();
        let alias = read_vault_root_alias(home.path()).unwrap().unwrap();
        assert!(!alias.active);
        assert_eq!(alias.path, elsewhere.path());
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
        let raw = std::fs::read_to_string(&alias_path).unwrap();
        assert!(
            raw.contains("status=inactive"),
            "unknown status should be rewritten to inactive: {raw}"
        );
        assert!(!raw.contains("status=actve"));
    }

    #[test]
    fn custom_root_uses_and_rewrites_alias() {
        let bin = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        initialize_vault_root(first.path()).unwrap();
        initialize_vault_root(second.path()).unwrap();

        write_vault_root_alias(bin.path(), first.path()).unwrap();
        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::CustomRoot,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::Found { root, source } => {
                assert_eq!(source, VaultRootSource::CustomRoot);
                assert_eq!(root.root(), first.path().canonicalize().unwrap());
            }
            _ => panic!("expected alias"),
        }

        write_vault_root_alias(bin.path(), second.path()).unwrap();
        let again = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::CustomRoot,
            binary_dir: Some(bin.path().to_path_buf()),
        })
        .unwrap();
        match again {
            ResolveVaultRoot::Found { root, .. } => {
                assert_eq!(root.root(), second.path().canonicalize().unwrap());
            }
            _ => panic!("expected rewritten alias"),
        }

        std::fs::remove_file(vault_root_alias_path(bin.path())).unwrap();
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
            mode: VaultRootMode::CustomRoot,
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
    fn app_home_prefers_env_for_alias_and_default_root() {
        let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::EnvGuard::capture(&["UPRIV_DEFAULT_ROOT_ANCHOR", "APPIMAGE"]);
        let anchor = tempfile::tempdir().unwrap();
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", anchor.path());
        std::env::remove_var("APPIMAGE");
        assert_eq!(app_home_dir().unwrap(), anchor.path());
        assert_eq!(setup_default_root_anchor().unwrap(), anchor.path());
        assert_eq!(
            vault_root_alias_path(app_home_dir().unwrap()),
            anchor.path().join(VAULT_ROOT_ALIAS_FILE)
        );
    }

    #[test]
    fn app_home_prefers_appimage_dir_over_binary() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let appimage_dir = tempfile::tempdir().unwrap();
        let appimage = appimage_dir.path().join("Upriv.AppImage");
        std::fs::write(&appimage, b"fake").unwrap();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::set_var("APPIMAGE", &appimage);
        assert_eq!(app_home_dir().unwrap(), appimage_dir.path());
        std::env::remove_var("APPIMAGE");
    }

    #[test]
    #[cfg(unix)]
    fn app_home_falls_back_when_appimage_dir_not_writable() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let install = tempfile::tempdir().unwrap();
        let appimage = install.path().join("Upriv.AppImage");
        std::fs::write(&appimage, b"fake").unwrap();

        let data = tempfile::tempdir().unwrap();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::set_var("APPIMAGE", &appimage);
        std::env::set_var("XDG_DATA_HOME", data.path());

        std::fs::set_permissions(install.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        let home = app_home_dir().unwrap();
        assert_eq!(home, data.path().join("upriv"));
        // Resolve is pure — directory is created on write via ensure_user_data_app_home.
        assert!(!home.exists() || home.is_dir());
        let ensured = ensure_user_data_app_home().unwrap();
        assert_eq!(ensured, home);
        assert!(ensured.is_dir());

        std::fs::set_permissions(install.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("XDG_DATA_HOME");
    }

    #[test]
    #[cfg(unix)]
    fn app_home_env_wins_even_when_not_writable() {
        use std::os::unix::fs::PermissionsExt;

        // Electron may set UPRIV_DEFAULT_ROOT_ANCHOR to an already-resolved home; trust it
        // even if a later probe would fail (no double fallback fight).
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let anchor = tempfile::tempdir().unwrap();
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", anchor.path());
        std::env::remove_var("APPIMAGE");
        std::fs::set_permissions(anchor.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        assert_eq!(app_home_dir().unwrap(), anchor.path());
        std::fs::set_permissions(anchor.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn installed_needs_setup_uses_app_home_as_default_root_anchor() {
        use crate::paths::{AppDistribution, ENV_DISTRIBUTION};

        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tempfile::tempdir().unwrap();
        let appdata = home.path().join("appdata");
        std::fs::create_dir_all(&appdata).unwrap();
        std::env::set_var("HOME", home.path());
        std::env::set_var(ENV_DISTRIBUTION, "installed");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", &appdata);
        std::env::remove_var("APPIMAGE");

        let resolved = resolve_vault_root(ResolveVaultRootOptions {
            explicit: None,
            mode: VaultRootMode::DefaultRoot,
            binary_dir: None,
        })
        .unwrap();
        match resolved {
            ResolveVaultRoot::NeedsSetup {
                alias_path,
                default_root_anchor,
                distribution,
            } => {
                assert_eq!(distribution, AppDistribution::Installed);
                assert_eq!(alias_path, appdata.join(".upriv-root"));
                assert_eq!(default_root_anchor, appdata);
            }
            _ => panic!("expected needs_setup"),
        }

        std::env::remove_var(ENV_DISTRIBUTION);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::remove_var("HOME");
    }

    #[test]
    fn installed_first_run_creates_absent_app_home_on_setup() {
        use crate::paths::{initialize_vault_root, ENV_DISTRIBUTION};

        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let base = tempfile::tempdir().unwrap();
        let app_home = base.path().join("missing-app-home");
        assert!(!app_home.exists());

        std::env::set_var(ENV_DISTRIBUTION, "installed");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", &app_home);
        std::env::remove_var("APPIMAGE");

        // Resolve is path-only — Electron does not mkdir; first write creates.
        assert_eq!(app_home_dir().unwrap(), app_home);
        assert_eq!(setup_default_root_anchor().unwrap(), app_home);
        assert!(!app_home.exists());

        let root = initialize_vault_root(&app_home).unwrap();
        assert!(app_home.is_dir());
        assert!(root.root().join(".upriv").join("settings.toml").is_file());

        std::env::remove_var(ENV_DISTRIBUTION);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
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
