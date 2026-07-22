//! How the desktop app was distributed — drives default vault-root placement.
//!
//! | Kind | Vault data (`default_root`) | App home (`.upriv-root` alias) |
//! |------|---------------------------|----------------------------------|
//! | **Portable** | Beside AppImage / exe | Same as vault anchor |
//! | **Installed** | User data dir (same as app home) | User data dir |
//! | **Dev** | `UPRIV_DEFAULT_ROOT_ANCHOR` / `dev/` | Same as vault anchor |
//!
//! Installed `default_root` and app home are the same path (`~/.local/share/upriv` on
//! Linux, `%LOCALAPPDATA%\Upriv` on Windows, Application Support on macOS).
//! `custom_root` mode still writes `.upriv-root` there pointing at another folder.

use std::path::PathBuf;
#[cfg(not(test))]
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::paths::fs_env::{
    dir_is_writable, env_appimage_dir, env_default_root_anchor, is_inside_macos_app_bundle,
};

pub const ENV_DISTRIBUTION: &str = "UPRIV_DISTRIBUTION";

/// Desktop distribution kind (wire + Electron env).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppDistribution {
    /// AppImage / portable exe — data beside the binary when writable.
    Portable,
    /// System package (`.deb`, NSIS, …) — data under the OS user-data home.
    Installed,
    /// Unpackaged Electron dev / `electron .`.
    Dev,
}

impl AppDistribution {
    /// Wire / env string (`"portable"` | `"installed"` | `"dev"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Portable => "portable",
            Self::Installed => "installed",
            Self::Dev => "dev",
        }
    }
}

/// Explicit wire string for JSON (prefer over relying on serde enum shape alone).
pub fn distribution_str(distribution: AppDistribution) -> &'static str {
    distribution.as_str()
}

/// Read `UPRIV_DISTRIBUTION` when set to a known value.
///
/// Unknown values (including future `flatpak` / `snap`) are ignored and fall through
/// to [`infer_app_distribution`], which usually yields [`AppDistribution::Installed`]
/// for sandboxed user-data homes — acceptable until those channels are first-class.
pub fn env_app_distribution() -> Option<AppDistribution> {
    std::env::var_os(ENV_DISTRIBUTION).and_then(|value| {
        let raw = value.to_string_lossy();
        match raw.as_ref() {
            "portable" => Some(AppDistribution::Portable),
            "installed" => Some(AppDistribution::Installed),
            "dev" => Some(AppDistribution::Dev),
            other => {
                eprintln!(
                    "upriv-core: unknown {ENV_DISTRIBUTION}={other:?}; ignoring (will infer)"
                );
                None
            }
        }
    })
}

/// Detect distribution when the shell did not set `UPRIV_DISTRIBUTION`.
pub fn infer_app_distribution() -> AppDistribution {
    if std::env::var_os("UPRIV_DEV").is_some() {
        return AppDistribution::Dev;
    }
    if let Some(anchor) = env_default_root_anchor() {
        if super::resolve::resolve_user_data_app_home()
            .ok()
            .is_some_and(|home| home == anchor)
        {
            return AppDistribution::Installed;
        }
        return AppDistribution::Portable;
    }
    if let Some(dir) = env_appimage_dir() {
        if dir_is_writable(&dir) {
            return AppDistribution::Portable;
        }
        return AppDistribution::Installed;
    }
    if let Ok(bin) = std::env::current_exe().and_then(|exe| {
        exe.parent()
            .map(std::path::Path::to_path_buf)
            .ok_or_else(|| std::io::Error::other("executable has no parent directory"))
    }) {
        // macOS .app/Contents/MacOS — never treat as portable (would probe inside bundle).
        if is_inside_macos_app_bundle(&bin) {
            return AppDistribution::Installed;
        }
        if dir_is_writable(&bin) {
            return AppDistribution::Portable;
        }
    }
    AppDistribution::Installed
}

fn compute_app_distribution() -> AppDistribution {
    env_app_distribution().unwrap_or_else(infer_app_distribution)
}

/// Effective distribution: explicit env wins, else infer.
///
/// Outside tests, the first call pins a process-wide value so `app_version` and
/// `vault_root_resolve` stay aligned for the daemon lifetime. Unit tests always
/// recompute (env is mutated under `ENV_LOCK`).
pub fn detect_app_distribution() -> AppDistribution {
    #[cfg(test)]
    {
        compute_app_distribution()
    }
    #[cfg(not(test))]
    {
        static CACHED_DISTRIBUTION: OnceLock<AppDistribution> = OnceLock::new();
        *CACHED_DISTRIBUTION.get_or_init(compute_app_distribution)
    }
}

/// Pin distribution at daemon startup (same as [`detect_app_distribution`] outside tests).
pub fn init_app_distribution() -> AppDistribution {
    detect_app_distribution()
}

/// Folder where “create default `.upriv/`” / default_root strict search runs.
///
/// Always the app home: beside the binary when portable/dev; OS user-data dir
/// when installed (`~/.local/share/upriv`, …).
pub fn default_vault_root_anchor() -> Result<PathBuf> {
    default_vault_root_anchor_for(None)
}

/// Like [`default_vault_root_anchor`], but honors test/dev `binary_dir` override.
pub fn default_vault_root_anchor_for(binary_dir: Option<&std::path::Path>) -> Result<PathBuf> {
    if let Some(dir) = binary_dir {
        return Ok(dir.to_path_buf());
    }
    // Portable, installed, and dev: default_root lives in app home.
    super::resolve::app_home_dir()
}

