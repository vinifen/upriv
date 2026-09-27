//! Frozen ciphertext copies of `store/` as `backups/<stamp>-<id>.zip` (Stored, no zip password).
//!
//! A listed backup is a vault zip (`store/header/vault.header`). Two of those
//! files can share a stamp. `name.zip` selects `backups/`; `saves/name.zip`
//! selects the pin. A bare stamp selects the only store zip with that stamp.

use std::path::{Path, PathBuf};

use super::embedded_settings::snapshot_settings_bytes;
use crate::config::{load_vault_config, VaultBackupMode};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::time::utc_filename_stamp;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupEntry {
    pub stamp: String,
    /// On-disk name, `YYYYMMDDHHmmss-<id>.zip`.
    pub file_name: String,
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
    entries.sort_by(|a, b| {
        b.stamp
            .cmp(&a.stamp)
            .then_with(|| a.file_name.cmp(&b.file_name))
    });
    Ok(entries)
}

fn collect_backup_dir(dir: &Path, saved: bool, out: &mut Vec<BackupEntry>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(stamp) = stamp_from_zip_name(&name) else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() {
            continue;
        }
        if !super::zip_io::zip_contains_store_header(&entry.path()) {
            continue;
        }
        let size = entry.metadata()?.len();
        let created_at = stamp_to_iso(&stamp).unwrap_or_default();
        out.push(BackupEntry {
            stamp,
            file_name: name,
            created_at,
            size_bytes: size,
            saved,
        });
    }
    Ok(())
}

fn stamp_from_backup_stem(stem: &str) -> Option<String> {
    let (stamp, id) = stem.split_once('-')?;
    if is_backup_stamp(stamp) && crate::paths::slug_id_is_valid(id) {
        Some(stamp.to_string())
    } else {
        None
    }
}

fn stamp_from_zip_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".zip")?;
    stamp_from_backup_stem(stem)
}

fn stamp_from_partial_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".zip.partial")?;
    stamp_from_backup_stem(stem)
}

/// Stamp, or the on-disk name when the leaf is `<stamp>-<id>.zip`.
pub(crate) fn backup_locator_from_leaf(raw: &str) -> Option<String> {
    if is_backup_stamp(raw) || stamp_from_zip_name(raw).is_some() {
        Some(raw.to_string())
    } else {
        None
    }
}

/// Stamp embedded in `backups/<stamp>-<id>.zip` (UTC `YYYYMMDDHHmmss`).
fn is_backup_stamp(stamp: &str) -> bool {
    stamp.len() == 14 && stamp.bytes().all(|b| b.is_ascii_digit())
}

fn parse_backup_stamp(stamp: &str) -> Result<&str> {
    if is_backup_stamp(stamp) {
        Ok(stamp)
    } else {
        Err(UprivError::VaultPathNotFound(stamp.into()))
    }
}

fn backup_zip_filename(stamp: &str, vault_id: &str) -> Result<String> {
    let stamp = parse_backup_stamp(stamp)?;
    if !crate::paths::slug_id_is_valid(vault_id) {
        return Err(UprivError::VaultPathNotFound(vault_id.into()));
    }
    Ok(format!("{stamp}-{vault_id}.zip"))
}

enum BackupKey {
    /// On-disk name. `saved` selects `backups/saves/` rather than `backups/`.
    File { name: String, saved: bool },
    /// 14-digit stamp. `None` searches both directories and refuses more than one zip.
    Stamp { stamp: String, saved: Option<bool> },
}

fn parse_backup_key(key: &str) -> Result<BackupKey> {
    let (in_saves, rest) = if let Some(rest) = key.strip_prefix("saves/") {
        (true, rest)
    } else {
        (false, key)
    };
    if rest.is_empty() || rest.contains('/') || rest.contains('\\') {
        return Err(UprivError::VaultPathNotFound(key.into()));
    }
    if is_backup_stamp(rest) {
        return Ok(BackupKey::Stamp {
            stamp: rest.to_string(),
            saved: if in_saves { Some(true) } else { None },
        });
    }
    if stamp_from_zip_name(rest).is_some() {
        return Ok(BackupKey::File {
            name: rest.to_string(),
            saved: in_saves,
        });
    }
    Err(UprivError::VaultPathNotFound(key.into()))
}

