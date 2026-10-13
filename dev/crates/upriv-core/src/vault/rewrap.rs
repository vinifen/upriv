//! Password and unlock-RAM changes for a closed vault.
//!
//! The master key stays. Chunk AAD does not bind the salt or the KDF cost, so
//! file blobs are not rewritten. The header wrap and the name index do bind
//! that material, so both are resealed. A crash must leave either the old
//! password or the new one able to open the vault.

use std::path::{Path, PathBuf};

use crate::config::{load_vault_config, save_vault_config, VaultStorageMode};
use crate::error::{Result, UprivError};
use crate::host_fs::HostFsQuery;
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{
    check_unlock_allowed, ensure_vault_session_closed, is_vault_closing_at, is_vault_open_at,
    record_unlock_failure, record_unlock_success, with_unlock_lock, with_vault_dir_lock,
    PreparingGuard,
};
use crate::store::{
    content_hash_hex, header_bytes, open_store, rewrap_header, sealed_index_bytes, VaultHeader,
    INDEX_COPY_FILE_NAME, INDEX_DIR_NAME, INDEX_FILE_NAME,
};
use crate::time::utc_timestamp_iso_millis;

use super::backup::backup_before_rewrap;
use super::persistence::{load_vault_persistence, save_vault_persistence, VaultPersistence};

/// How far [`commit_rewrap`] publishes the new header and index.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RewrapStep {
    /// New index in the copy slot. The primary index and both headers are old.
    IndexCopy,
    /// New header in the primary slot. The header copy is still the old wrap.
    HeaderPrimary,
    /// Both header files are the new wrap. The primary index is still old.
    HeaderCopy,
    /// Both header files and both index files are the new wrap.
    IndexPrimary,
}

enum RewrapKind<'a> {
    Password(&'a [u8]),
    Preset(crate::store::KdfUnlockPreset),
}

/// Rewrap `store/` under `new_password`. The unlock cost stays the one in the header.
pub fn change_vault_password(
    root: &VaultRoot,
    vault_id: &str,
    current_password: &[u8],
    new_password: &[u8],
) -> Result<()> {
    rewrap(
        root,
        vault_id,
        current_password,
        RewrapKind::Password(new_password),
    )
}

/// Rewrap `store/` at `preset`. The password stays `current_password`.
pub fn change_vault_kdf(
    root: &VaultRoot,
    vault_id: &str,
    current_password: &[u8],
    preset: crate::store::KdfUnlockPreset,
) -> Result<()> {
    rewrap(root, vault_id, current_password, RewrapKind::Preset(preset))
}

fn rewrap(
    root: &VaultRoot,
    vault_id: &str,
    current_password: &[u8],
    kind: RewrapKind<'_>,
) -> Result<()> {
    if current_password.is_empty() {
        return Err(UprivError::WrongPassword);
    }
    if let RewrapKind::Password(new_password) = &kind {
        if new_password.is_empty() {
            return Err(UprivError::WrongPassword);
        }
    }
    let vault_dir = vault_dir_or_not_found(root, vault_id)?;
    ensure_vault_session_closed(&vault_dir)?;
    let _preparing = PreparingGuard::enter_exclusive(&vault_dir)?;
    with_vault_dir_lock(&vault_dir, || {
        if is_vault_open_at(&vault_dir) || is_vault_closing_at(&vault_dir) {
            return Err(UprivError::VaultMustBeClosed);
        }
        let mut config = load_vault_config(&vault_dir)?;
        if config.storage_mode() == VaultStorageMode::UprivPlain {
            return Err(UprivError::UprivPlainUnavailable);
        }
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        let opened = with_unlock_lock(|| unlock_current(&vault_dir, &store, current_password))?;
        let master = opened.master_key.clone();
        let index_key = opened.index_key.clone();
        let index = opened.index.clone();
        let header = opened.header.clone();
        drop(opened);

        let password_change = matches!(kind, RewrapKind::Password(_));
        let (memory_kib, time_cost, parallelism, next_password) = match kind {
            RewrapKind::Password(new_password) => {
                if new_password == current_password {
                    return Err(unchanged());
                }
                (
                    header.kdf.memory_kib,
                    header.kdf.time_cost,
                    header.kdf.parallelism,
                    new_password,
                )
            }
            RewrapKind::Preset(preset) => {
                if preset.memory_kib() == header.kdf.memory_kib
                    && preset.time_cost() == header.kdf.time_cost
                    && preset.parallelism() == header.kdf.parallelism
                {
                    return Err(unchanged());
                }
                (
                    preset.memory_kib(),
                    preset.time_cost(),
                    preset.parallelism(),
                    current_password,
                )
            }
        };

        // Zip the current body before any header byte changes. A failure here
        // leaves `store/` as it was.
        if backup_before_rewrap(root, vault_id).is_err() {
            log_event(
                LogLevel::Warn,
                "vault_rewrap_backup_failed",
                &[("id", vault_id)],
            );
            return Err(UprivError::VaultBackupFailed);
        }

        let next_header = with_unlock_lock(|| {
            rewrap_header(
                &header,
                &master,
                next_password,
                memory_kib,
                time_cost,
                parallelism,
            )
        })?;
        let index_bytes = sealed_index_bytes(&next_header, &index_key, &index)?;
        let header_file = header_bytes(&next_header)?;
        commit_rewrap(&store, &header_file, &index_bytes, RewrapStep::IndexPrimary)?;
        let hash = content_hash_hex(&store)?;
        write_content_hash(&vault_dir, vault_id, &config.vault.display_name, &hash)?;
        if password_change {
            config.security.password_changed_at = Some(utc_timestamp_iso_millis());
            save_vault_config(&vault_dir, &config)?;
        }
        let event = if password_change {
            "vault_password_changed"
        } else {
            "vault_unlock_ram_changed"
        };
        log_event(LogLevel::Info, event, &[("id", vault_id)]);
        Ok(())
    })
}

