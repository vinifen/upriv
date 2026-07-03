use std::fs;
use std::path::PathBuf;
use std::process::Command;

use upriv_core::{
    load_app_settings, load_vault_config, plain_close, plain_open, PersistenceState, SecuritySection,
    SessionPassword, SevenZip, VaultRoot,
};

fn resolve_7z() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("UPRIV_7ZZ_PATH") {
        return Some(PathBuf::from(path));
    }
    let output = Command::new("which").arg("7z").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Some(PathBuf::from(path))
}

fn bootstrap_vault(root: &PathBuf, vault_id: &str, display_name: &str) {
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

    let vault_dir = root.join(".upriv/vaults").join(vault_id);
    fs::create_dir_all(vault_dir.join("archive")).unwrap();
    fs::write(
        vault_dir.join("config.toml"),
        format!(
            r#"
[vault]
id = "{vault_id}"
display_name = "{display_name}"
vault_file = "archive/{display_name}.7z"

[storage]
mode = "plain"

[security]
secure_wipe_workspace = true
wipe_passes = 1
wipe_pattern = "zeros"
"#
        ),
    )
    .unwrap();
}

#[test]
fn plain_mode_open_edit_close_integration() {
    let Some(binary) = resolve_7z() else {
        eprintln!("skipping plain_mode_open_edit_close_integration: 7z not found");
        return;
    };

    let temp = tempfile::tempdir().unwrap();
    let root_path = temp.path().to_path_buf();
    bootstrap_vault(&root_path, "notes", "My Notes");

    let root = VaultRoot::discover(&root_path).unwrap();
    let settings = load_app_settings(&root).unwrap();
    let config = load_vault_config(&root, "notes").unwrap();
    let seven_zip = SevenZip::from_binary(&binary).with_vault_options(&config);

    let archive = root.vault_archive_path(&config);
    let workspace = root.workspace_dir(&settings, "My Notes");

    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("secret.txt"), b"version-1").unwrap();
    seven_zip
        .create_from_dir(&workspace, &archive, "hunter2")
        .expect("seed archive");
    upriv_core::plain::wipe_workspace(&workspace, &SecuritySection::default()).unwrap();

    let session = plain_open(&root, "notes", SessionPassword::from("hunter2"), &seven_zip)
        .expect("plain open");
    fs::write(session.workspace_path.join("secret.txt"), b"version-2").unwrap();

    plain_close(&root, session, &seven_zip).expect("plain close");

    assert!(!workspace.exists());
    assert!(archive.is_file());

    let persistence: upriv_core::config::VaultPersistence =
        serde_json::from_str(&fs::read_to_string(root.vault_persistence_path("notes")).unwrap())
            .unwrap();
    assert_eq!(persistence.persistence, PersistenceState::Sealed);
}
