use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

use sha2::{Digest, Sha256};

use crate::config::{
    load_app_settings, load_vault_config, PersistenceState, StorageMode, VaultConfig,
    VaultPersistence,
};
use crate::error::{Result, UprivError};
use crate::mount::mount_workspace;
use crate::paths::VaultRoot;
use crate::plain::{secure_wipe_path, WipeOptions};
use crate::session::SessionPassword;
use crate::seven_zip::SevenZip;
use crate::store::{compute_store_hash, seed_initial_file, EncryptedStore};

#[cfg(all(target_os = "linux", feature = "fuse"))]
use crate::mount::FuseMount;

/// How the open vault exposes `workspace/{display_name}/` to the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMountKind {
    /// FUSE virtual mount — decrypted bytes served from the encrypted store (production).
    VirtualFuse,
    /// Debug-only plaintext export on disk when FUSE is unavailable (`debug_assertions` builds).
    DevPlaintext,
}

pub struct EncryptedDirSession {
    pub vault_id: String,
    pub display_name: String,
    mountpoint: PathBuf,
    store: Arc<RwLock<EncryptedStore>>,
    password: SessionPassword,
    /// Debug-only: FUSE unavailable — workspace holds plaintext files (not a virtual mount).
    dev_plaintext_workspace: bool,
    #[cfg(all(target_os = "linux", feature = "fuse"))]
    fuse: Option<FuseMount>,
}

impl EncryptedDirSession {
    pub fn workspace_path(&self) -> &Path {
        &self.mountpoint
    }

    pub fn read_file(&self, path: &str) -> Result<Vec<u8>> {
        self.store
            .read()
            .expect("store lock")
            .read_file(path)
    }

    pub fn password(&self) -> &SessionPassword {
        &self.password
    }

    /// Replace the cached session password (used after an in-session password change).
    pub fn set_password(&mut self, password: SessionPassword) {
        self.password = password;
    }

    pub fn workspace_mount_kind(&self) -> WorkspaceMountKind {
        if self.dev_plaintext_workspace {
            WorkspaceMountKind::DevPlaintext
        } else {
            WorkspaceMountKind::VirtualFuse
        }
    }
}

pub fn open(
    root: &VaultRoot,
    vault_id: &str,
    password: impl Into<SessionPassword>,
    seven_zip: &SevenZip,
) -> Result<EncryptedDirSession> {
    let settings = load_app_settings(root)?;
    let config = load_vault_config(root, vault_id)?;
    ensure_encrypted_dir(&config)?;

    let archive_path = root.vault_archive_path(&config);
    if !archive_path.is_file() {
        return Err(UprivError::ArchiveNotFound(archive_path));
    }

    let store_dir = root.vault_store_dir(&config);

    let password = password.into();
    let password_str = password.as_str().ok_or_else(|| {
        UprivError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "vault password must be valid UTF-8",
        ))
    })?;

    seven_zip.test(&archive_path, password_str)?;

    // Sealed vault (store wiped): re-materialize the encrypted store from the `.7z`.
    if !store_dir.join("vault.header").is_file() {
        materialize_store_from_archive(
            &archive_path,
            &store_dir,
            vault_id,
            password_str,
            seven_zip,
        )?;
    }

    let store = EncryptedStore::open(&store_dir, password_str)?;
    let store = Arc::new(RwLock::new(store));

    let mountpoint = root.workspace_dir(&settings, &config.vault.display_name);
    if mountpoint.exists() {
        if !try_reclaim_stale_workspace(root, vault_id, &mountpoint)? {
            return Err(UprivError::WorkspaceExists(mountpoint.clone()));
        }
    }
    if let Some(parent) = mountpoint.parent() {
        fs::create_dir_all(parent)?;
    }
    // FUSE creates the leaf mountpoint; pre-creating it makes `fuser` fail with EEXIST.

    acquire_lock(root, vault_id)?;

    #[allow(unused_assignments)]
    let mut dev_plaintext_workspace = false;

    let restrict_copy = config.policy.disallow_copy_outside_mount;

    #[cfg(all(target_os = "linux", feature = "fuse"))]
    let fuse = match mount_workspace(Arc::clone(&store), mountpoint.clone(), restrict_copy) {
        Ok(fuse) => Some(fuse),
        Err(UprivError::Mount(_)) if cfg!(debug_assertions) => {
            dev_plaintext_workspace = true;
            fs::create_dir_all(&mountpoint)?;
            store
                .read()
                .expect("store lock")
                .export_logical_tree(&mountpoint)?;
            None
        }
        Err(err) => {
            let _ = fs::remove_dir_all(&mountpoint);
            let _ = release_lock(root, vault_id);
            return Err(err);
        }
    };

    #[cfg(not(all(target_os = "linux", feature = "fuse")))]
    match mount_workspace(Arc::clone(&store), mountpoint.clone(), restrict_copy) {
        Ok(_) => unreachable!("mount without fuse feature"),
        Err(UprivError::Mount(_)) if cfg!(debug_assertions) => {
            dev_plaintext_workspace = true;
            fs::create_dir_all(&mountpoint)?;
            store
                .read()
                .expect("store lock")
                .export_logical_tree(&mountpoint)?;
        }
        Err(err) => {
            let _ = fs::remove_dir_all(&mountpoint);
            let _ = release_lock(root, vault_id);
            return Err(err);
        }
    }

    let _ = crate::session::persist_disk_session(root, vault_id, &password);

    Ok(EncryptedDirSession {
        vault_id: vault_id.to_string(),
        display_name: config.vault.display_name.clone(),
        mountpoint,
        store,
        password,
        dev_plaintext_workspace,
        #[cfg(all(target_os = "linux", feature = "fuse"))]
        fuse,
    })
}

