//! Per-vault `config.toml`: load, validate, and save.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
mod types;

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};

pub use types::{
    AutoCloseWhenBusy, VaultArchiveMode, VaultAutoCloseSection, VaultBackupMode,
    VaultBackupSection, VaultConfig, VaultFileManagerSection, VaultIdentitySection,
    VaultPlainFiles, VaultSecuritySection, VaultSevenZipSection, VaultStorageMode,
    VaultStorageSection, VaultWipePattern,
};

const CONFIG_FILE_NAME: &str = "config.toml";

/// Comment prepended when writing `vaults/<id>/config.toml`.
pub const VAULT_CONFIG_TOML_GROUPS_NOTE: &str =
    "# Group membership is not here. If this vault is in a group, see .upriv/vault_groups.toml.\n";

/// Absolute path to `vaults/<id>/config.toml`.
pub fn vault_config_path(vault_dir: impl AsRef<Path>) -> PathBuf {
    vault_dir.as_ref().join(CONFIG_FILE_NAME)
}

/// Load `vaults/<id>/config.toml`: `[vault].id` must match the folder and a
/// display name must be set. Other sections use their defaults when absent.
/// A folder list is checked as a list (row numbers, a selection that names a
/// row); its paths are checked when they are saved and when they are used.
pub fn load_vault_config(vault_dir: impl AsRef<Path>) -> Result<VaultConfig> {
    let vault_dir = vault_dir.as_ref();
    let path = vault_config_path(vault_dir);
    if !path.host_is_file() {
        return Err(UprivError::VaultConfigInvalid {
            path: path.clone(),
            detail: "missing config.toml".into(),
        });
    }
    let raw = crate::host_fs::read_to_string(&path).map_err(UprivError::from)?;
    let mut parsed = parse_vault_config_toml(&raw, &path)?;

    if parsed.vault.id.trim().is_empty() {
        return Err(UprivError::VaultConfigInvalid {
            path,
            detail: "[vault].id is empty".into(),
        });
    }
    parsed.vault.display_name = crate::paths::normalize_stored_name(&parsed.vault.display_name);
    if parsed.vault.display_name.is_empty() {
        return Err(UprivError::VaultConfigInvalid {
            path,
            detail: "[vault].display_name is empty".into(),
        });
    }

    let dir_name = vault_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !vault_id_matches_dir(&parsed.vault.id, &dir_name) {
        return Err(UprivError::VaultConfigInvalid {
            path,
            detail: format!(
                "[vault].id ({}) must match directory name ({dir_name})",
                parsed.vault.id
            ),
        });
    }

    Ok(parsed)
}

/// Parse `config.toml` text. A key this config does not define is invalid.
pub(crate) fn parse_vault_config_toml(raw: &str, path: &Path) -> Result<VaultConfig> {
    let mut parsed: VaultConfig =
        toml::from_str(raw).map_err(|error| invalid_config(path, &error))?;
    parsed.auto_close.idle_minutes = types::clamp_idle_minutes(parsed.auto_close.idle_minutes);
    let lists = parsed
        .unlocked_folder
        .devices
        .check()
        .map_err(|detail| format!("[unlocked_folder] {detail}"))
        .and_then(|()| {
            parsed
                .backup
                .devices
                .check()
                .map_err(|detail| format!("[backup] {detail}"))
        });
    if let Err(detail) = lists {
        return Err(UprivError::VaultConfigInvalid {
            path: path.to_path_buf(),
            detail,
        });
    }
    Ok(parsed)
}

fn invalid_config(path: &Path, error: &toml::de::Error) -> UprivError {
    UprivError::VaultConfigInvalid {
        path: path.to_path_buf(),
        detail: format!("invalid config.toml: {error}"),
    }
}