fn vault_dir_or_not_found(root: &VaultRoot, vault_id: &str) -> Result<PathBuf> {
    let dir = root.vault_dir(vault_id)?;
    if !dir.host_is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    Ok(dir)
}

fn unchanged() -> UprivError {
    UprivError::VaultConfigInvalid {
        path: PathBuf::from("vault.header"),
        detail: "rewrap changes nothing".into(),
    }
}

fn unlock_current(
    vault_dir: &Path,
    store: &Path,
    password: &[u8],
) -> Result<crate::store::OpenedStore> {
    check_unlock_allowed(vault_dir)?;
    match open_store(store, password) {
        Ok(opened) => {
            record_unlock_success(vault_dir);
            Ok(opened)
        }
        Err(UprivError::WrongPassword) => {
            let _ = record_unlock_failure(vault_dir);
            Err(UprivError::WrongPassword)
        }
        Err(error) => Err(error),
    }
}

fn write_content_hash(
    vault_dir: &Path,
    vault_id: &str,
    display_name: &str,
    hash: &str,
) -> Result<()> {
    let mut persistence = load_vault_persistence(vault_dir)?.unwrap_or_else(|| {
        VaultPersistence::closed(vault_id.to_string(), display_name.to_string(), None)
    });
    persistence.vault_id = vault_id.to_string();
    persistence.display_name = display_name.to_string();
    persistence.content_hash = Some(hash.to_string());
    persistence.persistence = "closed".to_string();
    save_vault_persistence(vault_dir, &persistence)
}

