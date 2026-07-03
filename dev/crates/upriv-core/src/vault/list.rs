use serde::{Deserialize, Serialize};

use crate::config::{
    load_vault_config, PersistenceState, StorageMode, VaultConfig, VaultPersistence,
};
use crate::error::Result;
use crate::paths::VaultRoot;

/// Row returned by vault discovery (maps to desktop `VaultRow` / `VaultListItem`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultListRow {
    pub id: String,
    pub display_name: String,
    pub persistence: String,
    pub session: Option<String>,
    pub storage_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hint: Option<String>,
    pub can_seal: bool,
    #[serde(default)]
    pub hidden: bool,
    pub note: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<String>,
}

/// Persist a new display order by rewriting `[vault] order` on each config (1-based).
///
/// Ids are assigned `order = position + 1` in the given sequence; any vault not
/// listed keeps its existing order bumped after the explicitly ordered ones.
pub fn reorder_vaults(root: &VaultRoot, ordered_ids: &[String]) -> Result<()> {
    for (index, vault_id) in ordered_ids.iter().enumerate() {
        let mut config = match load_vault_config(root, vault_id) {
            Ok(config) => config,
            Err(_) => continue,
        };
        let new_order = (index as u32) + 1;
        if config.vault.order != Some(new_order) {
            config.vault.order = Some(new_order);
            crate::config::save_vault_config(root, vault_id, &config)?;
        }
    }
    Ok(())
}

pub fn list_vaults(root: &VaultRoot) -> Result<Vec<VaultListRow>> {
    let ids = crate::config::discover_vault_ids(root)?;
    let mut rows = Vec::with_capacity(ids.len());
    for vault_id in ids {
        rows.push(build_row(root, &vault_id)?);
    }
    rows.sort_by(|a, b| {
        a.order
            .unwrap_or(u32::MAX)
            .cmp(&b.order.unwrap_or(u32::MAX))
            .then_with(|| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()))
    });
    Ok(rows)
}

fn build_row(root: &VaultRoot, vault_id: &str) -> Result<VaultListRow> {
    let config = load_vault_config(root, vault_id)?;
    let persistence = load_persistence(root, vault_id, &config);
    let is_open = root.runtime_lock_path(vault_id).is_file();
    let in_recovery = !is_open && crate::vault::recovery::needs_recovery(root, vault_id)?;

    let storage_mode = storage_mode_str(&config.storage.mode);
    let persistence_str = persistence_label(&config.storage.mode, &persistence.persistence);
    let session = if is_open {
        Some("open".to_string())
    } else if in_recovery {
        Some("recovery".to_string())
    } else {
        None
    };

    // encrypted_dir can be sealed while open, or directly from `closed` (drop the
    // store cache, leaving only the portable `.7z`). A sealed/recovery vault cannot.
    let can_seal = config.storage.mode == StorageMode::EncryptedDir
        && !in_recovery
        && (is_open || persistence.persistence == PersistenceState::Closed);

    Ok(VaultListRow {
        id: config.vault.id.clone(),
        display_name: config.vault.display_name.clone(),
        persistence: persistence_str,
        session,
        storage_mode,
        order: config.vault.order,
        password_hint: config.vault.password_hint.clone().filter(|s| !s.is_empty()),
        can_seal,
        hidden: config.vault.hidden,
        note: config.vault.note.clone().unwrap_or_default(),
        last_accessed_at: persistence.last_close_ok_at.clone(),
    })
}

fn load_persistence(root: &VaultRoot, vault_id: &str, config: &VaultConfig) -> VaultPersistence {
    let path = root.vault_persistence_path(vault_id);
    if path.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<VaultPersistence>(&raw) {
                return parsed;
            }
        }
    }
    VaultPersistence {
        format_version: 1,
        vault_id: config.vault.id.clone(),
        display_name: config.vault.display_name.clone(),
        sync_generation: 0,
        archive_hash: String::new(),
        last_close_ok_at: None,
        store_hash: None,
        last_store_write_at: None,
        persistence: PersistenceState::Sealed,
    }
}

fn storage_mode_str(mode: &StorageMode) -> String {
    match mode {
        StorageMode::EncryptedDir => "encrypted_dir".to_string(),
        StorageMode::Plain => "plain".to_string(),
    }
}

fn persistence_label(mode: &StorageMode, state: &PersistenceState) -> String {
    match mode {
        StorageMode::Plain => "sealed".to_string(),
        StorageMode::EncryptedDir => match state {
            PersistenceState::Closed => "closed".to_string(),
            PersistenceState::Sealed | PersistenceState::Open => "sealed".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn lists_prod_example_vaults() {
        let root = VaultRoot::discover(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .join("prod-example"),
        )
        .unwrap();
        let rows = list_vaults(&root).unwrap();
        assert!(rows.iter().any(|row| row.id == "plain-folder-demo"));
        let plain = rows
            .iter()
            .find(|row| row.id == "plain-folder-demo")
            .unwrap();
        assert_eq!(plain.storage_mode, "plain");
    }
}
