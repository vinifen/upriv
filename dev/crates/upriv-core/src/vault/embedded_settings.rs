//! Public vault settings carried inside a store `.zip` or a backup zip.
//! The bytes are `config.toml` plus one comment naming the unlock preset.
//! That comment is not a `[kdf]` section and is not written back to the new
//! vault's `config.toml`. `README.md` sits beside it and records when the
//! copy was written, plus the rounded size of the files in `store/`. A portable
//! `.7z` does not carry either file.

use std::path::Path;

use crate::config::{vault_config_path, VaultConfig};
use crate::error::{Result, UprivError};
use crate::store::{probe_unlock_preset, KdfUnlockPreset};

/// Zip path of the public settings. Beside `store/`, not inside it.
pub const ZIP_CONFIG_ENTRY: &str = "config.toml";

/// Zip path of the human note for this copy. Beside `store/`, not inside it.
pub const ZIP_README_ENTRY: &str = "README.md";

const README_TEMPLATE: &str = include_str!("STORE-ZIP-README.md");

const PRESET_MARK: &str = "upriv-export-unlock-preset:";

#[derive(Debug, Clone, PartialEq)]
pub struct EmbeddedVaultSettings {
    pub config: VaultConfig,
    pub unlock_preset: Option<KdfUnlockPreset>,
}

/// Settings bytes for a store zip or a backup: on-disk `config.toml` plus the header preset.
pub(crate) fn snapshot_settings_bytes(vault_dir: &Path, store_dir: &Path) -> Result<Vec<u8>> {
    let raw = crate::host_fs::read_to_string(vault_config_path(vault_dir))?;
    Ok(settings_archive_bytes(&raw, probe_unlock_preset(store_dir)))
}

/// `config.toml` as stored on disk, plus the header's unlock preset as a comment.
pub fn settings_archive_bytes(config_toml: &str, preset: Option<KdfUnlockPreset>) -> Vec<u8> {
    let mut out = config_toml.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    if let Some(preset) = preset {
        out.push_str(&format!("# {PRESET_MARK} {}\n", preset_id(preset)));
    }
    out.into_bytes()
}

/// `README.md` for a store zip or a backup. `created_stamp` is UTC `YYYYMMDDHHmmss`.
///
/// `store_bytes` is the regular files under `store/`. The README shows that
/// length with the same rounding as a backup size. It is not the zip's exact length.
pub fn store_zip_readme(created_stamp: &str, store_bytes: u64) -> Result<String> {
    let created = crate::time::filename_stamp_to_iso(created_stamp).ok_or_else(|| {
        UprivError::VaultStoreInvalid {
            path: Path::new(ZIP_README_ENTRY).to_path_buf(),
            detail: "created time is not a UTC YYYYMMDDHHmmss stamp".into(),
        }
    })?;
    let size = format_backup_bytes(store_bytes);
    Ok(README_TEMPLATE
        .replace("{{created}}", &created)
        .replace("{{size}}", &size))
}

/// Same rounding as a backup size in the app: exact bytes under 1 KB, one
/// decimal for KB and MB, two decimals for GB.
pub(crate) fn format_backup_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * 1024;
    const GB: u64 = 1024 * 1024 * 1024;
    if bytes < KB {
        return format!("{bytes} B");
    }
    if bytes < MB {
        return format!("{:.1} KB", bytes as f64 / KB as f64);
    }
    if bytes < GB {
        return format!("{:.1} MB", bytes as f64 / MB as f64);
    }
    format!("{:.2} GB", bytes as f64 / GB as f64)
}

pub fn parse_embedded_settings(bytes: &[u8]) -> Result<EmbeddedVaultSettings> {
    let text = std::str::from_utf8(bytes).map_err(|_| UprivError::VaultConfigInvalid {
        path: std::path::PathBuf::from(ZIP_CONFIG_ENTRY),
        detail: "embedded vault settings are not utf-8".into(),
    })?;
    let config = toml::from_str(text).map_err(|error| UprivError::VaultConfigInvalid {
        path: std::path::PathBuf::from(ZIP_CONFIG_ENTRY),
        detail: error.to_string(),
    })?;
    Ok(EmbeddedVaultSettings {
        config,
        unlock_preset: unlock_preset_comment(text),
    })
}

fn preset_id(preset: KdfUnlockPreset) -> &'static str {
    match preset {
        KdfUnlockPreset::M32 => "32mib",
        KdfUnlockPreset::M64 => "64mib",
        KdfUnlockPreset::M128 => "128mib",
        KdfUnlockPreset::M256 => "256mib",
        KdfUnlockPreset::G1 => "1gib",
        KdfUnlockPreset::G2 => "2gib",
    }
}

fn preset_from_id(id: &str) -> Option<KdfUnlockPreset> {
    Some(match id {
        "32mib" => KdfUnlockPreset::M32,
        "64mib" => KdfUnlockPreset::M64,
        "128mib" => KdfUnlockPreset::M128,
        "256mib" => KdfUnlockPreset::M256,
        "1gib" => KdfUnlockPreset::G1,
        "2gib" => KdfUnlockPreset::G2,
        _ => return None,
    })
}

fn unlock_preset_comment(text: &str) -> Option<KdfUnlockPreset> {
    let mut found = None;
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix('#') else {
            continue;
        };
        let Some(id) = rest.trim().strip_prefix(PRESET_MARK) else {
            continue;
        };
        if let Some(preset) = preset_from_id(id.trim()) {
            found = Some(preset);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_note_and_preset_without_a_kdf_section() {
        let raw = r#"
[vault]
id = "notes"
display_name = "Notes"
order = 4
note = "tax year"
password_hint = "pet"
hidden = true

[backup]
enabled = false
mode = "keep_all"
keep_last = 3
"#;
        let bytes = settings_archive_bytes(raw, Some(KdfUnlockPreset::M128));
        let text = std::str::from_utf8(&bytes).unwrap();
        assert!(!text.contains("[kdf]"));
        let parsed = parse_embedded_settings(&bytes).unwrap();
        assert_eq!(parsed.config.vault.note, "tax year");
        assert_eq!(parsed.config.vault.password_hint, "pet");
        assert!(parsed.config.vault.hidden);
        assert!(!parsed.config.backup.enabled);
        assert_eq!(parsed.unlock_preset, Some(KdfUnlockPreset::M128));
        let earlier = format!("# {PRESET_MARK} 32mib\n{text}");
        let last = parse_embedded_settings(earlier.as_bytes()).unwrap();
        assert_eq!(last.unlock_preset, Some(KdfUnlockPreset::M128));
    }

    #[test]
    fn readme_records_the_copy_time_and_a_rounded_store_size() {
        let readme = store_zip_readme("20260529120000", 512).unwrap();
        assert!(readme.contains("Created: 2026-05-29T12:00:00Z"));
        assert!(readme.contains("Size: 512 B"));
        assert!(readme.contains("This zip has no zip password."));
        assert!(readme.contains("`store/` only, rounded."));
        assert!(readme.contains("config.toml"));
        assert!(!readme.contains("{{"));
        assert_eq!(format_backup_bytes(2048), "2.0 KB");
        assert_eq!(format_backup_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(format_backup_bytes(2 * 1024 * 1024 * 1024), "2.00 GB");
        assert!(store_zip_readme("not-a-stamp", 0).is_err());
    }
}