/// Trim, collapse internal whitespace, and reject empty / illegal / reserved names.
pub(crate) fn normalize_and_validate_display_name(raw: &str) -> Result<String> {
    let name = crate::paths::normalize_stored_name(raw);
    if name.is_empty() {
        return Err(UprivError::VaultConfigInvalid {
            path: PathBuf::from("config.toml"),
            detail: "[vault].display_name is empty".into(),
        });
    }
    if name.encode_utf16().count() > 128 {
        return Err(UprivError::VaultConfigInvalid {
            path: PathBuf::from("config.toml"),
            detail: "[vault].display_name is too long (max 128)".into(),
        });
    }
    if name.ends_with('.') {
        return Err(UprivError::VaultConfigInvalid {
            path: PathBuf::from("config.toml"),
            detail: "[vault].display_name cannot end with a space or period".into(),
        });
    }
    if name.chars().any(|c| {
        matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
    }) {
        return Err(UprivError::VaultConfigInvalid {
            path: PathBuf::from("config.toml"),
            detail: "[vault].display_name contains forbidden characters".into(),
        });
    }
    if crate::paths::is_windows_reserved_device_name(&name) {
        return Err(UprivError::VaultConfigInvalid {
            path: PathBuf::from("config.toml"),
            detail: "[vault].display_name is a reserved Windows device name".into(),
        });
    }
    Ok(name)
}

/// Persist a full `config.toml`. Does not create the vault directory (parent must exist).
pub fn save_vault_config(vault_dir: impl AsRef<Path>, config: &VaultConfig) -> Result<()> {
    let path = vault_config_path(vault_dir);
    let body = serialize_vault_config_toml(config)?;
    crate::paths::write_bytes_atomic_existing_parent(&path, body.as_bytes())
}

/// Set `[vault].hidden`. Returns whether the flag changed.
pub fn set_vault_hidden(vault_dir: impl AsRef<Path>, hidden: bool) -> Result<bool> {
    let vault_dir = vault_dir.as_ref();
    let mut config = load_vault_config(vault_dir)?;
    if config.vault.hidden == hidden {
        return Ok(false);
    }
    config.vault.hidden = hidden;
    save_vault_config(vault_dir, &config)?;
    Ok(true)
}

/// Serialize a vault config to TOML: the whole file, so no section is dropped.
pub fn serialize_vault_config_toml(config: &VaultConfig) -> Result<String> {
    let mut config = config.clone();
    config.vault.display_name = crate::paths::normalize_stored_name(&config.vault.display_name);
    config.auto_close.idle_minutes = types::clamp_idle_minutes(config.auto_close.idle_minutes);
    let body = toml::to_string_pretty(&config).map_err(|error| UprivError::VaultConfigInvalid {
        path: PathBuf::from("config.toml"),
        detail: format!("serialize config.toml: {error}"),
    })?;
    Ok(format!("{VAULT_CONFIG_TOML_GROUPS_NOTE}\n{body}"))
}

