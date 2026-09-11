//! Tempfile vault-root fixtures for crate tests.
//!
//! Tests must not read `prod-example/` — that bundle is a stale layout demo.

use std::path::{Path, PathBuf};

use tempfile::TempDir;

use crate::config::VaultStorageMode;
use crate::paths::VaultRoot;

pub struct VaultSpec {
    pub id: &'static str,
    pub display_name: &'static str,
    pub order: i64,
    pub storage_mode: Option<VaultStorageMode>,
}

impl VaultSpec {
    pub fn encrypted(id: &'static str, display_name: &'static str, order: i64) -> Self {
        Self {
            id,
            display_name,
            order,
            storage_mode: Some(VaultStorageMode::EncryptedDir),
        }
    }

    pub fn upriv_plain(id: &'static str, display_name: &'static str, order: i64) -> Self {
        Self {
            id,
            display_name,
            order,
            storage_mode: Some(VaultStorageMode::UprivPlain),
        }
    }

    fn to_toml(&self) -> String {
        let storage = match self.storage_mode {
            Some(VaultStorageMode::EncryptedDir) => {
                "\n[storage]\nmode = \"encrypted_dir\"\n".to_string()
            }
            Some(VaultStorageMode::UprivPlain) => {
                "\n[storage]\nmode = \"upriv_plain\"\n".to_string()
            }
            None => String::new(),
        };
        format!(
            "{}[vault]\nid = \"{}\"\ndisplay_name = \"{}\"\norder = {}{storage}",
            crate::config::VAULT_CONFIG_TOML_GROUPS_NOTE,
            self.id,
            self.display_name,
            self.order
        )
    }
}

/// Write `vaults/<id>/config.toml` under `vaults_parent` and return the vault dir.
pub fn write_vault_dir(vaults_parent: &Path, spec: &VaultSpec) -> PathBuf {
    let dir = vaults_parent.join(spec.id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("config.toml"), spec.to_toml()).unwrap();
    dir
}

/// Minimal discoverable vault-root with the given vaults.
pub fn vault_root_with(specs: &[VaultSpec]) -> (TempDir, VaultRoot) {
    let tmp = TempDir::new().unwrap();
    let root_path = tmp.path();
    let vaults_dir = root_path.join(".upriv/vaults");
    std::fs::create_dir_all(&vaults_dir).unwrap();
    std::fs::write(
        root_path.join(".upriv/settings.toml"),
        "[package]\nvaults_dir = \".upriv/vaults\"\n",
    )
    .unwrap();
    for spec in specs {
        write_vault_dir(&vaults_dir, spec);
    }
    let root = VaultRoot::discover(root_path).unwrap();
    (tmp, root)
}
