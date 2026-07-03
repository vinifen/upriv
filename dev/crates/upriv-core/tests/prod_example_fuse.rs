#![cfg(all(target_os = "linux", feature = "fuse"))]
//! Opens a real prod-example vault in **release** profile and asserts FUSE is active.

use std::path::Path;
use std::time::Duration;

use upriv_core::{
    encrypted_dir_close, encrypted_dir_open, path_is_fuse_mount, VaultRoot, WorkspaceMountKind,
    SevenZip,
};

fn prod_example_root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("prod-example")
}

fn resolve_7z(root: &VaultRoot) -> Option<SevenZip> {
    let settings = upriv_core::load_app_settings(root).ok()?;
    upriv_core::SevenZip::resolve(root, &settings).ok()
}

#[test]
fn prod_example_workspace_uses_fuse_in_release() {
    assert!(
        !cfg!(debug_assertions),
        "run with `cargo test -p upriv-core --release prod_example_workspace_uses_fuse_in_release`"
    );

    let root = VaultRoot::discover(prod_example_root()).expect("prod-example vault root");
    let seven_zip = resolve_7z(&root).expect("7zz for prod-example");
    let vault_id = std::env::var("UPRIV_TEST_VAULT").unwrap_or_else(|_| "teste1".to_string());
    let password = std::env::var("UPRIV_TEST_PASSWORD").unwrap_or_else(|_| "teste1".to_string());

    let settings = upriv_core::load_app_settings(&root).expect("settings");
    let config = upriv_core::load_vault_config(&root, &vault_id).expect("vault config");
    let mountpoint = root.workspace_dir(&settings, &config.vault.display_name);

    // Clean stale dev plaintext workspace from prior debug sessions.
    if mountpoint.exists() {
        std::fs::remove_dir_all(&mountpoint).expect("remove stale workspace");
    }
    let _ = std::fs::remove_file(root.runtime_lock_path(&vault_id));

    let session = encrypted_dir_open(&root, &vault_id, password.as_str(), &seven_zip)
        .expect("open encrypted_dir vault");

    assert_eq!(
        session.workspace_mount_kind(),
        WorkspaceMountKind::VirtualFuse,
        "release build must not use dev plaintext fallback"
    );

    std::thread::sleep(Duration::from_millis(250));

    assert!(
        path_is_fuse_mount(session.workspace_path()),
        "workspace path should be backed by FUSE, not ext4 plaintext"
    );

    let probe = session.workspace_path().join("fuse-probe.txt");
    std::fs::write(&probe, b"fuse ok").expect("write through mount");
    assert!(probe.exists());

    encrypted_dir_close(&root, session, false, &seven_zip).expect("close vault");
}
