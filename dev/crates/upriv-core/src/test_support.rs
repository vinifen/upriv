//! Tempfile vault-root fixtures for crate tests.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

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
    crate::host_fs::create_dir_all(&dir).unwrap();
    crate::host_fs::write(dir.join("config.toml"), spec.to_toml()).unwrap();
    dir
}

/// Minimal discoverable vault-root with the given vaults.
pub fn vault_root_with(specs: &[VaultSpec]) -> (TempDir, VaultRoot) {
    let tmp = TempDir::new().unwrap();
    let root_path = tmp.path();
    let vaults_dir = root_path.join(".upriv/vaults");
    crate::host_fs::create_dir_all(&vaults_dir).unwrap();
    crate::host_fs::write(
        root_path.join(".upriv/settings.toml"),
        "[package]\nversion = 1\n",
    )
    .unwrap();
    for spec in specs {
        write_vault_dir(&vaults_dir, spec);
    }
    let root = VaultRoot::discover(root_path).unwrap();
    (tmp, root)
}

/// Write `ui_path` in the open vault, making the folders above it first the
/// way the file manager does: a write refuses a folder that is not there.
pub fn write_with_folders(root: &VaultRoot, vault_id: &str, ui_path: &str, bytes: &[u8]) {
    let parts: Vec<&str> = ui_path.trim_matches('/').split('/').collect();
    let mut parent = "/".to_string();
    for name in &parts[..parts.len() - 1] {
        parent = crate::vault::fs_ensure_folder(root, vault_id, &parent, name)
            .unwrap()
            .0;
    }
    crate::vault::fs_write_file(root, vault_id, ui_path, bytes).unwrap();
}

/// A job id no other test uses. Jobs share one process-wide registry.
pub fn test_job_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!("test-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}
