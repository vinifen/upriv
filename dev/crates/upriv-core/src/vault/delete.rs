use std::fs;

use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;

/// Remove `vaults/<vault_id>/` when the vault is not open (no runtime lock).
pub fn delete_vault(root: &VaultRoot, vault_id: &str) -> Result<()> {
    if root.runtime_lock_path(vault_id).is_file() {
        return Err(UprivError::VaultAlreadyOpen(vault_id.to_string()));
    }

    let vault_dir = root.vault_dir(vault_id);
    if !vault_dir.is_dir() {
        return Err(UprivError::VaultNotFound(vault_id.to_string()));
    }

    fs::remove_dir_all(&vault_dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::create::create_vault;
    use crate::{SevenZip, VaultConfig};
    use std::path::Path;
    use tempfile::tempdir;

    fn write_minimal_settings(root: &Path) {
        fs::create_dir_all(root.join(".upriv")).unwrap();
        fs::write(
            root.join(".upriv/settings.toml"),
            r#"
[package]
vaults_dir = ".upriv/vaults"
workspace_dir = "workspace"
app_dir = ".upriv/app"
"#,
        )
        .unwrap();
    }

    fn sample_config(vault_id: &str, display_name: &str) -> VaultConfig {
        let toml = format!(
            r#"
[vault]
id = "{vault_id}"
display_name = "{display_name}"
vault_file = "archive/{display_name}.7z"

[storage]
mode = "plain"
"#
        );
        toml::from_str(&toml).unwrap()
    }

    fn resolve_7z() -> Option<std::path::PathBuf> {
        std::process::Command::new("which")
            .arg("7z")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| std::path::PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()))
    }

    #[test]
    fn deletes_existing_vault_directory() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping deletes_existing_vault_directory: 7z not found");
            return;
        };

        let temp = tempdir().unwrap();
        write_minimal_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let config = sample_config("notes", "My Notes");
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, config, "secret", &seven_zip).unwrap();
        assert!(root.vault_dir("notes").is_dir());

        delete_vault(&root, "notes").unwrap();
        assert!(!root.vault_dir("notes").exists());
    }
}