/// Close an `encrypted_dir` vault.
///
/// `seal = false` keeps the encrypted store as a fast-reopen cache (state `closed`).
/// `seal = true` wipes the store after rebuilding the `.7z`, leaving only the portable
/// archive (state `sealed`) per PRD §1.7.
pub fn close(
    root: &VaultRoot,
    session: EncryptedDirSession,
    seal: bool,
    seven_zip: &SevenZip,
) -> Result<()> {
    let config = load_vault_config(root, &session.vault_id)?;
    ensure_encrypted_dir(&config)?;

    let password_str = session
        .password()
        .as_str()
        .ok_or_else(|| {
            UprivError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "vault password must be valid UTF-8",
            ))
        })?
        .to_string();

    let mountpoint = session.mountpoint.clone();
    let vault_id = session.vault_id.clone();
    let dev_plaintext_workspace = session.dev_plaintext_workspace;
    let store_dir = root.vault_store_dir(&config);

    let archive_path = root.vault_archive_path(&config);
    seven_zip.test(&archive_path, &password_str)?;

    {
        let mut store = session.store.write().expect("store lock");
        if dev_plaintext_workspace && mountpoint.is_dir() {
            store.import_logical_tree(&mountpoint)?;
        }
        store.flush()?;
    }
    drop(session);

    finalize_close(
        root,
        &config,
        &store_dir,
        &mountpoint,
        &vault_id,
        &password_str,
        seal,
        seven_zip,
    )
}

/// Close without an in-memory session handle (e.g. after an app restart in dev).
///
/// Rebuilds the `.7z` from the on-disk encrypted store. If a plaintext workspace
/// is present (dev fallback without FUSE), its files are imported into the store first.
pub fn close_by_id(
    root: &VaultRoot,
    vault_id: &str,
    password: impl Into<SessionPassword>,
    seal: bool,
    seven_zip: &SevenZip,
) -> Result<()> {
    let settings = load_app_settings(root)?;
    let config = load_vault_config(root, vault_id)?;
    ensure_encrypted_dir(&config)?;

    let password = password.into();
    let password_str = password
        .as_str()
        .ok_or_else(|| {
            UprivError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "vault password must be valid UTF-8",
            ))
        })?
        .to_string();

    let store_dir = root.vault_store_dir(&config);
    if !store_dir.join("vault.header").is_file() {
        return Err(UprivError::InvalidStore(
            "missing vault.header — encrypted_dir store not initialized".into(),
        ));
    }

    let archive_path = root.vault_archive_path(&config);
    seven_zip.test(&archive_path, &password_str)?;

    let mountpoint = root.workspace_dir(&settings, &config.vault.display_name);

    {
        let mut store = EncryptedStore::open(&store_dir, &password_str)?;
        if mountpoint.is_dir() && !is_dir_effectively_empty(&mountpoint)? {
            store.import_logical_tree(&mountpoint)?;
            store.flush()?;
        }
    }

    finalize_close(
        root,
        &config,
        &store_dir,
        &mountpoint,
        vault_id,
        &password_str,
        seal,
        seven_zip,
    )
}

