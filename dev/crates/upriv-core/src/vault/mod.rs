//! Vault domain: list / create / open / close (SDD §4.2 `vault/`).
//!
//! Daemon and UI adapters call into this module; they must not reimplement vault I/O.

mod backup;
mod create;
mod delete;
mod export;
pub(crate) mod fs;
mod import;
mod open_close;
mod persistence;
mod rename;
mod seven_zip;
mod seven_zip_pack;
mod wipe;
mod zip_io;

use std::collections::HashSet;
use std::path::PathBuf;

use crate::config::vault_config::{load_vault_config_raw, VaultConfig, VaultStorageMode};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::runtime_state::{dirty_close_ids, sweep_stale_mount_leaves};
use crate::session::is_vault_open_at;
use crate::store::{probe_unlock_preset, KdfUnlockPreset};

pub use backup::{
    backup_on_close, backup_zip_file, delete_backups, export_backups_to_path, list_backups,
    promote_backup_save, read_backup_zip_bytes, BackupEntry,
};
pub use create::create_vault;
pub use delete::delete_vault;
pub use export::{
    export_logical_seven_zip, export_logical_seven_zip_to_path, export_store_zip,
    export_store_zip_to_path, probe_export_password,
};
pub use fs::{
    fs_create_file, fs_create_folder, fs_delete, fs_ensure_folder, fs_import_from_os_path,
    fs_list_tree, fs_mkdir, fs_move, fs_os_path, fs_read_file, fs_read_range, fs_rename,
    fs_tree_revision, fs_truncate, fs_write_file, fs_write_from_reader, fs_write_range,
};
pub use import::{
    import_from_backup, import_store_from_archive_path, import_store_tree, import_store_zip,
    parse_backup_import_path, read_import_archive_bytes,
};
pub use open_close::{close_all_vaults, close_vault, open_vault, CloseVaultOutcome};
pub use persistence::{load_vault_persistence, VaultPersistence};
pub use rename::{rename_vault, VaultRenameResult};
pub use seven_zip::{import_logical_seven_zip, probe_logical_seven_zip};
pub use seven_zip_pack::seven_zip_export_available;
pub use zip_io::{
    probe_store_zip, probe_store_zip_path, zip_directory_to_bytes, zip_directory_to_path,
};

/// Wire DTO for `vault_list`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultListItem {
    pub id: String,
    pub display_name: String,
    pub session: Option<&'static str>,
    pub storage_mode: VaultStorageMode,
    pub order: i64,
    pub password_hint: String,
    pub hidden: bool,
    pub note: String,
    pub last_accessed_at: Option<String>,
    pub unlock_preset: Option<KdfUnlockPreset>,
}

/// One vault under a vault-root (scan row before session/header enrichment).
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

fn persistence_last_accessed(vault_dir: &std::path::Path, id: &str) -> Option<String> {
    match persistence::load_vault_persistence(vault_dir) {
        Ok(value) => value.and_then(|p| p.last_close_ok_at),
        Err(error) => {
            eprintln!(
                "upriv-core: vault {id} has invalid persistence.json (listed anyway): {error}"
            );
            crate::logging::log_event(
                crate::logging::LogLevel::Warn,
                "vault_persistence_invalid",
                &[("id", id)],
            );
            None
        }
    }
}

fn list_item_from_entry(entry: &VaultListEntry, dirty: &HashSet<String>) -> VaultListItem {
    let last_accessed_at = persistence_last_accessed(&entry.vault_dir, &entry.id);
    let unlock_preset = probe_unlock_preset(entry.vault_dir.join(crate::paths::STORE_DIR_NAME));
    let session = if is_vault_open_at(&entry.vault_dir) {
        Some("open")
    } else if dirty.contains(&entry.id) {
        Some("recovery")
    } else {
        None
    };
    VaultListItem {
        id: entry.id.clone(),
        display_name: entry.display_name.clone(),
        session,
        storage_mode: entry.storage_mode,
        order: entry.order,
        password_hint: entry.password_hint.clone(),
        hidden: entry.hidden,
        note: entry.note.clone(),
        last_accessed_at,
        unlock_preset,
    }
}

/// Public list: scan + persistence timestamps + session + header KDF preset.
pub fn list_vaults(root: &VaultRoot) -> Result<Vec<VaultListItem>> {
    let _ = sweep_stale_mount_leaves(root);
    let dirty: HashSet<String> = dirty_close_ids(root)
        .unwrap_or_default()
        .into_iter()
        .collect();
    let entries = list_vault_entries(root)?;
    Ok(entries
        .iter()
        .map(|e| list_item_from_entry(e, &dirty))
        .collect())
}

