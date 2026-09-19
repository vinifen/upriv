//! Load per-vault `config.toml` (read-only stub for list / future open-close).

mod types;

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};

pub use types::{
    VaultArchiveMode, VaultAutoCloseSection, VaultBackupMode, VaultBackupSection, VaultConfig,
    VaultIdentitySection, VaultMountSection, VaultPolicySection, VaultSecurityMode,
    VaultSecuritySection, VaultSevenZipMethod, VaultSevenZipSection, VaultStorageMode,
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

/// Derive vault-root from `…/.upriv/vaults/<id>` (parent of `.upriv`).
///
/// Returns `None` when the vault dir is not under the canonical layout (e.g. a
/// temp fixture written as `tmp/notes` without `.upriv/vaults/`).
fn vault_root_for_config(vault_dir: &Path) -> Option<&Path> {
    let vaults = vault_dir.parent()?;
    let upriv = vaults.parent()?;
    let root = upriv.parent()?;
    let vaults_name = vaults.file_name()?;
    let upriv_name = upriv.file_name()?;
    if !vaults_name.eq_ignore_ascii_case("vaults") {
        return None;
    }
    if !upriv_name.eq_ignore_ascii_case(".upriv") {
        return None;
    }
    Some(root)
}

fn map_mount_validate_error(path: &Path, error: UprivError) -> UprivError {
    match error {
        UprivError::WorkspacePathInvalid { path: p, detail } => UprivError::VaultConfigInvalid {
            path: path.to_path_buf(),
            detail: format!("[mount].workspace_path ({}): {detail}", p.display()),
        },
        UprivError::WorkspacePathReserved(p) => UprivError::VaultConfigInvalid {
            path: path.to_path_buf(),
            detail: format!("[mount].workspace_path reserved: {}", p.display()),
        },
        other => other,
    }
}

/// Parse + identity/storage validate; normalizes mount path. **Does not** validate
/// mount absolute/reserved — use for list so a bad mount does not hide the vault.
pub fn load_vault_config_raw(vault_dir: impl AsRef<Path>) -> Result<VaultConfig> {
    let vault_dir = vault_dir.as_ref();
    let path = vault_config_path(vault_dir);
    if !path.is_file() {
        return Err(UprivError::VaultConfigInvalid {
            path: path.clone(),
            detail: "missing config.toml".into(),
        });
    }
    let raw = std::fs::read_to_string(&path).map_err(UprivError::from)?;
    let mut parsed: VaultConfig =
        toml::from_str(&raw).map_err(|error| UprivError::VaultConfigInvalid {
            path: path.clone(),
            detail: format!("invalid config.toml: {error}"),
        })?;

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

    let mount_workspace_path =
        crate::paths::normalize_mount_workspace_path(&parsed.mount.workspace_path);

    Ok(VaultConfig {
        vault: parsed.vault,
        storage: parsed.storage,
        mount: VaultMountSection {
            workspace_path: mount_workspace_path,
        },
        backup: parsed.backup,
        security: VaultSecuritySection {
            mode: parsed.security.mode.normalized(),
            ..parsed.security
        },
        auto_close: parsed.auto_close,
        seven_zip: parsed.seven_zip,
        policy: parsed.policy,
    })
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

/// Load and fully validate a vault `config.toml` (identity + mount).
///
/// Requires `[vault].id` and `[vault].display_name`. Other sections use defaults when absent.
/// Mount validation uses [`vault_root_for_config`] when the vault sits under
/// `.upriv/vaults/<id>`.
pub fn load_vault_config(vault_dir: impl AsRef<Path>) -> Result<VaultConfig> {
    let vault_dir = vault_dir.as_ref();
    let path = vault_config_path(vault_dir);
    let config = load_vault_config_raw(vault_dir)?;
    let vault_root = vault_root_for_config(vault_dir);
    crate::paths::validate_mount_workspace_path(&config.mount.workspace_path, vault_root)
        .map_err(|error| map_mount_validate_error(&path, error))?;
    Ok(config)
}

/// Persist a full `config.toml`. Does not create the vault directory (parent must exist).
pub fn save_vault_config(vault_dir: impl AsRef<Path>, config: &VaultConfig) -> Result<()> {
    let path = vault_config_path(vault_dir);
    let body = serialize_vault_config_toml(config)?;
    crate::paths::write_bytes_atomic_existing_parent(&path, body.as_bytes())
}

/// Set `[vault].hidden`. Returns whether the flag changed.
///
/// Uses raw load + skip mount revalidation so a bad `[mount].workspace_path`
/// cannot block hide/unhide (list already shows those vaults).
pub fn set_vault_hidden(vault_dir: impl AsRef<Path>, hidden: bool) -> Result<bool> {
    let vault_dir = vault_dir.as_ref();
    let mut config = load_vault_config_raw(vault_dir)?;
    if config.vault.hidden == hidden {
        return Ok(false);
    }
    config.vault.hidden = hidden;
    let path = vault_config_path(vault_dir);
    let body = serialize_vault_config_toml_unchecked(&config)?;
    crate::paths::write_bytes_atomic_existing_parent(&path, body.as_bytes())?;
    Ok(true)
}

/// Serialize a vault config to TOML (full-file; all sections). Used by round-trip
/// tests and future `vault_config_save` — missing sections must not be dropped.
///
/// Validates `[mount].workspace_path` before writing (relative / reserved rejected).
pub fn serialize_vault_config_toml(config: &VaultConfig) -> Result<String> {
    crate::paths::validate_mount_workspace_path(&config.mount.workspace_path, None).map_err(
        |error| match error {
            UprivError::WorkspacePathInvalid { path: p, detail } => {
                UprivError::VaultConfigInvalid {
                    path: PathBuf::from("config.toml"),
                    detail: format!("[mount].workspace_path ({}): {detail}", p.display()),
                }
            }
            UprivError::WorkspacePathReserved(p) => UprivError::VaultConfigInvalid {
                path: PathBuf::from("config.toml"),
                detail: format!("[mount].workspace_path reserved: {}", p.display()),
            },
            other => other,
        },
    )?;
    serialize_vault_config_toml_unchecked(config)
}

fn serialize_vault_config_toml_unchecked(config: &VaultConfig) -> Result<String> {
    let mut config = config.clone();
    config.vault.display_name = crate::paths::normalize_stored_name(&config.vault.display_name);
    config.security.mode = config.security.mode.normalized();
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
    use crate::test_support::{write_vault_dir, VaultSpec};

    /// Canonical layout: `<root>/.upriv/vaults/<id>/`.
    fn vault_dir_under_root(root: &Path) -> PathBuf {
        let vaults = root.join(".upriv").join("vaults");
        std::fs::create_dir_all(&vaults).unwrap();
        write_vault_dir(&vaults, &VaultSpec::encrypted("notes", "Notes", 1))
    }

    #[test]
    fn vault_root_for_config_walks_upriv_vaults() {
        let root = Path::new("/data/user/Upriv");
        let vault_dir = root.join(".upriv/vaults/notes");
        assert_eq!(vault_root_for_config(&vault_dir), Some(root));
        assert!(vault_root_for_config(Path::new("/tmp/notes")).is_none());
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
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::write(
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
        std::fs::create_dir_all(&vault_dir).unwrap();
        std::fs::write(
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
            let section = VaultStorageSection { mode };
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
    fn unknown_storage_modes_are_rejected() {
        for mode in [
            "store_only",
            "upriv_only",
            "ram_only",
            "plain",
            "plain_only",
        ] {
            toml::from_str::<VaultStorageSection>(&format!("mode = \"{mode}\""))
                .expect_err(&format!("{mode} is not a storage mode"));
        }
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
        assert_eq!(cfg.security.mode, VaultSecurityMode::SessionRam);
        assert!(cfg.security.secure_wipe_workspace);
        assert!(!cfg.auto_close.enabled);
        assert_eq!(cfg.auto_close.idle_minutes, 15);
        assert!(cfg.seven_zip.encrypt_file_names);
        assert_eq!(cfg.seven_zip.archive_mode, VaultArchiveMode::EncryptOnly);
        assert!(!cfg.policy.allow_external_editors);
        assert!(cfg.policy.disallow_copy_outside_mount);
        assert!(cfg.policy.require_unmount_on_sleep);
        assert_eq!(cfg.mount.workspace_path, "default");
        assert!(!cfg.vault.hidden);
    }

    #[test]
    fn load_rejects_relative_mount_under_canonical_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = vault_dir_under_root(tmp.path());
        std::fs::write(
            vault_dir.join("config.toml"),
            r#"
[vault]
id = "notes"
display_name = "Notes"
[mount]
workspace_path = "relative/mount"
"#,
        )
        .unwrap();
        let err = load_vault_config(&vault_dir).unwrap_err();
        match err {
            UprivError::VaultConfigInvalid { detail, .. } => {
                assert!(
                    detail.contains("[mount].workspace_path"),
                    "unexpected detail: {detail}"
                );
            }
            other => panic!("expected VaultConfigInvalid, got {other:?}"),
        }
        // Raw/list path still loads identity.
        let raw = load_vault_config_raw(&vault_dir).expect("raw load");
        assert_eq!(raw.id(), "notes");
        assert_eq!(raw.mount.workspace_path, "relative/mount");
    }

    #[test]
    fn serialize_rejects_relative_mount() {
        let cfg = VaultConfig {
            vault: VaultIdentitySection {
                id: "notes".into(),
                display_name: "Notes".into(),
                order: 0,
                note: String::new(),
                hidden: false,
                password_hint: String::new(),
            },
            storage: VaultStorageSection {
                mode: VaultStorageMode::EncryptedDir,
            },
            mount: VaultMountSection {
                workspace_path: "relative/mount".into(),
            },
            backup: VaultBackupSection::default(),
            security: VaultSecuritySection::default(),
            auto_close: VaultAutoCloseSection::default(),
            seven_zip: VaultSevenZipSection::default(),
            policy: VaultPolicySection::default(),
        };
        let err = serialize_vault_config_toml(&cfg).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
    }

    #[test]
    fn serialize_roundtrip_preserves_all_ts_sections() {
        let mut cfg = VaultConfig {
            vault: VaultIdentitySection {
                id: "notes".into(),
                display_name: "Notes".into(),
                order: 2,
                note: "hi".into(),
                hidden: true,
                password_hint: "".into(),
            },
            storage: VaultStorageSection {
                mode: VaultStorageMode::EncryptedDir,
            },
            mount: VaultMountSection {
                workspace_path: "/tmp/open".into(),
            },
            backup: VaultBackupSection {
                enabled: false,
                mode: VaultBackupMode::KeepAll,
                keep_last: 5,
            },
            security: VaultSecuritySection {
                mode: VaultSecurityMode::AlwaysPrompt,
                secure_wipe_workspace: false,
                wipe_passes: 2,
                wipe_pattern: VaultWipePattern::Zeros,
                password_changed_at: Some("2026-01-01T00:00:00Z".into()),
            },
            auto_close: VaultAutoCloseSection {
                enabled: true,
                idle_minutes: 30,
                warn_before_seconds: 90,
                close_on_app_exit: true,
            },
            seven_zip: VaultSevenZipSection {
                encrypt_file_names: false,
                archive_mode: VaultArchiveMode::CompressEncrypt,
                compression_level: 5,
                solid: true,
                method: VaultSevenZipMethod::Lzma2,
            },
            policy: VaultPolicySection {
                allow_external_editors: true,
                disallow_copy_outside_mount: false,
                require_unmount_on_sleep: false,
            },
        };
        let tmp = tempfile::tempdir().unwrap();
        let vaults = tmp.path().join(".upriv").join("vaults");
        let vault_dir = vaults.join("notes");
        std::fs::create_dir_all(&vault_dir).unwrap();
        let raw = serialize_vault_config_toml(&cfg).expect("serialize");
        for section in [
            "[backup]",
            "[security]",
            "[auto_close]",
            "[seven_zip]",
            "[policy]",
            "[mount]",
        ] {
            assert!(raw.contains(section), "missing {section} in:\n{raw}");
        }
        std::fs::write(vault_dir.join("config.toml"), &raw).unwrap();
        let loaded = load_vault_config(&vault_dir).expect("reload");
        cfg.mount.workspace_path = "/tmp/open".into();
        assert_eq!(loaded.backup, cfg.backup);
        assert_eq!(loaded.security, cfg.security);
        assert_eq!(loaded.auto_close, cfg.auto_close);
        assert_eq!(loaded.seven_zip, cfg.seven_zip);
        assert_eq!(loaded.policy, cfg.policy);
        assert_eq!(loaded.mount.workspace_path, "/tmp/open");
        assert!(loaded.vault.hidden);
        assert!(
            raw.contains("hidden = true"),
            "hidden must be serialized, got:\n{raw}"
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

    #[test]
    fn ram_on_close_only_loads_as_session_ram() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = vault_dir_under_root(tmp.path());
        std::fs::write(
            vault_dir.join("config.toml"),
            r#"
[vault]
id = "notes"
display_name = "Notes"
[security]
mode = "ram_on_close_only"
"#,
        )
        .unwrap();
        let loaded = load_vault_config_raw(&vault_dir).expect("load");
        assert_eq!(loaded.security.mode, VaultSecurityMode::SessionRam);
    }
}