#[allow(clippy::too_many_arguments)]
fn finalize_close(
    root: &VaultRoot,
    config: &VaultConfig,
    store_dir: &Path,
    mountpoint: &Path,
    vault_id: &str,
    password_str: &str,
    seal: bool,
    seven_zip: &SevenZip,
) -> Result<()> {
    let archive_path = root.vault_archive_path(config);
    let seven_zip = seven_zip.clone().with_vault_options(config);
    let new_archive = archive_path.with_extension("7z.new");
    let staging = tempfile::tempdir()?;
    {
        let store = EncryptedStore::open(store_dir, password_str)?;
        store.export_logical_tree(staging.path())?;
    }
    seven_zip.create_from_dir(staging.path(), &new_archive, password_str)?;
    seven_zip.test(&new_archive, password_str)?;
    crate::backup::backup_before_replace(root, config, &archive_path)?;
    replace_file(&new_archive, &archive_path)?;

    if mountpoint.is_dir() {
        let _ = fs::remove_dir_all(mountpoint);
    }

    // Seal: drop the encrypted store cache so only the portable `.7z` remains (PRD §1.7).
    if seal && store_dir.exists() {
        secure_wipe_path(store_dir, &WipeOptions::from(&config.security))?;
    }

    update_persistence(root, config, store_dir, seal)?;
    release_lock(root, vault_id)?;

    if seal {
        let _ = crate::session::delete_disk_session(root, vault_id);
    }

    Ok(())
}

pub fn initialize_store(
    store_dir: &Path,
    vault_id: &str,
    password: &str,
    welcome_path: &str,
    welcome_body: &[u8],
) -> Result<()> {
    let mut store = EncryptedStore::create_new(store_dir, vault_id, password)?;
    seed_initial_file(&mut store, welcome_path, welcome_body)
}

/// Rebuild the encrypted store from a portable `.7z` (reopening a sealed vault).
pub fn materialize_store_from_archive(
    archive_path: &Path,
    store_dir: &Path,
    vault_id: &str,
    password: &str,
    seven_zip: &SevenZip,
) -> Result<()> {
    let extracted = tempfile::tempdir()?;
    seven_zip.extract(archive_path, extracted.path(), password)?;

    fs::create_dir_all(store_dir)?;
    let mut store = EncryptedStore::create_new(store_dir, vault_id, password)?;
    store.import_logical_tree(extracted.path())?;
    store.flush()?;
    Ok(())
}

/// Recovery: rebuild `.7z` from the on-disk encrypted store (trust the store).
pub fn sync_archive_from_store(
    root: &VaultRoot,
    vault_id: &str,
    password: &str,
    seven_zip: &SevenZip,
) -> Result<()> {
    let config = load_vault_config(root, vault_id)?;
    ensure_encrypted_dir(&config)?;
    let store_dir = root.vault_store_dir(&config);
    if !store_dir.join("vault.header").is_file() {
        return Err(UprivError::InvalidStore(
            "encrypted store missing — cannot use store for recovery".into(),
        ));
    }
    // Validate password against the store header.
    EncryptedStore::open(&store_dir, password)?;

    let archive_path = root.vault_archive_path(&config);
    let seven_zip = seven_zip.clone().with_vault_options(&config);
    let new_archive = archive_path.with_extension("7z.new");
    let staging = tempfile::tempdir()?;
    {
        let store = EncryptedStore::open(&store_dir, password)?;
        store.export_logical_tree(staging.path())?;
    }
    seven_zip.create_from_dir(staging.path(), &new_archive, password)?;
    seven_zip.test(&new_archive, password)?;
    crate::backup::backup_before_replace(root, &config, &archive_path)?;
    replace_file(&new_archive, &archive_path)?;
    update_persistence(root, &config, &store_dir, false)?;
    Ok(())
}