fn ambiguous_backup(key: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from(key),
        detail: "backup stamp matches more than one zip".into(),
    }
}

fn store_zips_in(dir: &Path, pred: impl Fn(&str) -> bool) -> Result<Vec<PathBuf>> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !pred(&name) {
            continue;
        }
        let path = entry.path();
        if super::zip_io::zip_contains_store_header(&path) {
            found.push(path);
        }
    }
    found.sort();
    Ok(found)
}

fn matching_store_zips(backups: &Path, key: &BackupKey) -> Result<Vec<PathBuf>> {
    let saves = backups.join("saves");
    let named = |dir: &Path, name: &str| store_zips_in(dir, |file| file == name);
    let stamped = |dir: &Path, stamp: &str| {
        store_zips_in(dir, |file| {
            stamp_from_zip_name(file).as_deref() == Some(stamp)
        })
    };
    match key {
        BackupKey::File { name, saved: true } => named(&saves, name),
        BackupKey::File { name, saved: false } => named(backups, name),
        BackupKey::Stamp {
            stamp,
            saved: Some(true),
        } => stamped(&saves, stamp),
        BackupKey::Stamp {
            stamp,
            saved: Some(false),
        } => stamped(backups, stamp),
        BackupKey::Stamp { stamp, saved: None } => {
            let mut found = stamped(&saves, stamp)?;
            found.extend(stamped(backups, stamp)?);
            found.sort();
            Ok(found)
        }
    }
}

fn one_store_zip(backups: &Path, key: &BackupKey, label: &str) -> Result<PathBuf> {
    let mut found = matching_store_zips(backups, key)?;
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(UprivError::VaultPathNotFound(label.into())),
        _ => Err(ambiguous_backup(label)),
    }
}

/// Pin moves a file out of `backups/`. A key that already names `saves/` is not a source.
fn unsaved_key(key: &BackupKey) -> Option<BackupKey> {
    match key {
        BackupKey::File { saved: true, .. }
        | BackupKey::Stamp {
            saved: Some(true), ..
        } => None,
        BackupKey::File { name, saved: false } => Some(BackupKey::File {
            name: name.clone(),
            saved: false,
        }),
        BackupKey::Stamp {
            stamp,
            saved: None | Some(false),
        } => Some(BackupKey::Stamp {
            stamp: stamp.clone(),
            saved: Some(false),
        }),
    }
}

fn backup_file_with_stamp(dir: &Path, stamp: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if stamp_from_zip_name(name).as_deref() == Some(stamp) {
            return Some(entry.path());
        }
    }
    None
}

fn partial_with_stamp(dir: &Path, stamp: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if stamp_from_partial_name(name).as_deref() == Some(stamp) {
            return true;
        }
    }
    false
}

fn stamp_is_used(backups: &Path, stamp: &str) -> bool {
    backup_file_with_stamp(backups, stamp).is_some()
        || partial_with_stamp(backups, stamp)
        || backup_file_with_stamp(&backups.join("saves"), stamp).is_some()
        || partial_with_stamp(&backups.join("saves"), stamp)
}

