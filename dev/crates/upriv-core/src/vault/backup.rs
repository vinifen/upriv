//! Frozen ciphertext copies of `store/` as `backups/<stamp>.zip` (Stored, no zip password).

use std::path::{Path, PathBuf};

use crate::config::{load_vault_config, VaultBackupMode};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::time::utc_filename_stamp;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupEntry {
    pub stamp: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub saved: bool,
}

pub fn list_backups(root: &VaultRoot, vault_id: &str) -> Result<Vec<BackupEntry>> {
    let vault_dir = root.vault_dir(vault_id)?;
    if !vault_dir.is_dir() {
        return Err(UprivError::VaultNotFound(vault_dir));
    }
    let backups = vault_dir.join("backups");
    let mut entries = Vec::new();
    collect_backup_dir(&backups.join("saves"), true, &mut entries)?;
    collect_backup_dir(&backups, false, &mut entries)?;
    entries.sort_by(|a, b| b.stamp.cmp(&a.stamp));
    Ok(entries)
}

fn collect_backup_dir(dir: &Path, saved: bool, out: &mut Vec<BackupEntry>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(stamp) = stamp_from_zip_name(&name) else {
            continue;
        };
        if !entry.file_type()?.is_file() {
            continue;
        }
        if out.iter().any(|existing| existing.stamp == stamp) {
            continue;
        }
        let size = entry.metadata()?.len();
        let created_at = stamp_to_iso(&stamp).unwrap_or_default();
        out.push(BackupEntry {
            stamp,
            created_at,
            size_bytes: size,
            saved,
        });
    }
    Ok(())
}

fn stamp_from_zip_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".zip")?;
    if is_backup_stamp(stem) {
        Some(stem.to_string())
    } else {
        None
    }
}

/// Stamp embedded in `backups/<stamp>.zip` (UTC `YYYYMMDDHHmmss`).
pub(crate) fn is_backup_stamp(stamp: &str) -> bool {
    stamp.len() == 14 && stamp.bytes().all(|b| b.is_ascii_digit())
}

fn parse_backup_stamp(stamp: &str) -> Result<&str> {
    if is_backup_stamp(stamp) {
        Ok(stamp)
    } else {
        Err(UprivError::VaultPathNotFound(stamp.into()))
    }
}

fn backup_zip_path(backups: &Path, stamp: &str, saved: bool) -> Result<PathBuf> {
    let stamp = parse_backup_stamp(stamp)?;
    let path = if saved {
        backups.join("saves").join(format!("{stamp}.zip"))
    } else {
        backups.join(format!("{stamp}.zip"))
    };
    if !path.starts_with(backups) {
        return Err(UprivError::VaultPathNotFound(stamp.into()));
    }
    Ok(path)
}

pub fn backup_zip_file(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<PathBuf> {
    locate_backup_zip(root, vault_id, stamp)
}

fn stamp_to_iso(stamp: &str) -> Option<String> {
    if !is_backup_stamp(stamp) {
        return None;
    }
    Some(format!(
        "{}-{}-{}T{}:{}:{}Z",
        &stamp[0..4],
        &stamp[4..6],
        &stamp[6..8],
        &stamp[8..10],
        &stamp[10..12],
        &stamp[12..14]
    ))
}

pub fn backup_on_close(root: &VaultRoot, vault_id: &str) -> Result<Option<String>> {
    let vault_dir = root.vault_dir(vault_id)?;
    let config = load_vault_config(&vault_dir)?;
    if !config.backup.enabled {
        return Ok(None);
    }
    let backups = vault_dir.join("backups");
    std::fs::create_dir_all(&backups)?;
    let stamp = unused_backup_stamp(&backups, utc_filename_stamp())?;
    let partial = backups.join(format!("{stamp}.zip.partial"));
    let dest = backups.join(format!("{stamp}.zip"));
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    if let Err(error) = super::zip_io::zip_directory_to_path(&store, &partial) {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
    }
    if let Err(error) = std::fs::File::open(&partial).and_then(|file| file.sync_all()) {
        let _ = std::fs::remove_file(&partial);
        return Err(error.into());
    }
    if let Err(error) = std::fs::rename(&partial, &dest) {
        let _ = std::fs::remove_file(&partial);
        return Err(error.into());
    }
    // The new stamp must be durable before `prune_backups` unlinks the previous
    // one. Otherwise a crash can publish the deletion and lose the new copy.
    sync_dir(&backups)?;
    prune_backups(&vault_dir, config.backup.mode, config.backup.keep_last)?;
    sync_dir(&backups)?;
    log_event(
        LogLevel::Info,
        "vault_backup_created",
        &[("id", vault_id), ("stamp", stamp.as_str())],
    );
    Ok(Some(stamp))
}

pub fn delete_backups(root: &VaultRoot, vault_id: &str, stamps: &[String]) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    let backups = vault_dir.join("backups");
    for stamp in stamps {
        if !is_backup_stamp(stamp) {
            continue;
        }
        for saved in [false, true] {
            let zip = backup_zip_path(&backups, stamp, saved)?;
            if zip.is_file() {
                std::fs::remove_file(&zip)?;
            }
        }
    }
    Ok(())
}

