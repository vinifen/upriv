//! Vault domain: list / open / close / recovery (SDD §4.2 `vault/`).
//!
//! Daemon and UI adapters call into this module; they must not reimplement vault I/O.
//!
//! Current surface: scan vault directories + load `config.toml` (crate-internal until
//! `vault_list` RPC exists — do not expose password_hint or list entries on the wire yet).

use std::path::PathBuf;

use crate::config::vault_config::{load_vault_config, VaultConfig, VaultStorageMode};
use crate::error::Result;
use crate::paths::VaultRoot;

/// One vault under a vault-root (internal until `vault_list` RPC + hint policy).
#[allow(dead_code)] // Used by unit tests; kept until `vault_list` RPC lands.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct VaultListEntry {
    pub id: String,
    pub display_name: String,
    pub order: i64,
    pub note: String,
    pub hidden: bool,
    pub password_hint: String,
    pub storage_mode: VaultStorageMode,
    /// Absolute path to `vaults/<id>/`.
    pub vault_dir: PathBuf,
    pub config: VaultConfig,
}

/// List vaults under `root` by scanning `.upriv/vaults/*/config.toml`.
///
/// Directories without a valid `config.toml` (or with `[vault].id` ≠ folder name)
/// are **skipped** and reported on stderr. Sort is by `[vault].order` ascending,
/// then `display_name` (casefold), then `id` (casefold) for a stable tie-break.
///
/// Id ↔ dirname matching is **exact** (see `vault_config`); sort casefold is display-only.
///
/// Does not read `persistence.json` or runtime state — open/close will enrich this.
/// Not on the daemon wire yet (`vault_list` RPC comes later).
#[allow(dead_code)] // Used by unit tests; kept until `vault_list` RPC lands.
pub(crate) fn list_vault_entries(root: &VaultRoot) -> Result<Vec<VaultListEntry>> {
    let vaults_dir = root.vaults_dir();
    if !vaults_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let mut skipped = 0usize;
    for entry in std::fs::read_dir(&vaults_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let vault_dir = entry.path();
        match load_vault_config(&vault_dir) {
            Ok(config) => {
                entries.push(VaultListEntry {
                    id: config.vault.id.clone(),
                    display_name: config.vault.display_name.clone(),
                    order: config.vault.order,
                    note: config.vault.note.clone(),
                    hidden: config.vault.hidden,
                    password_hint: config.vault.password_hint.clone(),
                    storage_mode: config.storage_mode(),
                    vault_dir,
                    config,
                });
            }
            Err(error) => {
                skipped += 1;
                eprintln!(
                    "upriv-core: skipping vault dir {}: {error}",
                    vault_dir.display()
                );
            }
        }
    }

    if skipped > 0 {
        eprintln!(
            "upriv-core: skipped {skipped} invalid vault dir(s) under {}",
            vaults_dir.display()
        );
    }

    entries.sort_by(|a, b| {
        a.order
            .cmp(&b.order)
            .then_with(|| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            })
            .then_with(|| a.id.to_lowercase().cmp(&b.id.to_lowercase()))
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::VaultRoot;
    use std::path::Path;

    fn prod_example_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("prod-example")
    }

    #[test]
    fn lists_prod_example_vaults() {
        let root = VaultRoot::discover(prod_example_root()).expect("prod-example root");
        let entries = list_vault_entries(&root).expect("list");
        assert!(
            entries.len() >= 2,
            "expected multiple vaults, got {}",
            entries.len()
        );
        assert!(entries.iter().any(|e| e.id == "my-encrypted-notes"));
        assert!(entries.iter().any(|e| e.id == "plain-folder-demo"));
        // Sorted by order
        for window in entries.windows(2) {
            assert!(
                window[0].order <= window[1].order,
                "not sorted by order: {} then {}",
                window[0].id,
                window[1].id
            );
        }
    }
}