/// Folder name must equal `[vault].id` **exactly** (no casefold).
///
/// Case-insensitive volumes (Windows, default APFS) still require the same spelling
/// as the on-disk directory name. Casefolding would wrongly accept mismatched ids on
/// case-sensitive APFS / Linux.
fn vault_id_matches_dir(id: &str, dir_name: &str) -> bool {
    id == dir_name
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::test_support::{write_vault_dir, VaultSpec};

    /// Canonical layout: `<root>/.upriv/vaults/<id>/`.
    fn vault_dir_under_root(root: &Path) -> PathBuf {
        let vaults = root.join(".upriv").join("vaults");
        crate::host_fs::create_dir_all(&vaults).unwrap();
        write_vault_dir(&vaults, &VaultSpec::encrypted("notes", "Notes", 1))
    }

    #[test]
    fn loads_encrypted_dir_vault_config() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_vault_dir(
            tmp.path(),
            &VaultSpec::encrypted("my-encrypted-notes", "My Encrypted Notes", 4),
        );
        let cfg = load_vault_config(&dir).expect("encrypted_dir config");
        assert_eq!(cfg.id(), "my-encrypted-notes");
        assert_eq!(cfg.display_name(), "My Encrypted Notes");
        assert_eq!(cfg.storage_mode(), VaultStorageMode::EncryptedDir);
        assert_eq!(cfg.vault.order, 4);
    }

    #[test]
    fn loads_upriv_plain_vault_config() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = write_vault_dir(
            tmp.path(),
            &VaultSpec::upriv_plain("plain-folder-demo", "Plain Folder Demo", 3),
        );
        let cfg = load_vault_config(&dir).expect("upriv_plain config");
        assert_eq!(cfg.storage_mode(), VaultStorageMode::UprivPlain);
    }

    #[test]
    fn missing_config_is_invalid() {
        let dir = tempfile::tempdir().unwrap();
        let err = load_vault_config(dir.path()).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
    }

    #[test]
    fn rejects_id_mismatch_with_directory_name() {
        let root = tempfile::tempdir().unwrap();
        let vault_dir = root.path().join("folder-foo");
        crate::host_fs::create_dir_all(&vault_dir).unwrap();
        crate::host_fs::write(
            vault_dir.join("config.toml"),
            r#"
[vault]
id = "folder-bar"
display_name = "Mismatch"
"#,
        )
        .unwrap();
        let err = load_vault_config(&vault_dir).unwrap_err();
        match err {
            UprivError::VaultConfigInvalid { detail, .. } => {
                assert!(
                    detail.contains("must match directory name"),
                    "unexpected detail: {detail}"
                );
            }
            other => panic!("expected VaultConfigInvalid, got {other:?}"),
        }
    }

    #[test]
    fn rejects_id_case_mismatch() {
        let root = tempfile::tempdir().unwrap();
        let vault_dir = root.path().join("Folder-Foo");
        crate::host_fs::create_dir_all(&vault_dir).unwrap();
        crate::host_fs::write(
            vault_dir.join("config.toml"),
            r#"
[vault]
id = "folder-foo"
display_name = "Case mismatch"
"#,
        )
        .unwrap();
        let err = load_vault_config(&vault_dir).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
    }

    #[test]
    fn storage_mode_deserializes_all_variants() {
        use super::VaultStorageMode;

        let cases = [
            ("encrypted_dir", VaultStorageMode::EncryptedDir),
            ("upriv_plain", VaultStorageMode::UprivPlain),
        ];

        for (mode_str, expected) in cases {
            let section: VaultStorageSection =
                toml::from_str(&format!("mode = \"{mode_str}\"")).expect("storage section");
            assert_eq!(section.mode, expected, "mode {mode_str}");
        }
    }

    #[test]
    fn storage_mode_serializes_all_variants_snake_case() {
        use super::VaultStorageMode;

        let cases = [
            (VaultStorageMode::EncryptedDir, "encrypted_dir"),
            (VaultStorageMode::UprivPlain, "upriv_plain"),
        ];

        for (mode, expected) in cases {
            let section = VaultStorageSection {
                mode,
                ..Default::default()
            };
            let raw = toml::to_string(&section).expect("serialize storage");
            assert!(
                raw.contains(expected),
                "expected {expected} in TOML, got: {raw}"
            );
        }
    }

    #[test]
    fn missing_storage_section_defaults_to_encrypted_dir() {
        let cfg: VaultConfig = toml::from_str(
            r#"
[vault]
id = "x"
display_name = "X"
"#,
        )
        .expect("minimal config");
        assert_eq!(cfg.storage_mode(), VaultStorageMode::EncryptedDir);
    }

    #[test]
    fn unknown_storage_mode_is_rejected() {
        let err = toml::from_str::<VaultStorageSection>("mode = \"future_mode\"")
            .expect_err("unknown mode must fail");
        let msg = err.to_string();
        assert!(
            msg.contains("future_mode") || msg.contains("unknown") || msg.contains("did not match"),
            "unexpected error: {msg}"
        );
    }

    #[test]
    fn unknown_security_fields_are_rejected() {
        toml::from_str::<VaultSecuritySection>("not_a_field = true")
            .expect_err("unknown security field");
    }

    #[test]
    fn unknown_auto_close_fields_are_rejected() {
        toml::from_str::<VaultAutoCloseSection>("not_a_field = true")
            .expect_err("unknown auto-close field");
    }

    #[test]
    fn unknown_file_manager_fields_are_rejected() {
        toml::from_str::<VaultFileManagerSection>("not_a_field = true")
            .expect_err("unknown file manager field");
    }

    #[test]
    fn a_missing_file_manager_section_asks_before_deleting() {
        let section: VaultFileManagerSection = toml::from_str("").unwrap();
        assert!(section.confirm_delete);
    }

    #[test]
    fn load_rejects_an_unknown_key_and_leaves_the_file() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = tmp.path().join("notes");
        crate::host_fs::create_dir_all(&vault_dir).unwrap();
        let original = r#"
[vault]
id = "notes"
display_name = "Notes"