pub fn backup_zip_file(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<PathBuf> {
    locate_backup_zip(root, vault_id, stamp)
}

fn stamp_to_iso(stamp: &str) -> Option<String> {
    crate::time::filename_stamp_to_iso(stamp)
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
    let name = backup_zip_filename(&stamp, vault_id)?;
    let partial = backups.join(format!("{name}.partial"));
    let dest = backups.join(&name);
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    crate::store::ensure_danger_notice(&store)?;
    let settings = snapshot_settings_bytes(&vault_dir, &store)?;
    if let Err(error) =
        super::zip_io::zip_store_with_config_to_path(&store, &settings, &stamp, &partial)
    {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
    }
    if let Err(error) = std::fs::File::open(&partial).and_then(|file| file.sync_all()) {
        let _ = std::fs::remove_file(&partial);
        return Err(error.into());
    }
    if let Err(error) = super::zip_io::verify_store_zip_copies(&partial) {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
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
    let mut paths = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for key in stamps {
        let Ok(parsed) = parse_backup_key(key) else {
            continue;
        };
        let path = one_store_zip(&backups, &parsed, key)?;
        if seen.insert(path.clone()) {
            paths.push(path);
        }
    }
    for path in paths {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn promote_backup_save(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    let backups = vault_dir.join("backups");
    let saves = backups.join("saves");
    std::fs::create_dir_all(&saves)?;
    let parsed = parse_backup_key(stamp)?;
    let Some(source) = unsaved_key(&parsed) else {
        return Err(UprivError::VaultPathNotFound(stamp.into()));
    };
    let src = one_store_zip(&backups, &source, stamp)?;
    let file_name = src
        .file_name()
        .ok_or_else(|| UprivError::VaultPathNotFound(stamp.into()))?
        .to_os_string();
    let dest = saves.join(&file_name);
    if !dest.starts_with(&saves) {
        return Err(UprivError::VaultPathNotFound(stamp.into()));
    }
    match std::fs::symlink_metadata(&dest) {
        Ok(meta) if meta.file_type().is_file() => {
            if !super::zip_io::zip_contains_store_header(&dest) {
                return Err(UprivError::VaultStoreInvalid {
                    path: dest,
                    detail: "backup pin name is already taken".into(),
                });
            }
            std::fs::remove_file(&src)?;
            return Ok(());
        }
        Ok(_) => {
            return Err(UprivError::VaultPathNotFound(stamp.into()));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    std::fs::rename(&src, &dest)?;
    Ok(())
}

fn locate_backup_zip(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<PathBuf> {
    let key = parse_backup_key(stamp)?;
    let vault_dir = root.vault_dir(vault_id)?;
    one_store_zip(&vault_dir.join("backups"), &key, stamp)
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
    let mut rows: Vec<(String, bool, PathBuf)> = Vec::new();
    for stamp in stamps {
        if !seen.insert(stamp.clone()) {
            continue;
        }
        let path = locate_backup_zip(root, vault_id, stamp)?;
        let name = path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .ok_or_else(|| UprivError::VaultPathNotFound(stamp.clone()))?
            .to_string();
        let saved = path
            .parent()
            .and_then(|parent| parent.file_name())
            .is_some_and(|parent| parent == "saves");
        rows.push((name, saved, path));
    }
    let plain_names: std::collections::BTreeSet<String> = rows
        .iter()
        .filter(|(_, saved, _)| !saved)
        .map(|(name, _, _)| name.clone())
        .collect();
    let mut used = std::collections::BTreeSet::new();
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    for (name, saved, path) in rows {
        let entry_name = if saved && plain_names.contains(&name) {
            format!("saves-{name}")
        } else {
            name
        };
        if !used.insert(entry_name.clone()) {
            return Err(UprivError::VaultStoreInvalid {
                path,
                detail: "two backups share a download name".into(),
            });
        }
        entries.push((entry_name, path));
    }
    let borrowed: Vec<(String, &Path)> = entries
        .iter()
        .map(|(name, path)| (name.clone(), path.as_path()))
        .collect();
    super::zip_io::zip_files_to_path(&borrowed, dest)
}

fn read_backup_file(path: &Path) -> Result<std::fs::File> {
    crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read).map_err(UprivError::from)
}

fn write_one_backup_zip(root: &VaultRoot, vault_id: &str, stamp: &str, dest: &Path) -> Result<u64> {
    let path = locate_backup_zip(root, vault_id, stamp)?;
    let mut input = read_backup_file(&path)?;
    let mut output = std::fs::File::create(dest)?;
    let copied = std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    Ok(copied)
}

pub fn read_backup_zip_bytes(root: &VaultRoot, vault_id: &str, stamp: &str) -> Result<Vec<u8>> {
    let path = locate_backup_zip(root, vault_id, stamp)?;
    let mut file = read_backup_file(&path)?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut file, &mut bytes)?;
    Ok(bytes)
}

fn prune_backups(vault_dir: &Path, mode: VaultBackupMode, keep_last: u32) -> Result<()> {
    if mode != VaultBackupMode::KeepLast {
        return Ok(());
    }
    let backups = vault_dir.join("backups");
    if !backups.is_dir() {
        return Ok(());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&backups)? {
        let entry = entry?;
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(stamp) = stamp_from_zip_name(&name) else {
            continue;
        };
        let path = entry.path();
        if !super::zip_io::zip_contains_store_header(&path) {
            continue;
        }
        files.push((stamp, name, path));
    }
    files.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let keep = keep_last.max(1) as usize;
    if files.len() <= keep {
        return Ok(());
    }
    let drop_count = files.len() - keep;
    for (_stamp, _name, path) in files.into_iter().take(drop_count) {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn unused_backup_stamp(backups: &Path, mut stamp: String) -> Result<String> {
    for _ in 0..64 {
        if is_backup_stamp(&stamp) && !stamp_is_used(backups, &stamp) {
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
        std::fs::create_dir_all(src.join("header")).unwrap();
        std::fs::create_dir_all(src.join("data")).unwrap();
        std::fs::write(src.join("header").join("vault.header"), b"header-bytes").unwrap();
        std::fs::write(src.join("data").join("a.blob"), b"cipher-bytes").unwrap();
        let dst = tmp.path().join("frozen");
        copy_ciphertext_tree(&src, &dst).unwrap();
        assert_eq!(
            std::fs::read(dst.join("header").join("vault.header")).unwrap(),
            b"header-bytes"
        );
        assert_eq!(
            std::fs::read(dst.join("data").join("a.blob")).unwrap(),
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
        let notice = root
            .vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME)
            .join(crate::store::STORE_DANGER_FILE_NAME);
        let notice_bytes = std::fs::read(&notice).unwrap();
        std::fs::remove_file(&notice).unwrap();
        let stamp = backup_on_close(&root, "notes").unwrap().expect("stamp");
        assert_eq!(std::fs::read(&notice).unwrap(), notice_bytes);
        let zip = root
            .vault_dir("notes")
            .unwrap()
            .join("backups")
            .join(format!("{stamp}-notes.zip"));
        assert!(zip.is_file());
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].stamp, stamp);
        assert_eq!(listed[0].file_name, format!("{stamp}-notes.zip"));
        assert!(!listed[0].saved);
        let backups = zip.parent().unwrap();
        std::fs::write(backups.join(format!("{stamp}.zip")), b"not-a-backup").unwrap();
        std::fs::write(backups.join(format!("{stamp}-Notes.zip")), b"bad-id").unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, format!("{stamp}-notes.zip"));
        let out = tempfile::tempdir().unwrap();
        let extracted = out.path().join("store");
        super::super::zip_io::unzip_store_path(&zip, &extracted).unwrap();
        assert!(extracted.join("header").join("vault.header").is_file());
        let notice_name = crate::store::STORE_DANGER_FILE_NAME;
        let packed = format!("{}/{notice_name}", crate::paths::STORE_DIR_NAME);
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&zip).unwrap()).unwrap();
        let mut found = false;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            if entry.name() == packed {
                let mut body = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut body).unwrap();
                let on_disk = std::fs::read(
                    root.vault_dir("notes")
                        .unwrap()
                        .join(crate::paths::STORE_DIR_NAME)
                        .join(notice_name),
                )
                .unwrap();
                assert_eq!(body, on_disk);
                found = true;
            }
        }
        assert!(found, "backup zip keeps the store danger notice");
        let index = std::fs::read(
            extracted
                .join(crate::store::INDEX_DIR_NAME)
                .join(crate::store::INDEX_FILE_NAME),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(
                extracted
                    .join(crate::store::INDEX_DIR_NAME)
                    .join(crate::store::INDEX_COPY_FILE_NAME),
            )
            .unwrap(),
            index
        );
        assert!(!extracted.join("config.toml").exists());
        assert!(!extracted.join("README.md").exists());
        let readme = super::super::zip_io::read_zip_root_entry(
            std::fs::File::open(&zip).unwrap(),
            super::super::embedded_settings::ZIP_README_ENTRY,
        )
        .unwrap()
        .expect("README.md");
        let store_bytes = super::super::sum_regular_file_bytes(
            &root
                .vault_dir("notes")
                .unwrap()
                .join(crate::paths::STORE_DIR_NAME),
        )
        .unwrap();
        let expected =
            super::super::embedded_settings::store_zip_readme(&stamp, store_bytes).unwrap();
        assert_eq!(readme, expected.into_bytes());
        let embedded =
            super::super::zip_io::read_zip_config_toml(std::fs::File::open(&zip).unwrap())
                .unwrap()
                .expect("config.toml");
        let parsed = super::super::embedded_settings::parse_embedded_settings(&embedded).unwrap();
        assert_eq!(parsed.config.vault.display_name, "Notes");
        assert_eq!(parsed.unlock_preset, Some(KdfUnlockPreset::M32));
        promote_backup_save(&root, "notes", &stamp).unwrap();
        let saved = root
            .vault_dir("notes")
            .unwrap()
            .join("backups")
            .join("saves")
            .join(format!("{stamp}-notes.zip"));
        assert!(saved.is_file());
        assert!(!zip.is_file());
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].saved);
        assert_eq!(listed[0].file_name, format!("{stamp}-notes.zip"));
        assert_eq!(backup_zip_file(&root, "notes", &stamp).unwrap(), saved);
    }

    #[test]
    fn each_store_zip_is_listed_by_file_name() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes").unwrap().expect("stamp");
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let original = backups.join(format!("{stamp}-notes.zip"));
        let other = backups.join(format!("{stamp}-other.zip"));
        std::fs::copy(&original, &other).unwrap();
        std::fs::write(backups.join(format!("{stamp}-extra.zip")), b"not-a-vault").unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        let names: Vec<String> = listed.iter().map(|entry| entry.file_name.clone()).collect();
        assert_eq!(
            names,
            vec![format!("{stamp}-notes.zip"), format!("{stamp}-other.zip"),]
        );
        let found = backup_zip_file(&root, "notes", &format!("{stamp}-other.zip")).unwrap();
        assert_eq!(found, other);
        let err = backup_zip_file(&root, "notes", &stamp).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        delete_backups(&root, "notes", &[format!("{stamp}-other.zip")]).unwrap();
        assert!(!other.exists());
        assert!(original.is_file());
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
    }

    #[test]
    fn same_file_name_in_saves_is_a_separate_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes").unwrap().expect("stamp");
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let name = format!("{stamp}-notes.zip");
        let original = backups.join(&name);
        let saves = backups.join("saves");
        std::fs::create_dir_all(&saves).unwrap();
        let pinned = saves.join(&name);
        std::fs::copy(&original, &pinned).unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed.iter().filter(|entry| entry.saved).count(), 1);
        assert!(matches!(
            backup_zip_file(&root, "notes", &stamp).unwrap_err(),
            UprivError::VaultStoreInvalid { .. }
        ));
        let found = backup_zip_file(&root, "notes", &format!("saves/{name}")).unwrap();
        assert_eq!(found, pinned);
        let bundle_dir = tempfile::tempdir().unwrap();
        let bundle = bundle_dir.path().join("both.zip");
        export_backups_to_path(
            &root,
            "notes",
            &[name.clone(), format!("saves/{name}")],
            &bundle,
        )
        .unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&bundle).unwrap()).unwrap();
        let mut packed = Vec::new();
        for index in 0..archive.len() {
            packed.push(archive.by_index(index).unwrap().name().to_string());
        }
        packed.sort();
        assert_eq!(packed, vec![name.clone(), format!("saves-{name}")]);
        delete_backups(&root, "notes", &[name.clone(), name.clone()]).unwrap();
        assert!(!original.exists());
        assert!(pinned.is_file());
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
        assert!(list_backups(&root, "notes").unwrap()[0].saved);
    }

    #[test]
    fn promote_keeps_the_zip_when_the_pin_name_is_not_a_vault() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes").unwrap().expect("stamp");
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let name = format!("{stamp}-notes.zip");
        let original = backups.join(&name);
        let saves = backups.join("saves");
        std::fs::create_dir_all(&saves).unwrap();
        std::fs::write(saves.join(&name), b"not-a-vault").unwrap();
        let err = promote_backup_save(&root, "notes", &name).unwrap_err();
        assert!(matches!(err, UprivError::VaultStoreInvalid { .. }));
        assert!(original.is_file());
        assert_eq!(list_backups(&root, "notes").unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_is_not_a_backup() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let stamp = backup_on_close(&root, "notes").unwrap().expect("stamp");
        let backups = root.vault_dir("notes").unwrap().join("backups");
        let name = format!("{stamp}-notes.zip");
        let original = backups.join(&name);
        let hold = backups.join("hold.zip");
        std::fs::rename(&original, &hold).unwrap();
        std::os::unix::fs::symlink(&hold, &original).unwrap();
        assert!(list_backups(&root, "notes").unwrap().is_empty());
        assert!(backup_zip_file(&root, "notes", &name).is_err());
        assert!(read_backup_zip_bytes(&root, "notes", &name).is_err());
    }
}
