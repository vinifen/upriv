//! Configurable mount-parent paths (`[workspace].path` / vault `[mount]`).
//!
//! Empty global path means unset — callers must not create a mount folder until
//! the user chooses.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

use crate::error::{Result, UprivError};

/// Vault `[mount].workspace_path` value that inherits app `[workspace].path`.
pub const WORKSPACE_PATH_DEFAULT: &str = "default";

/// Standard child directories created under `<vault-root>/.upriv/` (not a mount parent).
/// The reserved check rejects the **entire** `.upriv/` tree, not only these names.
pub const RESERVED_UPRIV_WORKSPACE_CHILDREN: &[&str] = &["vaults", "logs", "app", "runtime"];

/// True when `path` is an absolute filesystem path, or (Android only) a SAF tree URI
/// (`content://…`) — same persistable shape as vault-root custom_root on mobile.
pub fn is_absolute_filesystem_path(path: &Path) -> bool {
    if path.is_absolute() {
        return true;
    }
    cfg!(target_os = "android")
        && path
            .to_str()
            .is_some_and(|s| s.trim().starts_with("content://"))
}

/// Whether `candidate` contains a `.upriv` path segment (case-insensitive),
/// independent of vault-root.
///
/// The entire `.upriv/` tree is reserved for the contentor. Catches absolute
/// reserved trees even when serialize has no custom root (default_root / SAF).
pub fn path_is_under_reserved_upriv_tree(candidate: &Path) -> bool {
    candidate
        .components()
        .any(|c| matches!(c, Component::Normal(n) if os_str_eq_ignore_ascii_case(n, ".upriv")))
}

/// Whether `candidate` is `<vault_root>/.upriv` or anything under it.
pub fn is_reserved_upriv_workspace_path(candidate: &Path, vault_root: &Path) -> bool {
    let Ok(upriv) = vault_root.join(".upriv").canonicalize() else {
        // Fall back to lexical compare when paths do not exist yet.
        return is_reserved_upriv_workspace_path_lexical(candidate, vault_root);
    };
    let Ok(cand) = candidate.canonicalize() else {
        return is_reserved_upriv_workspace_path_lexical(candidate, vault_root);
    };
    cand == upriv || cand.starts_with(&upriv)
}

fn is_reserved_upriv_workspace_path_lexical(candidate: &Path, vault_root: &Path) -> bool {
    paths_equal_or_under_casefold(candidate, &vault_root.join(".upriv"))
}

/// Lexical prefix match with ASCII casefold on `Normal` components (parity with TS
/// `toLowerCase()` when canonicalize is unavailable — Windows/macOS volumes).
fn paths_equal_or_under_casefold(candidate: &Path, prefix: &Path) -> bool {
    let c: Vec<_> = candidate.components().collect();
    let p: Vec<_> = prefix.components().collect();
    if c.len() < p.len() {
        return false;
    }
    c.iter()
        .zip(p.iter())
        .all(|(a, b)| components_eq_ignore_ascii_case(a, b))
}

fn components_eq_ignore_ascii_case(a: &Component<'_>, b: &Component<'_>) -> bool {
    match (a, b) {
        (Component::Normal(a), Component::Normal(b)) => a.eq_ignore_ascii_case(b),
        _ => a == b,
    }
}

fn os_str_eq_ignore_ascii_case(os: &OsStr, ascii: &str) -> bool {
    os.eq_ignore_ascii_case(OsStr::new(ascii))
}

/// Validate app `[workspace].path`. Empty is allowed (unset).
pub fn validate_workspace_global_path(path: &str, vault_root: Option<&Path>) -> Result<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(trimmed);
    if !is_absolute_filesystem_path(&path) {
        return Err(UprivError::WorkspacePathInvalid {
            path,
            detail: "workspace path must be absolute".into(),
        });
    }
    // Always reject absolute paths under any `.upriv/` tree
    // (default_root serialize / SAF without a resolvable FS root).
    if path_is_under_reserved_upriv_tree(&path) {
        return Err(UprivError::WorkspacePathReserved(path));
    }
    if let Some(root) = vault_root {
        if is_reserved_upriv_workspace_path(&path, root) {
            return Err(UprivError::WorkspacePathReserved(path));
        }
    }
    Ok(())
}