/// Publish a resealed header and index without a window where both copies of
/// both files fail to open.
///
/// 1. Index copy only. Open still uses the old header and the old primary index,
///    and heals the copy back.
/// 2. Header primary. The old password still opens the header copy and rolls
///    the primary back. The new password opens the primary and finishes the
///    index from its copy.
/// 3. Header copy. Only the new password works. Open repairs the primary index.
/// 4. Index primary, so the two index files match without waiting for that repair.
pub(crate) fn commit_rewrap(
    store: &Path,
    header: &[u8],
    index: &[u8],
    through: RewrapStep,
) -> Result<()> {
    let steps = [
        RewrapStep::IndexCopy,
        RewrapStep::HeaderPrimary,
        RewrapStep::HeaderCopy,
        RewrapStep::IndexPrimary,
    ];
    for step in steps {
        let path = match step {
            RewrapStep::IndexCopy => store.join(INDEX_DIR_NAME).join(INDEX_COPY_FILE_NAME),
            RewrapStep::HeaderPrimary => VaultHeader::path(store),
            RewrapStep::HeaderCopy => VaultHeader::copy_path(store),
            RewrapStep::IndexPrimary => store.join(INDEX_DIR_NAME).join(INDEX_FILE_NAME),
        };
        let bytes = match step {
            RewrapStep::IndexCopy | RewrapStep::IndexPrimary => index,
            RewrapStep::HeaderPrimary | RewrapStep::HeaderCopy => header,
        };
        crate::paths::write_bytes_atomic(&path, bytes)?;
        if step == through {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::Path;

    use super::*;
    use crate::host_fs::HostFsQuery;
    use crate::store::{
        read_logical_file, seed_plaintext, KdfUnlockPreset, DATA_DIR_NAME, SEED_LOGICAL_PATH,
    };
    use crate::test_support::vault_root_with;
    use crate::vault::{close_vault, create_vault, list_backups, open_vault};

    const OLD: &[u8] = b"pass-word-ok";
    const NEW: &[u8] = b"next-pass-ok";

    fn sample_config(id: &str, name: &str) -> crate::config::VaultConfig {
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

    fn data_files(store: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        let data = store.join(DATA_DIR_NAME);
        for entry in crate::host_fs::read_dir(&data).expect("data dir") {
            let entry = entry.expect("entry");
            if !entry.file_type().expect("type").host_is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            out.insert(name, crate::host_fs::read(&entry.path()).expect("blob"));
        }
        out
    }

    fn copy_tree(src: &Path, dst: &Path) {
        crate::host_fs::create_dir_all(dst).unwrap();
        for entry in crate::host_fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let to = dst.join(entry.file_name());
            let kind = entry.file_type().unwrap();
            if kind.host_is_dir() {
                copy_tree(&entry.path(), &to);
            } else if kind.host_is_file() {
                crate::host_fs::write(&to, &crate::host_fs::read(&entry.path()).unwrap()).unwrap();
            }
        }
    }

    #[test]
    fn password_change_keeps_files_and_the_master_key() {
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.backup.enabled = false;
        create_vault(&root, config, OLD, KdfUnlockPreset::M32).unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        let before = open_store(&store, OLD).unwrap();
        let master = before.master_key.clone();
        let identity = before.header.content_identity;
        let salt = before.header.kdf.salt_b64.clone();
        let blobs = data_files(&store);
        drop(before);

        let same = change_vault_password(&root, "notes", OLD, OLD);
        assert!(matches!(same, Err(UprivError::VaultConfigInvalid { .. })));
        assert!(list_backups(&root, "notes").unwrap().is_empty());

        change_vault_password(&root, "notes", OLD, NEW).unwrap();
        assert_eq!(data_files(&store), blobs);
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
        let after = open_store(&store, NEW).unwrap();
        assert_eq!(after.master_key.as_ref(), master.as_ref());
        assert_eq!(after.header.content_identity, identity);
        assert_ne!(after.header.kdf.salt_b64, salt);
        assert_eq!(
            after.header.kdf.memory_kib,
            KdfUnlockPreset::M32.memory_kib()
        );
        let plain = read_logical_file(
            &store,
            &after.header,
            &after.content_key,
            &after.index,
            SEED_LOGICAL_PATH,
        )
        .unwrap();
        assert_eq!(plain, seed_plaintext(identity));
        assert!(open_store(&store, OLD).is_err());
        let saved = load_vault_config(&vault_dir).unwrap();
        assert!(saved.security.password_changed_at.is_some());
        let persistence = load_vault_persistence(&vault_dir).unwrap().unwrap();
        assert_eq!(
            persistence.content_hash.as_deref(),
            Some(content_hash_hex(&store).unwrap().as_str())
        );
    }

    #[test]
    fn unlock_ram_change_keeps_the_password_and_the_files() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            OLD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        let blobs = data_files(&store);
        let same = change_vault_kdf(&root, "notes", OLD, KdfUnlockPreset::M32);
        assert!(matches!(same, Err(UprivError::VaultConfigInvalid { .. })));
        assert!(list_backups(&root, "notes").unwrap().is_empty());

        change_vault_kdf(&root, "notes", OLD, KdfUnlockPreset::M64).unwrap();
        assert_eq!(data_files(&store), blobs);
        assert!(!list_backups(&root, "notes").unwrap().is_empty());
        let after = open_store(&store, OLD).unwrap();
        assert_eq!(
            after.header.kdf.memory_kib,
            KdfUnlockPreset::M64.memory_kib()
        );
        assert_eq!(after.header.kdf.time_cost, KdfUnlockPreset::M64.time_cost());
        let plain = read_logical_file(
            &store,
            &after.header,
            &after.content_key,
            &after.index,
            SEED_LOGICAL_PATH,
        )
        .unwrap();
        assert_eq!(plain, seed_plaintext(after.header.content_identity));
        let saved = load_vault_config(&vault_dir).unwrap();
        assert!(saved.security.password_changed_at.is_none());
    }

    #[test]
    fn wrong_password_and_the_unlock_limit_leave_the_store() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            OLD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        let header = crate::host_fs::read(&VaultHeader::path(&store)).unwrap();
        let wrong = change_vault_password(&root, "notes", b"nope", NEW);
        assert!(matches!(wrong, Err(UprivError::WrongPassword)));
        assert_eq!(
            crate::host_fs::read(&VaultHeader::path(&store)).unwrap(),
            header
        );
        assert!(list_backups(&root, "notes").unwrap().is_empty());
        for _ in 0..4 {
            let _ = record_unlock_failure(&vault_dir);
        }
        let blocked = change_vault_password(&root, "notes", OLD, NEW);
        assert!(matches!(
            blocked,
            Err(UprivError::VaultUnlockBlocked { .. })
        ));
        assert_eq!(
            crate::host_fs::read(&VaultHeader::path(&store)).unwrap(),
            header
        );
    }

    #[test]
    fn an_open_vault_is_not_rewrapped() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            OLD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", OLD).unwrap();
        let err = change_vault_password(&root, "notes", OLD, NEW);
        assert!(matches!(err, Err(UprivError::VaultMustBeClosed)));
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn a_failed_backup_leaves_the_current_password() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            OLD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let backups = vault_dir.join("backups");
        if backups.host_is_dir() {
            crate::host_fs::remove_dir_all(&backups).unwrap();
        }
        crate::host_fs::write(&backups, b"not-a-directory").unwrap();
        let err = change_vault_password(&root, "notes", OLD, NEW);
        assert!(matches!(err, Err(UprivError::VaultBackupFailed)));
        open_store(&vault_dir.join(crate::paths::STORE_DIR_NAME), OLD).unwrap();
    }

    #[test]
    fn a_partial_commit_still_opens_with_one_password() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            OLD,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let store = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME);
        let opened = open_store(&store, OLD).unwrap();
        let salt = opened.header.kdf.salt_b64.clone();
        let identity = opened.header.content_identity;
        let next = rewrap_header(
            &opened.header,
            &opened.master_key,
            NEW,
            opened.header.kdf.memory_kib,
            opened.header.kdf.time_cost,
            opened.header.kdf.parallelism,
        )
        .unwrap();
        let index_bytes = sealed_index_bytes(&next, &opened.index_key, &opened.index).unwrap();
        let header_file = header_bytes(&next).unwrap();
        drop(opened);

        let vault_dir = store.parent().expect("vault dir");
        let index_only = vault_dir.join("store-index-only");
        let header_primary = vault_dir.join("store-header-primary");
        let header_copy = vault_dir.join("store-header-copy");
        copy_tree(&store, &index_only);
        copy_tree(&store, &header_primary);
        copy_tree(&store, &header_copy);

        commit_rewrap(
            &index_only,
            &header_file,
            &index_bytes,
            RewrapStep::IndexCopy,
        )
        .unwrap();
        let rolled = open_store(&index_only, OLD).unwrap();
        assert_eq!(rolled.header.kdf.salt_b64, salt);
        assert_eq!(
            read_logical_file(
                &index_only,
                &rolled.header,
                &rolled.content_key,
                &rolled.index,
                SEED_LOGICAL_PATH,
            )
            .unwrap(),
            seed_plaintext(identity)
        );

        commit_rewrap(
            &header_primary,
            &header_file,
            &index_bytes,
            RewrapStep::HeaderPrimary,
        )
        .unwrap();
        let still_old = open_store(&header_primary, OLD).unwrap();
        assert_eq!(still_old.header.kdf.salt_b64, salt);

        commit_rewrap(
            &header_copy,
            &header_file,
            &index_bytes,
            RewrapStep::HeaderCopy,
        )
        .unwrap();
        let committed = open_store(&header_copy, NEW).unwrap();
        assert_eq!(committed.header.content_identity, identity);
        assert_ne!(committed.header.kdf.salt_b64, salt);
        assert_eq!(
            read_logical_file(
                &header_copy,
                &committed.header,
                &committed.content_key,
                &committed.index,
                SEED_LOGICAL_PATH,
            )
            .unwrap(),
            seed_plaintext(identity)
        );
        assert!(matches!(
            open_store(&header_copy, OLD),
            Err(UprivError::WrongPassword)
        ));
    }
}
