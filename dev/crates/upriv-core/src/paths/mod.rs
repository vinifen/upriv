use std::path::{Path, PathBuf};

use crate::config::AppSettings;
use crate::config::VaultConfig;
use crate::error::{Result, UprivError};

pub const VAULT_ROOT_SETTINGS_REL: &str = ".upriv/settings.toml";
const SETTINGS_REL: &str = VAULT_ROOT_SETTINGS_REL;

/// True when `path` contains the Upriv vault-root marker (`.upriv/settings.toml`).
pub fn is_vault_root_marker(path: impl AsRef<Path>) -> bool {
    path.as_ref().join(SETTINGS_REL).is_file()
}

/// Search upward from `start` (and one level of children at each ancestor) for a vault root.
pub fn discover_vault_root_near(start: impl AsRef<Path>) -> Option<PathBuf> {
    let start = start.as_ref().canonicalize().ok()?;
    let mut current = start;
    for _ in 0..8 {
        if is_vault_root_marker(&current) {
            return current.canonicalize().ok();
        }
        if let Ok(entries) = std::fs::read_dir(&current) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && is_vault_root_marker(&path) {
                    return path.canonicalize().ok();
                }
            }
        }
        current = current.parent()?.to_path_buf();
    }
    None
}

/// Try common launch locations: executable dir, then process cwd.
pub fn discover_vault_root_auto() -> Option<PathBuf> {
    let mut starts = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            starts.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    for start in starts {
        if let Some(found) = discover_vault_root_near(&start) {
            return Some(found);
        }
    }
    None
}

/// Canonical paths under a vault-root directory.
#[derive(Debug, Clone)]
pub struct VaultRoot {
    root: PathBuf,
}

impl VaultRoot {
    /// Open an existing vault-root (must contain `.upriv/settings.toml`).
    pub fn discover(path: impl AsRef<Path>) -> Result<Self> {
        let root = path.as_ref().canonicalize()?;
        let settings = root.join(SETTINGS_REL);
        if !settings.is_file() {
            return Err(UprivError::VaultRootNotFound(settings));
        }
        Ok(Self { root })
    }

    /// Use a vault-root path without requiring the marker (tests).
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn settings_path(&self) -> PathBuf {
        self.root.join(SETTINGS_REL)
    }

    pub fn relative_path(&self, relative: impl AsRef<Path>) -> PathBuf {
        self.root.join(relative.as_ref())
    }

    pub fn vaults_dir(&self) -> PathBuf {
        self.relative_path(".upriv/vaults")
    }

    pub fn vault_dir(&self, vault_id: &str) -> PathBuf {
        self.vaults_dir().join(vault_id)
    }

    pub fn vault_config_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("config.toml")
    }

    pub fn vault_persistence_path(&self, vault_id: &str) -> PathBuf {
        self.vault_dir(vault_id).join("persistence.json")
    }

    pub fn vault_archive_path(&self, vault: &VaultConfig) -> PathBuf {
        self.vault_dir(&vault.vault.id)
            .join(&vault.vault.vault_file)
    }

    pub fn vault_backups_dir(&self, vault: &VaultConfig) -> PathBuf {
        self.vault_dir(&vault.vault.id)
            .join(&vault.vault.backups_dir)
    }

    pub fn vault_backups_saves_dir(&self, vault: &VaultConfig) -> PathBuf {
        self.vault_backups_dir(vault).join("saves")
    }

    pub fn workspace_dir(&self, settings: &AppSettings, display_name: &str) -> PathBuf {
        self.relative_path(&settings.package.workspace_dir)
            .join(display_name)
    }

    pub fn vault_store_dir(&self, vault: &VaultConfig) -> PathBuf {
        self.vault_dir(&vault.vault.id).join(&vault.vault.store_dir)
    }

    pub fn vault_store_header_path(&self, vault: &VaultConfig) -> PathBuf {
        self.vault_store_dir(vault).join("vault.header")
    }

    pub fn runtime_lock_path(&self, vault_id: &str) -> PathBuf {
        self.relative_path(format!(".upriv/runtime/{vault_id}.lock"))
    }

    pub fn app_dir(&self, settings: &AppSettings) -> PathBuf {
        self.relative_path(&settings.package.app_dir)
    }

    pub fn logs_dir(&self, settings: &AppSettings) -> PathBuf {
        self.relative_path(&settings.package.logs_dir)
    }

    pub fn resolve_7zz_candidates(&self, settings: &AppSettings) -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        if let Ok(path) = std::env::var("UPRIV_7ZZ_PATH") {
            candidates.push(PathBuf::from(path));
        }

        let app_dir = self.app_dir(settings);
        for sub in seven_zip_bundle_subdirs() {
            let name = if cfg!(windows) { "7zz.exe" } else { "7zz" };
            candidates.push(app_dir.join(sub).join("bin").join(name));
        }

        candidates.push(PathBuf::from(if cfg!(windows) {
            "7zz.exe"
        } else {
            "7zz"
        }));
        candidates.push(PathBuf::from(if cfg!(windows) { "7z.exe" } else { "7z" }));

        candidates
    }
}

fn seven_zip_bundle_subdirs() -> &'static [&'static str] {
    if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            &["Linux-arm64"]
        } else {
            &["Linux-x64", "Linux-arm64"]
        }
    } else if cfg!(windows) {
        if cfg!(target_arch = "aarch64") {
            &["Windows-arm64"]
        } else {
            &["Windows-x64", "Windows-arm64"]
        }
    } else if cfg!(target_os = "macos") {
        &["macOS-arm64", "macOS-x64"]
    } else {
        &[]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_prod_example_root() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("prod-example");
        let root = VaultRoot::discover(&path).unwrap();
        assert!(root.settings_path().is_file());
        assert!(root.vault_config_path("plain-folder-demo").is_file());
    }

    #[test]
    fn auto_detect_finds_prod_example_from_release_exe_dir() {
        let release_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/release");
        let found = discover_vault_root_near(&release_dir).expect("prod-example near release dir");
        assert!(found.ends_with("prod-example"));
        assert!(is_vault_root_marker(&found));
    }
}