[storage]
mode = "encrypted_dir"
not_a_field = true
"#;
        crate::host_fs::write(vault_dir.join("config.toml"), original).unwrap();
        let err = load_vault_config(&vault_dir).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
        let after = crate::host_fs::read_to_string(vault_dir.join("config.toml")).unwrap();
        assert_eq!(after, original);
    }

    #[test]
    fn load_leaves_a_current_config_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = tmp.path().join("notes");
        crate::host_fs::create_dir_all(&vault_dir).unwrap();
        let original = "\
[vault]
id = \"notes\"
display_name = \"Notes\"
";
        let path = vault_dir.join("config.toml");
        crate::host_fs::write(&path, original).unwrap();
        load_vault_config(&vault_dir).unwrap();
        let saved = crate::host_fs::read_to_string(&path).unwrap();
        assert_eq!(saved, original);
    }

    #[test]
    fn load_leaves_an_invalid_value_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = tmp.path().join("notes");
        crate::host_fs::create_dir_all(&vault_dir).unwrap();
        let original = r#"
[vault]
id = "notes"
display_name = "Notes"

[auto_close]
idle_minutes = "soon"
"#;
        let path = vault_dir.join("config.toml");
        crate::host_fs::write(&path, original).unwrap();
        let err = load_vault_config(&vault_dir).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
        let saved = crate::host_fs::read_to_string(&path).unwrap();
        assert_eq!(saved, original);
    }

    #[test]
    fn load_clamps_idle_minutes_without_rewriting() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = tmp.path().join("notes");
        crate::host_fs::create_dir_all(&vault_dir).unwrap();
        let original = "\
[vault]
id = \"notes\"
display_name = \"Notes\"