/// Recovery: rebuild encrypted store from the portable `.7z` (trust the archive).
pub fn sync_store_from_archive(
    root: &VaultRoot,
    vault_id: &str,
    password: &str,
    seven_zip: &SevenZip,
) -> Result<()> {
    let config = load_vault_config(root, vault_id)?;
    ensure_encrypted_dir(&config)?;
    let archive_path = root.vault_archive_path(&config);
    if !archive_path.is_file() {
        return Err(UprivError::ArchiveNotFound(archive_path));
    }
    let store_dir = root.vault_store_dir(&config);
    let seven_zip = seven_zip.clone().with_vault_options(&config);
    seven_zip.test(&archive_path, password)?;

    if store_dir.exists() {
        secure_wipe_path(&store_dir, &WipeOptions::from(&config.security))?;
    }
    materialize_store_from_archive(&archive_path, &store_dir, vault_id, password, &seven_zip)?;
    update_persistence(root, &config, &store_dir, false)?;
    Ok(())
}

/// Seal a `closed` `encrypted_dir` vault without reopening it.
///
/// The portable `.7z` was already rebuilt and tested at the last close, so this just
/// drops the encrypted store cache (state `closed` → `sealed`). No password required.
pub fn seal_closed(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let config = load_vault_config(root, vault_id)?;
    ensure_encrypted_dir(&config)?;

    if root.runtime_lock_path(vault_id).is_file() {
        return Err(UprivError::VaultAlreadyOpen(vault_id.to_string()));
    }

    let archive_path = root.vault_archive_path(&config);
    if !archive_path.is_file() {
        return Err(UprivError::ArchiveNotFound(archive_path));
    }

    let store_dir = root.vault_store_dir(&config);
    if store_dir.exists() {
        secure_wipe_path(&store_dir, &WipeOptions::from(&config.security))?;
    }

    update_persistence(root, &config, &store_dir, true)?;
    let _ = crate::session::delete_disk_session(root, vault_id);
    Ok(())
}

fn ensure_encrypted_dir(config: &VaultConfig) -> Result<()> {
    if config.storage.mode != StorageMode::EncryptedDir {
        return Err(UprivError::StorageModeMismatch {
            expected: "encrypted_dir".to_string(),
            actual: format!("{:?}", config.storage.mode),
        });
    }
    Ok(())
}

fn try_reclaim_stale_workspace(
    root: &VaultRoot,
    vault_id: &str,
    mountpoint: &Path,
) -> Result<bool> {
    if !mountpoint.is_dir() {
        return Ok(false);
    }

    let lock_path = root.runtime_lock_path(vault_id);
    if !lock_path.is_file() {
        return Ok(false);
    }

    if !is_dir_effectively_empty(mountpoint)? {
        return Ok(false);
    }

    fs::remove_dir_all(mountpoint)?;
    release_lock(root, vault_id)?;
    Ok(true)
}

fn is_dir_effectively_empty(path: &Path) -> Result<bool> {
    Ok(fs::read_dir(path)?.next().is_none())
}

fn acquire_lock(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let lock_path = root.runtime_lock_path(vault_id);
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if lock_path.exists() {
        return Err(UprivError::VaultAlreadyOpen(vault_id.to_string()));
    }
    fs::write(
        &lock_path,
        format!("pid={}\nopened_at={}\n", std::process::id(), iso8601_now()),
    )?;
    Ok(())
}

fn release_lock(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let lock_path = root.runtime_lock_path(vault_id);
    if lock_path.is_file() {
        fs::remove_file(lock_path)?;
    }
    Ok(())
}

fn replace_file(from: &Path, to: &Path) -> Result<()> {
    if to.exists() {
        fs::remove_file(to)?;
    }
    fs::rename(from, to)?;
    Ok(())
}

