//! Vault domain: list / open / close / recovery (SDD §4.2 `vault/`).
//!
//! Daemon and UI adapters call into this module; they must not reimplement vault I/O.
//!
//! Current surface: scan vault directories + load `config.toml` (crate-internal until
//! `vault_list` RPC exists — do not expose password_hint or list entries on the wire yet).

use std::path::PathBuf;

use crate::config::vault_config::{load_vault_config_raw, VaultConfig, VaultStorageMode};
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
/// are **skipped** and reported on stderr. Invalid `[mount]` is logged as a warning
/// but the vault is still listed (strict mount validation runs on open/save).
/// Sort is by `[vault].order` ascending, then `display_name` (casefold), then `id`
/// (casefold) for a stable tie-break.
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
        match load_vault_config_raw(&vault_dir) {
            Ok(config) => {
                // Warn on bad mount but keep the entry (open/save validates fully).
                if let Err(error) = crate::paths::validate_mount_workspace_path(
                    &config.mount.workspace_path,
                    Some(root.root()),
                ) {
                    let id = config.vault.id.as_str();
                    eprintln!(
                        "upriv-core: vault {id} has invalid [mount] (listed anyway): {error}"
                    );
                    crate::logging::log_event(
                        crate::logging::LogLevel::Warn,
                        "vault_mount_invalid",
                        &[("id", id)],
                    );
                }
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
                let id = vault_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("?");
                eprintln!(
                    "upriv-core: skipping vault dir {}: {error}",
                    vault_dir.display()
                );
                crate::logging::log_event(
                    crate::logging::LogLevel::Warn,
                    "vault_skipped",
                    &[("id", id)],
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
    use crate::test_support::{vault_root_with, VaultSpec};

    #[test]
    fn lists_vaults_sorted_by_order() {
        let (_tmp, root) = vault_root_with(&[
            VaultSpec::upriv_plain("plain-folder-demo", "Plain Folder Demo", 3),
            VaultSpec::encrypted("my-encrypted-notes", "My Encrypted Notes", 4),
        ]);
        let entries = list_vault_entries(&root).expect("list");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "plain-folder-demo");
        assert_eq!(entries[0].storage_mode, VaultStorageMode::UprivPlain);
        assert_eq!(entries[1].id, "my-encrypted-notes");
        assert_eq!(entries[1].storage_mode, VaultStorageMode::EncryptedDir);
        for window in entries.windows(2) {
            assert!(
                window[0].order <= window[1].order,
                "not sorted by order: {} then {}",
                window[0].id,
                window[1].id
            );
        }
    }

    #[test]
    fn list_skips_invalid_storage_mode_vaults() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("good", "Good", 1)]);
        let bad = root.vault_dir("bad-demo").unwrap();
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(
            bad.join("config.toml"),
            r#"
[vault]
id = "bad-demo"
display_name = "Bad"
[storage]
mode = "plain_only"
"#,
        )
        .unwrap();
        let entries = list_vault_entries(&root).expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "good");
    }

    #[test]
    fn list_includes_vault_with_relative_mount() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::encrypted("good", "Good", 1)]);
        let bad_mount = root.vault_dir("rel-mount").unwrap();
        std::fs::create_dir_all(&bad_mount).unwrap();
        std::fs::write(
            bad_mount.join("config.toml"),
            r#"
[vault]
id = "rel-mount"
display_name = "Relative Mount"
[storage]
mode = "encrypted_dir"
[mount]
workspace_path = "not/absolute"
"#,
        )
        .unwrap();
        let entries = list_vault_entries(&root).expect("list");
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|e| e.id == "rel-mount"));
        assert!(entries.iter().any(|e| e.id == "good"));
    }
}