[auto_close]
enabled = true
idle_minutes = 40000
";
        let path = vault_dir.join("config.toml");
        crate::host_fs::write(&path, original).unwrap();
        let cfg = load_vault_config(&vault_dir).unwrap();
        assert_eq!(cfg.auto_close.idle_minutes, types::IDLE_MINUTES_MAX);
        assert_eq!(crate::host_fs::read_to_string(&path).unwrap(), original);

        crate::host_fs::write(
            &path,
            original.replace("idle_minutes = 40000", "idle_minutes = 0"),
        )
        .unwrap();
        let raised = load_vault_config(&vault_dir).unwrap();
        assert_eq!(raised.auto_close.idle_minutes, types::IDLE_MINUTES_MIN);
        assert!(crate::host_fs::read_to_string(&path)
            .unwrap()
            .contains("idle_minutes = 0"));
        let saved = serialize_vault_config_toml(&raised).unwrap();
        assert!(saved.contains("idle_minutes = 1"));
    }

    #[test]
    fn unknown_config_sections_are_rejected() {
        toml::from_str::<VaultConfig>(
            r#"
[vault]
id = "x"
display_name = "X"
[not_a_section]
not_a_field = true
"#,
        )
        .expect_err("unknown config section");
    }

    #[test]
    fn missing_optional_sections_use_ts_defaults() {
        let cfg: VaultConfig = toml::from_str(
            r#"
[vault]
id = "x"
display_name = "X"
"#,
        )
        .expect("minimal config");
        assert!(cfg.backup.enabled);
        assert_eq!(cfg.backup.keep_last, 1);
        assert!(cfg.backup.skip_unchanged);
        assert!(!cfg.auto_close.enabled);
        assert_eq!(cfg.auto_close.idle_minutes, 15);
        assert_eq!(cfg.auto_close.when_busy, AutoCloseWhenBusy::Wait);
        assert!(cfg.seven_zip.encrypt_file_names);
        assert_eq!(cfg.seven_zip.archive_mode, VaultArchiveMode::EncryptOnly);
        assert_eq!(
            cfg.unlocked_folder.encrypted,
            crate::folder_list::unlocked::EncryptedSwitch::Inherit
        );
        assert!(cfg.unlocked_folder.devices.is_empty());
        assert!(cfg.backup.devices.is_empty());
        assert!(!cfg.vault.hidden);
    }

    #[test]
    fn a_list_whose_selection_names_no_row_does_not_load() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = vault_dir_under_root(tmp.path());
        crate::host_fs::write(
            vault_dir.join("config.toml"),
            r#"
[vault]
id = "notes"
display_name = "Notes"
[unlocked_folder.devices.3e301fc022fc5185e12822bc2a251f64]
system = "linux"
selected = 3
next_number = 1
"#,
        )
        .unwrap();
        match load_vault_config(&vault_dir).unwrap_err() {
            UprivError::VaultConfigInvalid { detail, .. } => {
                assert!(detail.contains("[unlocked_folder]"), "{detail}");
            }
            other => panic!("expected VaultConfigInvalid, got {other:?}"),
        }
    }

    #[test]
    fn a_row_path_that_does_not_validate_still_loads() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = vault_dir_under_root(tmp.path());
        crate::host_fs::write(
            vault_dir.join("config.toml"),
            r#"
[vault]
id = "notes"
display_name = "Notes"
[backup.devices.3e301fc022fc5185e12822bc2a251f64]
system = "linux"
selected = 1
next_number = 2
[[backup.devices.3e301fc022fc5185e12822bc2a251f64.rows]]
number = 1
path = "relative/backups"
"#,
        )
        .unwrap();
        let cfg = load_vault_config(&vault_dir).expect("a row path never fails a load");
        let rows: Vec<_> = cfg
            .backup
            .devices
            .0
            .values()
            .flat_map(|group| group.rows.iter())
            .collect();
        assert_eq!(rows[0].path, "relative/backups");
    }

    #[test]
    fn serialize_roundtrip_preserves_all_ts_sections() {
        let cfg = VaultConfig {
            vault: VaultIdentitySection {
                id: "notes".into(),
                display_name: "Notes".into(),
                order: 2,
                note: "hi".into(),
                hidden: true,
                password_hint: "".into(),
            },
            storage: VaultStorageSection::default(),
            unlocked_folder: crate::folder_list::unlocked::VaultUnlockedFolder {
                encrypted: crate::folder_list::unlocked::EncryptedSwitch::On,
                devices: Default::default(),
            },
            backup: VaultBackupSection {
                enabled: false,
                mode: VaultBackupMode::KeepAll,
                keep_last: 5,
                skip_unchanged: false,
                ..VaultBackupSection::default()
            },
            security: VaultSecuritySection {
                wipe_passes: 2,
                wipe_pattern: VaultWipePattern::Zeros,
                password_changed_at: Some("2026-01-01T00:00:00Z".into()),
            },
            auto_close: VaultAutoCloseSection {
                enabled: true,
                idle_minutes: 30,
                when_busy: AutoCloseWhenBusy::Close,
            },
            file_manager: VaultFileManagerSection {
                confirm_delete: false,
            },
            seven_zip: VaultSevenZipSection {
                encrypt_file_names: false,
                archive_mode: VaultArchiveMode::CompressEncrypt,
                compression_level: 5,
                solid: true,
            },
        };
        let tmp = tempfile::tempdir().unwrap();
        let vaults = tmp.path().join(".upriv").join("vaults");
        let vault_dir = vaults.join("notes");
        crate::host_fs::create_dir_all(&vault_dir).unwrap();
        let raw = serialize_vault_config_toml(&cfg).expect("serialize");
        for section in [
            "[backup]",
            "[security]",
            "[auto_close]",
            "[file_manager]",
            "[seven_zip]",
            "[unlocked_folder]",
        ] {
            assert!(raw.contains(section), "missing {section} in:\n{raw}");
        }
        crate::host_fs::write(vault_dir.join("config.toml"), &raw).unwrap();
        let loaded = load_vault_config(&vault_dir).expect("reload");
        assert_eq!(loaded.backup, cfg.backup);
        assert_eq!(loaded.unlocked_folder, cfg.unlocked_folder);
        assert_eq!(loaded.security, cfg.security);
        assert_eq!(loaded.auto_close, cfg.auto_close);
        assert_eq!(loaded.file_manager, cfg.file_manager);
        assert_eq!(loaded.seven_zip, cfg.seven_zip);
        assert!(loaded.vault.hidden);
        assert!(
            raw.contains("hidden = true"),
            "hidden must be serialized, got:\n{raw}"
        );
        assert!(
            raw.contains("skip_unchanged = false"),
            "skip_unchanged must be serialized, got:\n{raw}"
        );
    }

    #[test]
    fn hidden_true_parses_from_vault_section() {
        let cfg: VaultConfig = toml::from_str(
            r#"
[vault]
id = "secret"
display_name = "Secret"
hidden = true
"#,
        )
        .expect("hidden vault config");
        assert!(cfg.vault.hidden);
    }
}