pub fn promote_backup_save(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    let backups = vault_dir.join("backups");
    std::fs::create_dir_all(backups.join("saves"))?;
    let src = backup_zip_path(&backups, stamp, false)?;
    if !src.is_file() {
        return Err(UprivError::VaultPathNotFound(stamp.into()));
    }
    let dest = backup_zip_path(&backups, stamp, true)?;
    if dest.exists() {
        std::fs::remove_file(&src)?;
        return Ok(());
    }
    std::fs::rename(&src, &dest)?;
    Ok(())
}

fn locate_backup_zip(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<PathBuf> {
    let vault_dir = root.vault_dir(vault_id)?;
    let backups = vault_dir.join("backups");
    for saved in [true, false] {
        let zip = backup_zip_path(&backups, stamp, saved)?;
        if zip.is_file() {
            return Ok(zip);
        }
    }
    Err(UprivError::VaultPathNotFound(stamp.into()))
}

/// One snapshot becomes its `.zip` at `dest`. Several become one zip of those files.
pub fn export_backups_to_path(
    root: &VaultRoot,
    vault_id: &str,
    stamps: &[String],
    dest: &Path,
) -> Result<u64> {
    if stamps.is_empty() {
        return Err(UprivError::VaultPathNotFound(dest.display().to_string()));
    }
    if stamps.len() == 1 {
        return write_one_backup_zip(root, vault_id, &stamps[0], dest);
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    for stamp in stamps {
        if !seen.insert(stamp.clone()) {
            continue;
        }
        let path = locate_backup_zip(root, vault_id, stamp)?;
        entries.push((format!("{stamp}.zip"), path));
    }
    let borrowed: Vec<(String, &Path)> = entries
        .iter()
        .map(|(name, path)| (name.clone(), path.as_path()))
        .collect();
    super::zip_io::zip_files_to_path(&borrowed, dest)
}

fn write_one_backup_zip(root: &VaultRoot, vault_id: &str, stamp: &str, dest: &Path) -> Result<u64> {
    let path = locate_backup_zip(root, vault_id, stamp)?;
    let mut input = std::fs::File::open(&path)?;
    let mut output = std::fs::File::create(dest)?;
    let copied = std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    Ok(copied)
}

pub fn read_backup_zip_bytes(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<Vec<u8>> {
    Ok(std::fs::read(locate_backup_zip(root, vault_id, stamp)?)?)
}

fn prune_backups(vault_dir: &Path, mode: VaultBackupMode, keep_last: u32) -> Result<()> {
    if mode != VaultBackupMode::KeepLast {
        return Ok(());
    }
    let backups = vault_dir.join("backups");
    if !backups.is_dir() {
        return Ok(());
    }
    let mut stamps: Vec<String> = std::fs::read_dir(&backups)?
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            if entry.file_type().ok()?.is_file() {
                stamp_from_zip_name(&entry.file_name().to_string_lossy())
            } else {
                None
            }
        })
        .collect();
    stamps.sort();
    stamps.dedup();
    let keep = keep_last.max(1) as usize;
    if stamps.len() <= keep {
        return Ok(());
    }
    let drop_count = stamps.len() - keep;
    for stamp in stamps.into_iter().take(drop_count) {
        let zip = backups.join(format!("{stamp}.zip"));
        if zip.is_file() {
            std::fs::remove_file(zip)?;
        }
    }
    Ok(())
}

fn unused_backup_stamp(backups: &Path, mut stamp: String) -> Result<String> {
    for _ in 0..64 {
        let dest = backups.join(format!("{stamp}.zip"));
        let partial = backups.join(format!("{stamp}.zip.partial"));
        let saved_zip = backups.join("saves").join(format!("{stamp}.zip"));
        if !dest.exists() && !partial.exists() && !saved_zip.exists() {
            return Ok(stamp);
        }
        let n = stamp.parse::<u64>().unwrap_or(0).saturating_add(1);
        stamp = format!("{n:014}");
    }
    Err(UprivError::VaultStoreInvalid {
        path: backups.to_path_buf(),
        detail: "could not allocate a unique backup stamp".into(),
    })
}

pub(crate) fn copy_ciphertext_tree(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            return Err(UprivError::VaultStoreInvalid {
                path: entry.path(),
                detail: "refusing to copy a symlink into a backup".into(),
            });
        }
        if ft.is_dir() {
            copy_ciphertext_tree(&entry.path(), &to)?;
        } else if ft.is_file() {
            copy_regular_nofollow(&entry.path(), &to)?;
        } else {
            return Err(UprivError::VaultStoreInvalid {
                path: entry.path(),
                detail: "refusing to copy a special file into a backup".into(),
            });
        }
    }
    // Children are already durable (each file is synced before this). Syncing
    // the directory publishes their names. Same helper import uses.
    sync_dir(dst)?;
    Ok(())
}

