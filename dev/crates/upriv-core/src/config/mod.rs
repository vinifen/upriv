mod app;
mod vault;

pub use app::AppSettings;
pub use vault::{
    ArchiveMode, BackupMode, CloseAction, PersistenceState, SecurityMode, SecuritySection,
    SevenZipSection, StorageMode, VaultConfig, VaultPersistence, WipePattern,
};

use std::path::Path;

use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;

fn atomic_write(path: &Path, contents: &str) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| UprivError::Io(std::io::Error::other("config path has no parent")))?;
    std::fs::create_dir_all(parent)?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn write_toml_atomic<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    let raw = toml::to_string_pretty(value)?;
    atomic_write(path, &raw)
}

/// Load `.upriv/settings.toml` and validate the vault-root marker.
pub fn load_app_settings(root: &VaultRoot) -> Result<AppSettings> {
    let raw = std::fs::read_to_string(root.settings_path())?;
    let settings: AppSettings = toml::from_str(&raw)?;
    Ok(settings)
}

/// Create the standard Upriv layout in `dir` and return the opened `VaultRoot`.
///
/// Writes a default `.upriv/settings.toml` plus the canonical subfolders
/// (`vaults/`, `logs/`, `runtime/`, `app/`, `workspace/`). If the marker already
/// exists, the directory is opened as-is without overwriting any settings.
pub fn initialize_vault_root(dir: impl AsRef<Path>) -> Result<VaultRoot> {
    let dir = dir.as_ref();
    std::fs::create_dir_all(dir)?;

    let settings = AppSettings::default();
    let settings_path = dir.join(".upriv/settings.toml");

    if !settings_path.is_file() {
        write_toml_atomic(&settings_path, &settings)?;
    }

    for relative in [
        settings.package.vaults_dir.as_str(),
        settings.package.logs_dir.as_str(),
        settings.package.app_dir.as_str(),
        settings.package.workspace_dir.as_str(),
        ".upriv/runtime",
    ] {
        std::fs::create_dir_all(dir.join(relative))?;
    }

    VaultRoot::discover(dir)
}

/// Persist UI/logging/app preferences; keeps existing `[package]` on disk.
pub fn save_app_settings(root: &VaultRoot, patch: &AppSettings) -> Result<()> {
    let mut current = load_app_settings(root).unwrap_or_default();
    current.ui = patch.ui.clone();
    current.logging = patch.logging.clone();
    current.app = patch.app.clone();
    write_toml_atomic(&root.settings_path(), &current)
}

/// Persist `vaults/<vault_id>/config.toml` (full file replace).
pub fn save_vault_config(root: &VaultRoot, vault_id: &str, config: &VaultConfig) -> Result<()> {
    if config.vault.id != vault_id {
        return Err(UprivError::VaultNotFound(format!(
            "{vault_id} (id mismatch in config payload)"
        )));
    }
    let path = root.vault_config_path(vault_id);
    write_toml_atomic(&path, config)
}

/// Load `vaults/<vault_id>/config.toml`.
pub fn load_vault_config(root: &VaultRoot, vault_id: &str) -> Result<VaultConfig> {
    let path = root.vault_config_path(vault_id);
    if !path.is_file() {
        return Err(UprivError::VaultNotFound(vault_id.to_string()));
    }
    let raw = std::fs::read_to_string(&path)?;
    let config: VaultConfig = toml::from_str(&raw)?;
    if config.vault.id != vault_id {
        return Err(UprivError::VaultNotFound(format!(
            "{vault_id} (id mismatch in config.toml)"
        )));
    }
    Ok(config)
}

/// Discover vault ids by scanning `vaults/*/config.toml`.
pub fn discover_vault_ids(root: &VaultRoot) -> Result<Vec<String>> {
    let vaults_dir = root.vaults_dir();
    if !vaults_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut ids = Vec::new();
    for entry in std::fs::read_dir(&vaults_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let vault_id = entry.file_name().to_string_lossy().into_owned();
        let config_path = root.vault_config_path(&vault_id);
        if config_path.is_file() {
            ids.push(vault_id);
        }
    }
    ids.sort();
    Ok(ids)
}

/// Parse vault config from an arbitrary path (tests).
pub fn load_vault_config_file(path: &Path) -> Result<VaultConfig> {
    let raw = std::fs::read_to_string(path)?;
    Ok(toml::from_str(&raw)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::VaultRoot;

    #[test]
    fn saves_app_settings_preserving_package_section() {
        let root = VaultRoot::discover(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .join("prod-example"),
        )
        .unwrap();
        let before = load_app_settings(&root).unwrap();
        let label = before.package.label.clone();

        let mut patch = before.clone();
        patch.ui.theme = "light".to_string();
        save_app_settings(&root, &patch).unwrap();

        let after = load_app_settings(&root).unwrap();
        assert_eq!(after.ui.theme, "light");
        assert_eq!(after.package.label, label);

        patch.ui.theme = before.ui.theme.clone();
        save_app_settings(&root, &patch).unwrap();
    }

    #[test]
    fn initializes_vault_root_in_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("my drive");
        let root = initialize_vault_root(&target).unwrap();

        assert!(root.settings_path().is_file());
        assert!(root.vaults_dir().is_dir());

        let settings = load_app_settings(&root).unwrap();
        assert!(root.logs_dir(&settings).is_dir());
        assert!(root.app_dir(&settings).is_dir());
        assert!(root.relative_path(&settings.package.workspace_dir).is_dir());
        assert!(discover_vault_ids(&root).unwrap().is_empty());

        // Idempotent: re-init keeps the existing marker.
        let again = initialize_vault_root(&target).unwrap();
        assert_eq!(again.root(), root.root());
    }

    #[test]
    fn saves_vault_config_round_trip() {
        let root = VaultRoot::discover(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .join("prod-example"),
        )
        .unwrap();
        let vault_id = "plain-folder-demo";
        let before = load_vault_config(&root, vault_id).unwrap();
        let note = before.vault.note.clone();

        let mut updated = before.clone();
        updated.vault.note = Some("agent test note".to_string());
        save_vault_config(&root, vault_id, &updated).unwrap();

        let loaded = load_vault_config(&root, vault_id).unwrap();
        assert_eq!(loaded.vault.note.as_deref(), Some("agent test note"));

        save_vault_config(&root, vault_id, &before).unwrap();
        let restored = load_vault_config(&root, vault_id).unwrap();
        assert_eq!(restored.vault.note, note);
    }
}
