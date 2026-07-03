//! Archive backups on close (RF-07 / RF-07b).
//!
//! Before a vault's `.7z` is atomically replaced, the current archive is copied into
//! `vaults/<id>/<backups_dir>/<timestamp>-<id>.7z`, then old backups are pruned per the
//! vault's `[backup]` policy (`keep_last` or `keep_all`).
//!
//! Pinned saves live under `<backups_dir>/saves/` and are never auto-pruned.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::config::{load_vault_config, BackupMode, VaultConfig};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;

/// Row returned by `backup_list` (maps to desktop `VaultBackupEntry`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub filename: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub saved: bool,
}

/// Copy the current archive into the backups directory (if enabled), then prune.
///
/// No-op when `[backup] enabled = false` or the archive does not yet exist.
pub fn backup_before_replace(
    root: &VaultRoot,
    config: &VaultConfig,
    archive_path: &Path,
) -> Result<()> {
    if !config.backup.enabled || !archive_path.is_file() {
        return Ok(());
    }

    let backups_dir = root.vault_backups_dir(config);
    fs::create_dir_all(&backups_dir)?;

    let backup_name = format!("{}-{}.7z", backup_timestamp(), config.vault.id);
    fs::copy(archive_path, backups_dir.join(&backup_name))?;

    prune_backups(&backups_dir, config)?;
    Ok(())
}

pub fn list_backups(root: &VaultRoot, vault_id: &str) -> Result<Vec<BackupEntry>> {
    let config = load_vault_config(root, vault_id)?;
    let mut entries = Vec::new();

    let standard_dir = root.vault_backups_dir(&config);
    if standard_dir.is_dir() {
        collect_backup_entries(&standard_dir, &config, false, &mut entries)?;
    }

    let saves_dir = root.vault_backups_saves_dir(&config);
    if saves_dir.is_dir() {
        collect_backup_entries(&saves_dir, &config, true, &mut entries)?;
    }

    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

pub fn delete_backups(
    root: &VaultRoot,
    vault_id: &str,
    filenames: &[String],
) -> Result<()> {
    if filenames.is_empty() {
        return Ok(());
    }
    let config = load_vault_config(root, vault_id)?;
    for filename in filenames {
        let path = resolve_backup_path(root, &config, filename)?;
        if path.is_file() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

/// Move a standard backup into `saves/` so rotation will not delete it.
pub fn promote_to_save(root: &VaultRoot, vault_id: &str, filename: &str) -> Result<()> {
    let config = load_vault_config(root, vault_id)?;
    validate_backup_filename(filename, &config.vault.id)?;

    let source = root.vault_backups_dir(&config).join(filename);
    if !source.is_file() {
        return Err(UprivError::ArchiveNotFound(source));
    }

    let saves_dir = root.vault_backups_saves_dir(&config);
    fs::create_dir_all(&saves_dir)?;
    let target = saves_dir.join(filename);
    if target.is_file() {
        return Ok(());
    }
    fs::rename(source, target)?;
    Ok(())
}

pub fn read_backup_bytes(root: &VaultRoot, vault_id: &str, filename: &str) -> Result<Vec<u8>> {
    let config = load_vault_config(root, vault_id)?;
    let path = resolve_backup_path(root, &config, filename)?;
    if !path.is_file() {
        return Err(UprivError::ArchiveNotFound(path));
    }
    Ok(fs::read(path)?)
}

fn collect_backup_entries(
    dir: &Path,
    config: &VaultConfig,
    saved: bool,
    out: &mut Vec<BackupEntry>,
) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        let Some(filename) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !validate_backup_filename(filename, &config.vault.id).is_ok() {
            continue;
        }
        let metadata = entry.metadata()?;
        let created_at = created_at_from_filename(filename)
            .or_else(|| created_at_from_mtime(&metadata))
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());
        out.push(BackupEntry {
            filename: filename.to_string(),
            created_at,
            size_bytes: Some(metadata.len()),
            saved,
        });
    }
    Ok(())
}

fn resolve_backup_path(root: &VaultRoot, config: &VaultConfig, filename: &str) -> Result<PathBuf> {
    validate_backup_filename(filename, &config.vault.id)?;
    let standard = root.vault_backups_dir(config).join(filename);
    if standard.is_file() {
        return Ok(standard);
    }
    let saved = root.vault_backups_saves_dir(config).join(filename);
    if saved.is_file() {
        return Ok(saved);
    }
    Err(UprivError::ArchiveNotFound(standard))
}

fn validate_backup_filename(filename: &str, vault_id: &str) -> Result<()> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err(UprivError::InvalidStore("invalid backup filename".into()));
    }
    let suffix = format!("-{vault_id}.7z");
    if !filename.ends_with(&suffix) {
        return Err(UprivError::InvalidStore("backup filename does not match vault".into()));
    }
    Ok(())
}

fn prune_backups(backups_dir: &Path, config: &VaultConfig) -> Result<()> {
    let keep = match config.backup.mode {
        BackupMode::KeepAll => return Ok(()),
        BackupMode::KeepLast => config.backup.keep_last.max(1) as usize,
    };

    let suffix = format!("-{}.7z", config.vault.id);
    let mut backups: Vec<_> = fs::read_dir(backups_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.ends_with(&suffix))
                .unwrap_or(false)
        })
        .collect();

    // Timestamp-prefixed names sort chronologically under lexicographic order.
    backups.sort();
    if backups.len() > keep {
        for old in &backups[..backups.len() - keep] {
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}

/// Sortable, collision-resistant timestamp (`<secs><nanos>`).
fn backup_timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:010}{:09}", now.as_secs(), now.subsec_nanos())
}

