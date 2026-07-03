#![cfg(all(target_os = "linux", feature = "fuse"))]
//! Real mount integration: read/write through the FUSE mountpoint (not the store API).

use std::path::Path;
use std::time::Duration;

use upriv_core::{create_vault, encrypted_dir_close, encrypted_dir_open, SevenZip, VaultConfig, VaultRoot};

fn write_settings(root: &Path) {
    std::fs::create_dir_all(root.join(".upriv")).unwrap();
    std::fs::write(
        root.join(".upriv/settings.toml"),
        "[package]\nvaults_dir = \".upriv/vaults\"\nworkspace_dir = \"workspace\"\napp_dir = \".upriv/app\"\n",
    )
    .unwrap();
}

fn encrypted_config(id: &str, name: &str) -> VaultConfig {
    let toml = format!(
        "[vault]\nid = \"{id}\"\ndisplay_name = \"{name}\"\nvault_file = \"archive/{name}.7z\"\n\n[storage]\nmode = \"encrypted_dir\"\n"
    );
    toml::from_str(&toml).unwrap()
}

fn resolve_7z() -> Option<std::path::PathBuf> {
    let out = std::process::Command::new("which").arg("7z").output().ok()?;
    out.status.success().then(|| {
        std::path::PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
    })
}

#[test]
fn read_and_write_through_mount() {
    let Some(binary) = resolve_7z() else {
        eprintln!("skipping read_and_write_through_mount: 7z not found");
        return;
    };

    let temp = tempfile::tempdir().unwrap();
    write_settings(temp.path());
    let root = VaultRoot::discover(temp.path()).unwrap();
    let seven_zip = SevenZip::from_binary(&binary);
    create_vault(&root, encrypted_config("notes", "Notes"), "pw", &seven_zip).unwrap();

    let session = encrypted_dir_open(&root, "notes", "pw", &seven_zip).unwrap();
    let mount = session.workspace_path().to_path_buf();

    // Give the background session a moment to settle.
    std::thread::sleep(Duration::from_millis(200));

    // Read existing file through the actual mount.
    let readme = mount.join("README.txt");
    let via_mount = std::fs::read(&readme).expect("read README via mount");
    assert!(!via_mount.is_empty(), "README.txt should have content");

    // Overwrite through the mount.
    std::fs::write(&readme, b"changed via mount").expect("write via mount");
    let after = std::fs::read(&readme).expect("re-read via mount");
    assert_eq!(after, b"changed via mount");

    encrypted_dir_close(&root, session, false, &seven_zip).unwrap();

    // Reopen and confirm persistence through the store.
    let session = encrypted_dir_open(&root, "notes", "pw", &seven_zip).unwrap();
    let data = session.read_file("README.txt").unwrap();
    encrypted_dir_close(&root, session, false, &seven_zip).unwrap();
    assert_eq!(data, b"changed via mount");
}

#[test]
fn create_mkdir_nested_unlink_rename_through_mount() {
    let Some(binary) = resolve_7z() else {
        eprintln!("skipping create_mkdir_nested_unlink_rename_through_mount: 7z not found");
        return;
    };

    let temp = tempfile::tempdir().unwrap();
    write_settings(temp.path());
    let root = VaultRoot::discover(temp.path()).unwrap();
    let seven_zip = SevenZip::from_binary(&binary);
    create_vault(&root, encrypted_config("ops", "Ops"), "pw", &seven_zip).unwrap();

    let session = encrypted_dir_open(&root, "ops", "pw", &seven_zip).unwrap();
    let mount = session.workspace_path().to_path_buf();
    std::thread::sleep(Duration::from_millis(200));

    // mkdir + nested file
    std::fs::create_dir(mount.join("sub")).expect("mkdir sub");
    std::fs::write(mount.join("sub/inner.txt"), b"nested").expect("write nested");
    std::fs::create_dir(mount.join("empty")).expect("mkdir empty");

    // create top-level file then rename it into the subdir
    std::fs::write(mount.join("top.txt"), b"top").expect("write top");
    std::fs::rename(mount.join("top.txt"), mount.join("sub/moved.txt")).expect("rename");

    // unlink the original README
    std::fs::remove_file(mount.join("README.txt")).expect("unlink readme");

    // readdir reflects nested structure
    let nested = std::fs::read(mount.join("sub/inner.txt")).expect("read nested");
    assert_eq!(nested, b"nested");

    encrypted_dir_close(&root, session, false, &seven_zip).unwrap();

    // Reopen: verify all structural changes persisted through close (store + .7z).
    let session = encrypted_dir_open(&root, "ops", "pw", &seven_zip).unwrap();
    let mount = session.workspace_path().to_path_buf();
    std::thread::sleep(Duration::from_millis(200));

    assert_eq!(std::fs::read(mount.join("sub/inner.txt")).unwrap(), b"nested");
    assert_eq!(std::fs::read(mount.join("sub/moved.txt")).unwrap(), b"top");
    assert!(!mount.join("README.txt").exists(), "README should be gone");
    assert!(!mount.join("top.txt").exists(), "top.txt was renamed away");
    assert!(mount.join("empty").is_dir(), "empty dir should survive");

    encrypted_dir_close(&root, session, false, &seven_zip).unwrap();
}