/// One vault after a successful create — does not scan siblings.
pub fn vault_list_item(root: &VaultRoot, vault_id: &str) -> Result<VaultListItem> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let dirty: HashSet<String> = dirty_close_ids(root)
        .unwrap_or_default()
        .into_iter()
        .collect();
    let config = load_vault_config_raw(&vault_dir)?;
    Ok(list_item_from_entry(
        &VaultListEntry {
            id: config.vault.id.clone(),
            display_name: config.vault.display_name.clone(),
            order: config.vault.order,
            note: config.vault.note.clone(),
            hidden: config.vault.hidden,
            password_hint: config.vault.password_hint.clone(),
            storage_mode: config.storage_mode(),
            vault_dir,
            config,
        },
        &dirty,
    ))
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
    fn list_skips_invalid_persistence_json() {
        let (_tmp, root) = vault_root_with(&[
            VaultSpec::encrypted("good", "Good", 1),
            VaultSpec::encrypted("other", "Other", 2),
        ]);
        std::fs::write(
            root.vault_dir("good").unwrap().join("persistence.json"),
            "{not-json",
        )
        .unwrap();
        let listed = list_vaults(&root).expect("bad persistence must not fail the list");
        assert_eq!(listed.len(), 2);
        let good = listed.iter().find(|item| item.id == "good").unwrap();
        assert_eq!(good.last_accessed_at, None);
    }

    #[test]
    fn vault_list_item_reads_created_vault_without_full_list() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let item = vault_list_item(&root, "notes").expect("item");
        assert_eq!(item.id, "notes");
        assert_eq!(item.display_name, "Notes");
        assert_eq!(item.unlock_preset, Some(KdfUnlockPreset::M32));
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

    fn sample_config(id: &str, name: &str) -> VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    #[test]
    fn create_open_close_empty_vault() {
        let (_tmp, root) = vault_root_with(&[]);
        let cfg = sample_config("notes", "Notes");
        create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).expect("create");
        let listed = list_vaults(&root).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "notes");
        assert_eq!(listed[0].session, None);
        assert_eq!(listed[0].unlock_preset, Some(KdfUnlockPreset::M32));
        let store = root.vault_store_dir("notes").unwrap();
        let opened = crate::store::open_store(&store, b"pass-word-ok").expect("decrypt");
        let expected = crate::store::seed_plaintext(opened.header.content_identity);
        let got = crate::store::read_logical_file(
            &store,
            &opened.header,
            &opened.content_key,
            &opened.index,
            crate::store::SEED_LOGICAL_PATH,
        )
        .expect("seed");
        assert_eq!(got, expected);
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        let listed = list_vaults(&root).expect("list");
        assert_eq!(listed[0].session, Some("open"));
        close_vault(&root, "notes", None).expect("close");
        let listed = list_vaults(&root).expect("list");
        assert_eq!(listed[0].session, None);
        open_vault(&root, "notes", b"pass-word-ok").expect("reopen");
        close_vault(&root, "notes", None).expect("close2");
    }

    #[test]
    fn create_open_blocks_root_switch_until_close() {
        let (_tmp, root) = vault_root_with(&[]);
        let cfg = sample_config("notes", "Notes");
        create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).expect("create");
        // Do not assert idle here: parallel tests may hold UNLOCK_GATE during Argon2.
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        assert!(crate::vault_activity_blocks_root_switch());
        close_vault(&root, "notes", None).expect("close");
        // Session gone; may still be busy if another test holds the unlock gate.
        assert!(!crate::session::is_vault_open_at(
            &root.vault_dir("notes").unwrap()
        ));
    }

    #[test]
    fn always_prompt_close_is_presence_only_not_argon2() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut cfg = sample_config("notes", "Notes");
        cfg.security.mode = crate::config::VaultSecurityMode::AlwaysPrompt;
        create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).expect("create");
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        let missing = close_vault(&root, "notes", None).unwrap_err();
        assert!(matches!(missing, crate::error::UprivError::WrongPassword));
        assert!(crate::session::is_vault_open_at(
            &root.vault_dir("notes").unwrap()
        ));
        close_vault(&root, "notes", Some(b"any-non-empty")).expect("presence ok");
        assert!(!crate::session::is_vault_open_at(
            &root.vault_dir("notes").unwrap()
        ));
    }

    #[test]
    fn create_rejects_upriv_plain_until_wipe_exists() {
        let (_tmp, root) = vault_root_with(&[]);
        let cfg = toml::from_str(
            r#"
[vault]
id = "plain"
display_name = "Plain"
order = 1
[storage]
mode = "upriv_plain"
"#,
        )
        .expect("config");
        let err = create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).unwrap_err();
        assert!(matches!(
            err,
            crate::error::UprivError::UprivPlainUnavailable
        ));
        assert!(!root.vault_dir("plain").unwrap().is_dir());
    }

    #[test]
    fn open_rejects_upriv_plain_until_wipe_exists() {
        let (_tmp, root) = vault_root_with(&[VaultSpec::upriv_plain("plain", "Plain", 1)]);
        let err = open_vault(&root, "plain", b"pass-word-ok").unwrap_err();
        assert!(matches!(
            err,
            crate::error::UprivError::UprivPlainUnavailable
        ));
    }

    #[test]
    fn create_persists_trimmed_vault_id() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("  notes  ", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .expect("create");
        let listed = list_vaults(&root).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "notes");
        let looked_up = vault_list_item(&root, "  notes  ").expect("lookup padded id");
        assert_eq!(looked_up.id, "notes");
        let saved =
            crate::config::load_vault_config_raw(root.vault_dir("notes").unwrap()).expect("config");
        assert_eq!(saved.vault.id, "notes");
    }

    #[test]
    fn create_rejects_duplicate_id() {
        let (_tmp, root) = vault_root_with(&[]);
        let cfg = sample_config("notes", "Notes");
        create_vault(&root, cfg.clone(), b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let err = create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).unwrap_err();
        assert!(matches!(
            err,
            crate::error::UprivError::VaultAlreadyExists(_)
        ));
    }

    #[test]
    fn open_wrong_password() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        crate::session::clear_throttle_key_for_tests(&root.vault_dir("notes").unwrap());
        let err = open_vault(&root, "notes", b"nope-nope-n").unwrap_err();
        assert!(matches!(err, crate::error::UprivError::WrongPassword));
    }

    #[test]
    fn surface_throttle_blocks_open_vault_then_resets_on_process_maps() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let notes = root.vault_dir("notes").unwrap();
        crate::session::clear_throttle_key_for_tests(&notes);
        for i in 0..4 {
            let err = open_vault(&root, "notes", b"nope-nope-n").unwrap_err();
            assert!(
                matches!(err, crate::error::UprivError::WrongPassword),
                "attempt {i}: {err:?}"
            );
        }
        let fifth = open_vault(&root, "notes", b"nope-nope-n").unwrap_err();
        assert!(
            matches!(fifth, crate::error::UprivError::WrongPassword),
            "fifth attempt is still WrongPassword (block starts on the next check): {fifth:?}"
        );
        let sixth = open_vault(&root, "notes", b"nope-nope-n").unwrap_err();
        assert!(
            matches!(sixth, crate::error::UprivError::VaultUnlockBlocked { .. }),
            "sixth must be blocked without another useful guess: {sixth:?}"
        );
        crate::session::clear_throttle_key_for_tests(&notes);
        open_vault(&root, "notes", b"pass-word-ok")
            .expect("clearing process RAM throttle is a full bypass");
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn open_store_bypasses_surface_throttle() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let notes = root.vault_dir("notes").unwrap();
        crate::session::clear_throttle_key_for_tests(&notes);
        for _ in 0..5 {
            let _ = open_vault(&root, "notes", b"nope-nope-n");
        }
        assert!(
            matches!(
                open_vault(&root, "notes", b"nope-nope-n"),
                Err(crate::error::UprivError::VaultUnlockBlocked { .. })
            ),
            "official open must be blocked"
        );
        let store = root.vault_store_dir("notes").unwrap();
        assert!(
            crate::store::open_store(&store, b"nope-nope-n").is_err(),
            "still wrong password"
        );
        crate::store::open_store(&store, b"pass-word-ok")
            .expect("direct store open ignores in-app throttle");
    }

    #[test]
    fn copied_vault_id_has_separate_throttle_bucket() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let notes = root.vault_dir("notes").unwrap();
        crate::session::clear_throttle_key_for_tests(&notes);
        for _ in 0..5 {
            let _ = open_vault(&root, "notes", b"nope-nope-n");
        }
        assert!(matches!(
            open_vault(&root, "notes", b"nope-nope-n"),
            Err(crate::error::UprivError::VaultUnlockBlocked { .. })
        ));

        let alias_dir = root.vaults_dir().join("notes2");
        copy_tree(&notes, &alias_dir);
        let cfg = alias_dir.join("config.toml");
        let rewritten = std::fs::read_to_string(&cfg)
            .unwrap()
            .replace("id = \"notes\"", "id = \"notes2\"");
        std::fs::write(&cfg, rewritten).unwrap();

        open_vault(&root, "notes2", b"pass-word-ok")
            .expect("same ciphertext under a new folder id is a new throttle key (in-app only)");
        close_vault(&root, "notes2", None).unwrap();
    }

    fn copy_tree(src: &std::path::Path, dst: &std::path::Path) {
        std::fs::create_dir_all(dst).unwrap();
        for entry in std::fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let to = dst.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &to);
            } else {
                std::fs::copy(entry.path(), to).unwrap();
            }
        }
    }
}