fn update_persistence(
    root: &VaultRoot,
    config: &VaultConfig,
    store_dir: &Path,
    sealed: bool,
) -> Result<()> {
    let path = root.vault_persistence_path(&config.vault.id);
    let now = iso8601_now();
    let (store_hash, last_store_write_at, state) = if sealed {
        (None, None, PersistenceState::Sealed)
    } else {
        (
            Some(compute_store_hash(store_dir)?),
            Some(now.clone()),
            PersistenceState::Closed,
        )
    };
    let persistence = VaultPersistence {
        format_version: 1,
        vault_id: config.vault.id.clone(),
        display_name: config.vault.display_name.clone(),
        sync_generation: 1,
        archive_hash: sha256_file(&root.vault_archive_path(config))?,
        last_close_ok_at: Some(now),
        store_hash,
        last_store_write_at,
        persistence: state,
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&persistence)?)?;
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path)?;
    let digest = Sha256::digest(bytes);
    Ok(format!("sha256:{digest:x}"))
}

fn iso8601_now() -> String {
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seven_zip::SevenZip;
    use crate::create_vault;
    use crate::VaultConfig;
    use std::path::Path;
    use tempfile::tempdir;

    fn write_settings(root: &Path) {
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

    fn encrypted_config(vault_id: &str, display_name: &str) -> VaultConfig {
        let toml = format!(
            r#"
[vault]
id = "{vault_id}"
display_name = "{display_name}"
vault_file = "archive/{display_name}.7z"

[storage]
mode = "encrypted_dir"
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
    #[cfg(debug_assertions)]
    fn dev_plaintext_edit_survives_close_reopen() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping dev_plaintext_edit_survives_close_reopen: 7z not found");
            return;
        };

        let temp = tempdir().unwrap();
        write_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let config = encrypted_config("notes", "My Notes");
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, config, "secret-pass", &seven_zip).unwrap();

        let session = open(&root, "notes", "secret-pass", &seven_zip).unwrap();

        let readme = session.workspace_path().join("README.txt");
        fs::write(&readme, b"edited in workspace").unwrap();

        close(&root, session, false, &seven_zip).unwrap();

        let session = open(&root, "notes", "secret-pass", &seven_zip).unwrap();
        let data = session.read_file("README.txt").unwrap();
        assert_eq!(data, b"edited in workspace");
        close(&root, session, false, &seven_zip).unwrap();
    }

    #[test]
    #[cfg(debug_assertions)]
    fn seal_wipes_store_keeps_archive() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping seal_wipes_store_keeps_archive: 7z not found");
            return;
        };

        let temp = tempdir().unwrap();
        write_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let config = encrypted_config("notes", "My Notes");
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, config.clone(), "secret-pass", &seven_zip).unwrap();

        let store_dir = root.vault_store_dir(&config);
        let archive = root.vault_archive_path(&config);
        assert!(store_dir.join("vault.header").is_file());

        let session = open(&root, "notes", "secret-pass", &seven_zip).unwrap();
        close(&root, session, true, &seven_zip).unwrap();

        assert!(archive.is_file(), "sealed vault must keep the .7z");
        assert!(!store_dir.exists(), "sealed vault must wipe the store");
    }

    #[test]
    #[cfg(all(target_os = "linux", feature = "fuse"))]
    fn encrypted_dir_open_close_roundtrip() {
        let Some(binary) = resolve_7z() else {
            eprintln!("skipping encrypted_dir_open_close_roundtrip: 7z not found");
            return;
        };

        let temp = tempdir().unwrap();
        write_settings(temp.path());
        let root = VaultRoot::discover(temp.path()).unwrap();
        let config = encrypted_config("notes", "My Notes");
        let seven_zip = SevenZip::from_binary(&binary);
        create_vault(&root, config, "secret-pass", &seven_zip).unwrap();

        let session = open(&root, "notes", "secret-pass", &seven_zip).unwrap();
        let data = session.read_file("README.txt").unwrap();
        assert_eq!(data, b"Upriv vault \xe2\x80\x94 My Notes\nCreated by Upriv.\n");
        close(&root, session, false, &seven_zip).unwrap();
    }
}