/// Persist a directory entry. No-op off Unix, where opening a directory for
/// `sync_all` is not the same call.
fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        let dir = std::fs::File::open(path)?;
        dir.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn copy_regular_nofollow(src: &Path, dst: &Path) -> Result<()> {
    #[cfg(unix)]
    let mut input = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(src)
            .map_err(|_| UprivError::VaultStoreInvalid {
                path: src.to_path_buf(),
                detail: "refusing to copy a symlink into a backup".into(),
            })?
    };
    #[cfg(not(unix))]
    let mut input = std::fs::File::open(src)?;
    let meta = input.metadata()?;
    if !meta.is_file() {
        return Err(UprivError::VaultStoreInvalid {
            path: src.to_path_buf(),
            detail: "refusing to copy a non-regular file into a backup".into(),
        });
    }
    let mut output = std::fs::File::create(dst)?;
    std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::create_vault;

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

    #[test]
    fn stamp_allowlist_rejects_path_escape() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
        assert!(store.is_dir());
        for bad in ["../store", "/etc", "saves/../store", "2026/01"] {
            assert!(
                promote_backup_save(&root, "notes", bad).is_err(),
                "promote must reject {bad}"
            );
            assert!(
                backup_zip_file(&root, "notes", bad).is_err(),
                "get must reject {bad}"
            );
        }
        assert!(store.is_dir());
    }

    #[test]
    fn copy_ciphertext_tree_preserves_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("store");
        std::fs::create_dir_all(src.join("data")).unwrap();
        std::fs::write(src.join("vault.header"), b"header-bytes").unwrap();
        std::fs::write(src.join("data").join("a.chunk.enc"), b"cipher-bytes").unwrap();
        let dst = tmp.path().join("frozen");
        copy_ciphertext_tree(&src, &dst).unwrap();
        assert_eq!(
            std::fs::read(dst.join("vault.header")).unwrap(),
            b"header-bytes"
        );
        assert_eq!(
            std::fs::read(dst.join("data").join("a.chunk.enc")).unwrap(),
            b"cipher-bytes"
        );
    }

    #[test]
    fn close_backup_is_one_stored_zip() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes").unwrap().expect("stamp");
        let zip = root
            .vault_dir("notes")
            .unwrap()
            .join("backups")
            .join(format!("{stamp}.zip"));
        assert!(zip.is_file());
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].stamp, stamp);
        assert!(!listed[0].saved);
        let out = tempfile::tempdir().unwrap();
        let extracted = out.path().join("store");
        super::super::zip_io::unzip_store_path(&zip, &extracted).unwrap();
        assert!(extracted.join("header").join("vault.header").is_file());
    }
}