fn created_at_from_filename(filename: &str) -> Option<String> {
    let stem = filename.strip_suffix(".7z")?;
    let prefix = stem.split('-').next()?;

    // `20260528T120000-vault-id`
    if prefix.len() >= 15 && prefix.as_bytes().get(8) == Some(&b'T') {
        let y = &prefix[0..4];
        let mo = &prefix[4..6];
        let d = &prefix[6..8];
        let h = &prefix[9..11];
        let mi = &prefix[11..13];
        let s = &prefix[13..15];
        if [y, mo, d, h, mi, s].iter().all(|part| part.chars().all(|c| c.is_ascii_digit())) {
            return Some(format!("{y}-{mo}-{d}T{h}:{mi}:{s}Z"));
        }
    }

    // `<secs><nanos>-vault-id` from `backup_timestamp()`
    if prefix.len() >= 10 && prefix.chars().all(|c| c.is_ascii_digit()) {
        let secs: u64 = prefix[..10].parse().ok()?;
        return Some(unix_secs_to_iso(secs));
    }

    None
}

fn created_at_from_mtime(metadata: &fs::Metadata) -> Option<String> {
    let modified = metadata.modified().ok()?;
    let secs = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(unix_secs_to_iso(secs))
}

fn unix_secs_to_iso(secs: u64) -> String {
    // Manual UTC formatting — good enough for backup list display.
    let days = secs / 86_400;
    let time = secs % 86_400;
    let h = time / 3600;
    let mi = (time % 3600) / 60;
    let s = time % 60;

    let mut year = 1970u64;
    let mut day = days;
    loop {
        let year_days = if is_leap_year(year) { 366 } else { 365 };
        if day < year_days {
            break;
        }
        day -= year_days;
        year += 1;
    }

    let month_days = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u64;
    for days_in_month in month_days {
        if day < days_in_month {
            break;
        }
        day -= days_in_month;
        month += 1;
    }
    let dom = day + 1;

    format!(
        "{year:04}-{month:02}-{dom:02}T{h:02}:{mi:02}:{s:02}Z"
    )
}

fn is_leap_year(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::VaultConfig;
    use tempfile::tempdir;

    fn config(mode: &str, keep_last: u32) -> VaultConfig {
        let toml = format!(
            r#"
[vault]
id = "notes"
display_name = "Notes"
vault_file = "archive/Notes.7z"

[backup]
enabled = true
mode = "{mode}"
keep_last = {keep_last}
"#
        );
        toml::from_str(&toml).unwrap()
    }

    fn count_backups(root: &VaultRoot, config: &VaultConfig) -> usize {
        let dir = root.vault_backups_dir(config);
        fs::read_dir(dir).map(|rd| rd.count()).unwrap_or(0)
    }

    #[test]
    fn keep_last_prunes_to_limit() {
        let temp = tempdir().unwrap();
        let root = VaultRoot::new(temp.path());
        let config = config("keep_last", 2);
        let archive = root.vault_archive_path(&config);
        fs::create_dir_all(archive.parent().unwrap()).unwrap();

        for i in 0..5 {
            fs::write(&archive, format!("archive-{i}")).unwrap();
            backup_before_replace(&root, &config, &archive).unwrap();
        }

        assert_eq!(count_backups(&root, &config), 2);
    }

    #[test]
    fn keep_all_retains_every_backup() {
        let temp = tempdir().unwrap();
        let root = VaultRoot::new(temp.path());
        let config = config("keep_all", 1);
        let archive = root.vault_archive_path(&config);
        fs::create_dir_all(archive.parent().unwrap()).unwrap();

        for i in 0..4 {
            fs::write(&archive, format!("archive-{i}")).unwrap();
            backup_before_replace(&root, &config, &archive).unwrap();
        }

        assert_eq!(count_backups(&root, &config), 4);
    }

    #[test]
    fn disabled_backup_is_noop() {
        let temp = tempdir().unwrap();
        let root = VaultRoot::new(temp.path());
        let mut config = config("keep_last", 2);
        config.backup.enabled = false;
        let archive = root.vault_archive_path(&config);
        fs::create_dir_all(archive.parent().unwrap()).unwrap();
        fs::write(&archive, "archive").unwrap();

        backup_before_replace(&root, &config, &archive).unwrap();
        assert_eq!(count_backups(&root, &config), 0);
    }

    #[test]
    fn saves_are_never_pruned() {
        let temp = tempdir().unwrap();
        let root = VaultRoot::new(temp.path());
        let config = config("keep_last", 1);
        let archive = root.vault_archive_path(&config);
        fs::create_dir_all(archive.parent().unwrap()).unwrap();
        fs::create_dir_all(root.vault_dir("notes")).unwrap();
        fs::write(
            root.vault_config_path("notes"),
            r#"
[vault]
id = "notes"
display_name = "Notes"
vault_file = "archive/Notes.7z"

[backup]
enabled = true
mode = "keep_last"
keep_last = 1
"#,
        )
        .unwrap();

        fs::write(&archive, "v1").unwrap();
        backup_before_replace(&root, &config, &archive).unwrap();
        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.len(), 1);
        promote_to_save(&root, "notes", &listed[0].filename).unwrap();

        fs::write(&archive, "v2").unwrap();
        backup_before_replace(&root, &config, &archive).unwrap();
        fs::write(&archive, "v3").unwrap();
        backup_before_replace(&root, &config, &archive).unwrap();

        let listed = list_backups(&root, "notes").unwrap();
        assert_eq!(listed.iter().filter(|entry| entry.saved).count(), 1);
        assert_eq!(listed.iter().filter(|entry| !entry.saved).count(), 1);
    }

    #[test]
    fn parses_numeric_backup_timestamp() {
        let iso = created_at_from_filename("1782691953-teste.7z").unwrap();
        assert!(iso.starts_with("2026-"));
    }
}
