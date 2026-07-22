//! Load per-vault `config.toml` (read-only stub for list / future open-close).

mod types;

use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};

pub use types::{VaultConfig, VaultIdentitySection, VaultStorageMode, VaultStorageSection};

const CONFIG_FILE_NAME: &str = "config.toml";

/// Absolute path to `vaults/<id>/config.toml`.
pub fn vault_config_path(vault_dir: impl AsRef<Path>) -> PathBuf {
    vault_dir.as_ref().join(CONFIG_FILE_NAME)
}

/// Load and validate a vault `config.toml`.
///
/// Requires `[vault].id` and `[vault].display_name`. Other sections use defaults when absent.
pub fn load_vault_config(vault_dir: impl AsRef<Path>) -> Result<VaultConfig> {
    let vault_dir = vault_dir.as_ref();
    let path = vault_config_path(vault_dir);
    if !path.is_file() {
        return Err(UprivError::VaultConfigInvalid {
            path: path.clone(),
            detail: "missing config.toml".into(),
        });
    }
    let raw = std::fs::read_to_string(&path).map_err(UprivError::from)?;
    let parsed: VaultConfig =
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
    if parsed.vault.display_name.trim().is_empty() {
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

    fn prod_example_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("prod-example")
    }

    #[test]
    fn loads_prod_example_encrypted_notes() {
        let dir = prod_example_root().join(".upriv/vaults/my-encrypted-notes");
        let cfg = load_vault_config(&dir).expect("prod-example config");
        assert_eq!(cfg.id(), "my-encrypted-notes");
        assert_eq!(cfg.display_name(), "My Encrypted Notes");
        assert_eq!(cfg.storage_mode(), VaultStorageMode::EncryptedDir);
        assert_eq!(cfg.vault.order, 4);
    }

    #[test]
    fn loads_prod_example_plain_folder() {
        let dir = prod_example_root().join(".upriv/vaults/plain-folder-demo");
        let cfg = load_vault_config(&dir).expect("plain config");
        assert_eq!(cfg.storage_mode(), VaultStorageMode::Plain);
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
}