/// Suggested absolute path for the **`custom_root` folder picker only**.
///
/// Prefers `~/Documents/Upriv` (visible location); falls back to home/`Upriv`.
/// Not used by `default_root` resolve/search — see [`default_vault_root_anchor`].
///
/// Desktop calls this via daemon RPC `vault_root_suggested_custom_path`.
/// Does not implement Windows Known Folder / OneDrive redirects — callers that
/// need that should wire OS APIs separately.
pub fn suggested_vault_root() -> Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| {
            crate::error::UprivError::Io(std::io::Error::other(
                "cannot resolve suggested vault root (HOME / USERPROFILE unset)",
            ))
        })?;

    // Windows / macOS: ~/Documents. Linux: XDG_DOCUMENTS_DIR when absolute, else Documents.
    let documents = if cfg!(windows) || cfg!(target_os = "macos") {
        home.join("Documents")
    } else {
        std::env::var_os("XDG_DOCUMENTS_DIR")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join("Documents"))
    };

    let base = if documents.is_dir() {
        documents
    } else {
        home.clone()
    };
    Ok(base.join("Upriv"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::ENV_LOCK;
    use std::path::Path;

    #[test]
    fn distribution_str_matches_wire_tokens() {
        assert_eq!(distribution_str(AppDistribution::Portable), "portable");
        assert_eq!(distribution_str(AppDistribution::Installed), "installed");
        assert_eq!(distribution_str(AppDistribution::Dev), "dev");
        assert_eq!(AppDistribution::Installed.as_str(), "installed");
    }

    #[test]
    fn unknown_env_distribution_falls_through_to_infer() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var(ENV_DISTRIBUTION, "weird");
        std::env::remove_var("UPRIV_DEV");
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::remove_var("APPIMAGE");
        // Infer still runs; just ensure unknown does not panic / return None from detect.
        let _ = detect_app_distribution();
        std::env::remove_var(ENV_DISTRIBUTION);
    }

    #[test]
    fn suggested_vault_root_under_documents_when_present() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tempfile::tempdir().unwrap();
        let docs = home.path().join("Documents");
        std::fs::create_dir_all(&docs).unwrap();
        std::env::set_var("HOME", home.path());
        std::env::remove_var("XDG_DOCUMENTS_DIR");
        assert_eq!(suggested_vault_root().unwrap(), docs.join("Upriv"));
        std::env::remove_var("HOME");
    }

    #[test]
    fn installed_default_root_anchor_is_app_home() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = tempfile::tempdir().unwrap();
        let appdata = home.path().join("appdata");
        std::fs::create_dir_all(&appdata).unwrap();
        std::env::set_var(ENV_DISTRIBUTION, "installed");
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", &appdata);
        std::env::remove_var("APPIMAGE");
        assert_eq!(default_vault_root_anchor().unwrap(), appdata);
        std::env::remove_var(ENV_DISTRIBUTION);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
    }

    #[test]
    fn macos_app_bundle_helper_and_installed_via_user_data_anchor() {
        assert!(is_inside_macos_app_bundle(Path::new(
            "/Applications/Upriv.app/Contents/MacOS"
        )));
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var(ENV_DISTRIBUTION);
        std::env::remove_var("UPRIV_DEV");
        std::env::remove_var("APPIMAGE");
        let home = tempfile::tempdir().unwrap();
        // Match `user_data_app_home()` shape for this host OS.
        let support = if cfg!(windows) {
            let local = home.path().join("Local");
            std::fs::create_dir_all(&local).unwrap();
            std::env::set_var("LOCALAPPDATA", &local);
            local.join("Upriv")
        } else if cfg!(target_os = "macos") {
            let p = home
                .path()
                .join("Library")
                .join("Application Support")
                .join("Upriv");
            std::fs::create_dir_all(&p).unwrap();
            std::env::set_var("HOME", home.path());
            p
        } else {
            let xdg = home.path().join("xdg-data");
            std::fs::create_dir_all(&xdg).unwrap();
            std::env::set_var("XDG_DATA_HOME", &xdg);
            xdg.join("upriv")
        };
        std::fs::create_dir_all(&support).unwrap();
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", &support);
        assert_eq!(detect_app_distribution(), AppDistribution::Installed);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::remove_var("HOME");
        std::env::remove_var("XDG_DATA_HOME");
        std::env::remove_var("LOCALAPPDATA");
    }

    #[cfg(windows)]
    #[test]
    fn windows_localappdata_user_data_home_shape() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let base = tempfile::tempdir().unwrap();
        let local = base.path().join("Local");
        std::fs::create_dir_all(&local).unwrap();
        std::env::set_var("LOCALAPPDATA", &local);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::remove_var("APPIMAGE");
        let home = crate::paths::resolve::resolve_user_data_app_home().unwrap();
        assert_eq!(home, local.join("Upriv"));
        std::env::remove_var("LOCALAPPDATA");
    }

    #[cfg(unix)]
    #[test]
    fn linux_xdg_data_home_user_data_shape() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let base = tempfile::tempdir().unwrap();
        let xdg = base.path().join("xdg-data");
        std::fs::create_dir_all(&xdg).unwrap();
        std::env::set_var("XDG_DATA_HOME", &xdg);
        std::env::remove_var("UPRIV_DEFAULT_ROOT_ANCHOR");
        std::env::remove_var("APPIMAGE");
        let home = crate::paths::resolve::resolve_user_data_app_home().unwrap();
        assert_eq!(home, xdg.join("upriv"));
        std::env::remove_var("XDG_DATA_HOME");
    }
}
