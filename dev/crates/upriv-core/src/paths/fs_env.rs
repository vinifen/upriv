//! Shared filesystem / env helpers for vault-root path resolution.
//!
//! Keeps write-probe, AppImage, and path-equality logic in one place so
//! `resolve` and `distribution` cannot drift (e.g. macOS `.app` bundles).

use std::path::{Path, PathBuf};

/// Create+delete a probe file — more reliable than `W_OK` alone for `/opt`-style mounts.
///
/// Never call on a path inside a macOS `.app` bundle (see [`is_inside_macos_app_bundle`]).
/// Leftover probes (e.g. kill -9 between create and unlink) are cleaned by
/// [`cleanup_stale_write_probes`].
pub(crate) fn dir_is_writable(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    if is_inside_macos_app_bundle(dir) {
        return false;
    }
    let probe = dir.join(format!(
        ".upriv-write-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    // RAII: remove probe on drop even if we panic between create and unlink.
    struct ProbeFile(PathBuf);
    impl Drop for ProbeFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(file) => {
            drop(file);
            let _guard = ProbeFile(probe);
            true
        }
        Err(_) => false,
    }
}

/// Best-effort remove leftover `.upriv-write-probe-*` files (kill -9 mid-probe).
pub(crate) fn cleanup_stale_write_probes(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with(".upriv-write-probe-") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// True when `path` lies under a macOS application bundle (`Something.app/Contents/…`).
///
/// Electron walks up to the directory that *contains* the `.app`; Rust must never
/// write probes or store portable data inside a signed bundle.
pub(crate) fn is_inside_macos_app_bundle(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.contains(".app/Contents/") || s.contains(".app\\Contents\\")
}

/// Preferred folder for “create structure here” / auto search / alias home.
/// Electron `--dev` sets `UPRIV_DEFAULT_ROOT_ANCHOR` to `upriv/dev/`.
/// Relative values are ignored (must be absolute).
pub fn env_default_root_anchor() -> Option<PathBuf> {
    std::env::var_os("UPRIV_DEFAULT_ROOT_ANCHOR").and_then(|value| {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() || !path.is_absolute() {
            None
        } else {
            Some(path)
        }
    })
}

/// Absolute path of the AppImage file when `$APPIMAGE` names an existing file.
pub(crate) fn env_appimage_file() -> Option<PathBuf> {
    std::env::var_os("APPIMAGE").and_then(|value| {
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() || !path.is_file() {
            return None;
        }
        Some(path)
    })
}

/// Parent directory of the AppImage file when running under AppImageKit (`$APPIMAGE`).
pub(crate) fn env_appimage_dir() -> Option<PathBuf> {
    env_appimage_file().and_then(|path| {
        path.parent()
            .map(Path::to_path_buf)
            .filter(|p| !p.as_os_str().is_empty())
    })
}

/// Compare directories after canonicalize; falls back to lexical equality when canonicalize fails.
pub(crate) fn same_dir(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_macos_app_bundle_paths() {
        assert!(is_inside_macos_app_bundle(Path::new(
            "/Applications/Upriv.app/Contents/MacOS"
        )));
        assert!(is_inside_macos_app_bundle(Path::new(
            "/Users/x/Desktop/Upriv.app/Contents/MacOS/upriv-daemon"
        )));
        assert!(!is_inside_macos_app_bundle(Path::new(
            "/Applications/Upriv/Contents/MacOS"
        )));
        assert!(!is_inside_macos_app_bundle(Path::new("/opt/upriv")));
    }

    #[test]
    fn same_dir_lexical_fallback() {
        let a = Path::new("/tmp/upriv-test-a");
        let b = Path::new("/tmp/upriv-test-a");
        assert!(same_dir(a, b));
    }
}