/// Validate vault `[mount].workspace_path` (`"default"` or absolute).
pub fn validate_mount_workspace_path(path: &str, vault_root: Option<&Path>) -> Result<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(WORKSPACE_PATH_DEFAULT) {
        return Ok(());
    }
    validate_workspace_global_path(trimmed, vault_root)
}

/// Normalize vault mount path: empty / `"default"` → `"default"`.
pub fn normalize_mount_workspace_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(WORKSPACE_PATH_DEFAULT) {
        WORKSPACE_PATH_DEFAULT.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Resolve mount parent (no display_name leaf). `None` when global unset + default.
///
/// On Android a SAF `content://` URI may be returned as a `PathBuf` — callers
/// must not treat that as a filesystem path on desktop.
pub fn resolve_mount_parent_path(global_path: &str, mount_workspace_path: &str) -> Option<PathBuf> {
    let mount = normalize_mount_workspace_path(mount_workspace_path);
    if mount != WORKSPACE_PATH_DEFAULT {
        return Some(PathBuf::from(mount));
    }
    let global = global_path.trim();
    if global.is_empty() {
        None
    } else {
        Some(PathBuf::from(global))
    }
}

/// Full mount point `{parent}/{display_name}` when parent is known.
pub fn resolve_vault_mount_point(
    global_path: &str,
    mount_workspace_path: &str,
    display_name: &str,
) -> Option<PathBuf> {
    let parent = resolve_mount_parent_path(global_path, mount_workspace_path)?;
    // Same display leaf rules as `VaultRoot::workspace_vault_dir`.
    let leaf = crate::paths::sanitize_display_leaf(display_name);
    Some(parent.join(leaf))
}

/// Suggested default for `[workspace].path`: `<vault_root>/workspace`.
pub fn suggested_default_workspace_path(vault_root: &Path) -> PathBuf {
    vault_root.join("workspace")
}

/// True when open needs a global workspace path (default mount + unset global).
pub fn needs_workspace_setup_on_open(global_path: &str, mount_workspace_path: &str) -> bool {
    if normalize_mount_workspace_path(mount_workspace_path) != WORKSPACE_PATH_DEFAULT {
        return false;
    }
    global_path.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_global_ok() {
        validate_workspace_global_path("", None).unwrap();
        validate_workspace_global_path("  ", None).unwrap();
    }

    #[test]
    fn relative_global_rejected() {
        let err = validate_workspace_global_path("workspace", None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathInvalid { .. }));
    }

    #[test]
    fn reserved_under_upriv() {
        let root = Path::new("/data/root");
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv/vaults"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv/logs/x"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv/workspace"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv"),
            root
        ));
        assert!(!is_reserved_upriv_workspace_path(
            Path::new("/data/root/workspace"),
            root
        ));
    }

    #[test]
    fn reserved_lexical_casefold() {
        let root = Path::new("/data/Root");
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.Upriv/Vaults"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/ROOT/.upriv/LOGS/x"),
            root
        ));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.Upriv/Vaults/x"
        )));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.upriv/workspace"
        )));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.upriv"
        )));
        let err = validate_workspace_global_path("/tmp/foo/.upriv/vaults/x", None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathReserved(_)));
        let err = validate_workspace_global_path("/tmp/foo/.upriv", None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathReserved(_)));
    }

    #[test]
    fn resolve_parent_and_point() {
        assert!(resolve_mount_parent_path("", "default").is_none());
        assert_eq!(
            resolve_mount_parent_path("/global", "default").unwrap(),
            PathBuf::from("/global")
        );
        assert_eq!(
            resolve_vault_mount_point("/global", "default", "Notes").unwrap(),
            PathBuf::from("/global/Notes")
        );
        assert_eq!(
            suggested_default_workspace_path(Path::new("/data/root")),
            PathBuf::from("/data/root/workspace")
        );
        assert!(needs_workspace_setup_on_open("", "default"));
        assert!(!needs_workspace_setup_on_open("/g", "default"));
        assert!(!needs_workspace_setup_on_open("", "/custom"));
        #[cfg(target_os = "android")]
        assert!(
            validate_workspace_global_path("content://com.android/tree/primary%3AUpriv", None)
                .is_ok()
        );
        #[cfg(not(target_os = "android"))]
        {
            let err =
                validate_workspace_global_path("content://com.android/tree/primary%3AUpriv", None)
                    .unwrap_err();
            assert!(matches!(err, UprivError::WorkspacePathInvalid { .. }));
        }
    }
}
