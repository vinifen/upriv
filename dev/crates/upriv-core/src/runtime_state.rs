//! `.upriv/state.json` — volatile open-session records (never `persistence.json`).
//!
//! Plaintext folder records are the one durable part: a record stays until its
//! folder is wiped, so a crash or a failed wipe keeps the vault in recovery.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths::{self, VaultRoot};

/// The only `state.json` format.
const STATE_FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeState {
    pub format_version: u32,
    #[serde(default)]
    pub vaults: BTreeMap<String, RuntimeVaultEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeVaultEntry {
    pub session: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mount_point: Option<String>,
    /// Plaintext folders this vault wrote, at most one per computer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plain: Vec<PlainRecord>,
}

/// A plaintext folder a vault wrote on some computer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlainRecord {
    /// Host name of the computer that wrote the folder.
    pub host: String,
    /// Relative to the data folder (`/` separators) when [`Self::in_data_folder`],
    /// so a data folder on a removable drive still finds it under another mount.
    pub path: String,
    pub in_data_folder: bool,
    /// Also in the folder's marker. A folder without this token is never wiped.
    pub token: String,
    /// UTC time the folder was made (RFC 3339).
    pub since: String,
}

impl PlainRecord {
    /// A folder inside the data folder is reachable from any computer that has
    /// the data folder. Any other folder only from the computer that wrote it.
    pub fn reachable_here(&self, this_host: Option<&str>) -> bool {
        self.in_data_folder || this_host == Some(self.host.as_str())
    }

    pub fn folder(&self, root: &VaultRoot) -> std::path::PathBuf {
        if self.in_data_folder {
            self.path
                .split('/')
                .filter(|part| !part.is_empty())
                .fold(root.root().to_path_buf(), |path, part| path.join(part))
        } else {
            std::path::PathBuf::from(&self.path)
        }
    }
}

fn this_host() -> Option<String> {
    crate::lockfile::hostname().ok()
}

impl RuntimeState {
    fn closed() -> Self {
        Self {
            format_version: STATE_FORMAT,
            vaults: BTreeMap::new(),
        }
    }
}

pub fn load_runtime_state(root: &VaultRoot) -> Result<RuntimeState> {
    let path = root.state_path();
    if !path.host_is_file() {
        return Ok(RuntimeState::closed());
    }
    let raw = crate::host_fs::read_to_string(&path)?;
    // A write torn by a pulled drive leaves an empty file. The records are
    // volatile, and dirty-close detection also uses the lock files.
    if raw.trim().is_empty() {
        return Ok(RuntimeState::closed());
    }
    let state: RuntimeState =
        serde_json::from_str(&raw).map_err(|error| UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: format!("invalid state.json: {error}"),
        })?;
    if state.format_version != STATE_FORMAT {
        return Err(UprivError::VaultStoreInvalid {
            path,
            detail: format!(
                "state.json format_version is {}, not {STATE_FORMAT}",
                state.format_version
            ),
        });
    }
    Ok(state)
}

pub fn save_runtime_state(root: &VaultRoot, state: &RuntimeState) -> Result<()> {
    let path = root.state_path();
    if let Some(parent) = path.parent() {
        crate::host_fs::create_dir_all(parent)?;
    }
    let body =
        serde_json::to_string_pretty(state).map_err(|error| UprivError::VaultStoreInvalid {
            path: path.clone(),
            detail: format!("serialize state.json: {error}"),
        })?;
    paths::write_bytes_atomic(&path, body.as_bytes())
}

fn with_state_lock<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    static STATE_IO: Mutex<()> = Mutex::new(());
    let _guard = STATE_IO.lock().map_err(|_| UprivError::VaultStoreInvalid {
        path: Path::new("state.json").to_path_buf(),
        detail: "state lock poisoned".into(),
    })?;
    f()
}

pub fn mark_session_open(
    root: &VaultRoot,
    vault_id: &str,
    mount_point: Option<String>,
) -> Result<()> {
    with_state_lock(|| mark_session_open_locked(root, vault_id, mount_point))
}

fn mark_session_open_locked(
    root: &VaultRoot,
    vault_id: &str,
    mount_point: Option<String>,
) -> Result<()> {
    let mut state = load_runtime_state(root)?;
    let plain = state
        .vaults
        .remove(vault_id)
        .map(|entry| entry.plain)
        .unwrap_or_default();
    state.vaults.insert(
        vault_id.to_string(),
        RuntimeVaultEntry {
            session: "open".into(),
            mount_point,
            plain,
        },
    );
    save_runtime_state(root, &state)
}

pub fn mark_session_closed(root: &VaultRoot, vault_id: &str) -> Result<()> {
    with_state_lock(|| mark_session_closed_locked(root, vault_id))
}

/// Unmount and remove the mount directory recorded for `vault_id`.
///
/// Does not change `state.json`. Call this before `mark_session_open` replaces
/// the record, so a leftover FUSE leaf is gone before a new mount is attached.
pub fn release_recorded_mount(root: &VaultRoot, vault_id: &str) {
    let Ok(state) = load_runtime_state(root) else {
        return;
    };
    let Some(mount) = state
        .vaults
        .get(vault_id)
        .and_then(|entry| entry.mount_point.clone())
    else {
        return;
    };
    let path = Path::new(&mount);
    // `remove_dir` stats the path. On a dead FUSE leaf that stat is the
    // "Transport endpoint is not connected" dialog, so only remove after detach.
    if crate::mount::force_unmount(path).is_ok() {
        // Already unmounted (a reboot) returns success without a wipe. The
        // path was this vault's folder, so drop its previews either way.
        crate::mount::purge_folder_thumbnails(path);
        let _ = crate::host_fs::remove_dir(path);
    }
}

/// The session is over. A plaintext record outlives it, so its entry stays.
fn mark_session_closed_locked(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let mut state = load_runtime_state(root)?;
    let keep_plain = state
        .vaults
        .get(vault_id)
        .is_some_and(|entry| !entry.plain.is_empty());
    if keep_plain {
        if let Some(entry) = state.vaults.get_mut(vault_id) {
            entry.session = "closed".into();
            entry.mount_point = None;
        }
    } else {
        state.vaults.remove(vault_id);
    }
    save_runtime_state(root, &state)
}

/// Record a plaintext folder before any of it is written. The vault's session
/// must already be recorded as open.
pub(crate) fn add_plain_record(
    root: &VaultRoot,
    vault_id: &str,
    record: PlainRecord,
) -> Result<()> {
    with_state_lock(|| {
        let mut state = load_runtime_state(root)?;
        let entry = state
            .vaults
            .get_mut(vault_id)
            .ok_or_else(|| UprivError::VaultNotOpen(vault_id.to_string()))?;
        entry.plain.retain(|item| item.token != record.token);
        entry.plain.push(record);
        save_runtime_state(root, &state)
    })
}

/// Record a plaintext folder found on disk without a record, for a vault
/// that is not open. Its entry is made when missing.
pub(crate) fn adopt_plain_record(
    root: &VaultRoot,
    vault_id: &str,
    record: PlainRecord,
) -> Result<()> {
    with_state_lock(|| {
        let mut state = load_runtime_state(root)?;
        let entry = state
            .vaults
            .entry(vault_id.to_string())
            .or_insert_with(|| RuntimeVaultEntry {
                session: "closed".into(),
                mount_point: None,
                plain: Vec::new(),
            });
        if entry.plain.iter().any(|item| item.token == record.token) {
            return Ok(());
        }
        entry.plain.push(record);
        save_runtime_state(root, &state)
    })
}

/// Forget one plaintext folder after it was wiped. An entry with no session
/// and no other folder goes away.
pub(crate) fn remove_plain_record(root: &VaultRoot, vault_id: &str, token: &str) -> Result<()> {
    with_state_lock(|| {
        let mut state = load_runtime_state(root)?;
        let Some(entry) = state.vaults.get_mut(vault_id) else {
            return Ok(());
        };
        entry.plain.retain(|item| item.token != token);
        if entry.plain.is_empty() && entry.session != "open" {
            state.vaults.remove(vault_id);
        }
        save_runtime_state(root, &state)
    })
}

/// Plaintext folders recorded for `vault_id`, from every computer.
pub(crate) fn plain_records(root: &VaultRoot, vault_id: &str) -> Result<Vec<PlainRecord>> {
    Ok(load_runtime_state(root)?
        .vaults
        .remove(vault_id)
        .map(|entry| entry.plain)
        .unwrap_or_default())
}

/// The plaintext folder this computer can reach, if one is recorded.
pub(crate) fn reachable_plain_record(
    root: &VaultRoot,
    vault_id: &str,
) -> Result<Option<PlainRecord>> {
    let host = this_host();
    Ok(plain_records(root, vault_id)?
        .into_iter()
        .find(|record| record.reachable_here(host.as_deref())))
}

/// Drop every record of a deleted vault.
pub(crate) fn forget_vault(root: &VaultRoot, vault_id: &str) -> Result<()> {
    with_state_lock(|| {
        let mut state = load_runtime_state(root)?;
        if state.vaults.remove(vault_id).is_some() {
            save_runtime_state(root, &state)?;
        }
        Ok(())
    })
}

/// True when this process holds the session or a live lock still owns the vault.
pub(crate) fn vault_is_live(root: &VaultRoot, id: &str) -> bool {
    if let Ok(dir) = root.vault_dir(id) {
        if crate::session::is_vault_open_at(&dir) {
            return true;
        }
    }
    match root.runtime_lock_path(id) {
        Ok(lock_path) => crate::lockfile::lock_held_by_live_process(&lock_path),
        Err(_) => false,
    }
}

/// Vault ids that need recovery and are not live in this process or behind a
/// live lock: a session recorded as open (a crash), or a plaintext folder this
/// computer can reach that was never wiped.
pub fn dirty_close_ids(root: &VaultRoot) -> Result<Vec<String>> {
    let state = load_runtime_state(root)?;
    let host = this_host();
    let mut dirty = Vec::new();
    for (id, entry) in state.vaults {
        let leftover = entry
            .plain
            .iter()
            .any(|record| record.reachable_here(host.as_deref()));
        if entry.session != "open" && !leftover {
            continue;
        }
        if vault_is_live(root, &id) {
            continue;
        }
        dirty.push(id);
    }
    Ok(dirty)
}

/// Clear a dirty-close record once a leftover plaintext folder was wiped: the
/// store was saved after every change, so the crash left nothing else to
/// decide. Other plaintext records stay; only a wipe of that folder removes one.
pub(crate) fn acknowledge_dirty_close(root: &VaultRoot, vault_id: &str) -> Result<()> {
    mark_session_closed(root, vault_id)
}

pub fn sweep_stale_mount_leaves(root: &VaultRoot) -> Result<Vec<String>> {
    let state = load_runtime_state(root)?;
    let mut swept = Vec::new();
    for (id, entry) in &state.vaults {
        let Some(mount) = entry.mount_point.as_deref() else {
            continue;
        };
        if vault_is_live(root, id) {
            continue;
        }
        let path = Path::new(mount);
        match crate::mount::force_unmount(path) {
            Ok(()) => {
                // A leftover that is no longer in the mount table still has
                // previews. Unmount itself only wipes when it detaches a leaf.
                crate::mount::purge_folder_thumbnails(path);
                let _ = crate::host_fs::remove_dir(path);
                swept.push(id.clone());
            }
            Err(_) => {
                // Do not stat the path. A dead FUSE mount returns ENOTCONN
                // from `stat`, and that is the desktop error dialog.
            }
        }
    }
    Ok(swept)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::{close_vault, create_vault, open_vault};

    fn sample_config(id: &str, name: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    #[test]
    fn sweep_leaves_mount_dir_while_session_is_open() {
        let (_tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let mount = root.root().join("live-mount");
        crate::host_fs::create_dir(&mount).unwrap();
        mark_session_open(&root, "notes", Some(mount.display().to_string())).unwrap();
        let swept = sweep_stale_mount_leaves(&root).unwrap();
        assert!(swept.is_empty());
        assert!(mount.host_is_dir());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn empty_state_file_reads_as_no_open_sessions() {
        let (_tmp, root) = vault_root_with(&[]);
        crate::host_fs::write(root.state_path(), b"").unwrap();
        assert!(load_runtime_state(&root).unwrap().vaults.is_empty());
        mark_session_open(&root, "notes", None).unwrap();
        assert!(load_runtime_state(&root)
            .unwrap()
            .vaults
            .contains_key("notes"));
    }

    #[test]
    fn a_garbage_state_file_is_an_error() {
        let (_tmp, root) = vault_root_with(&[]);
        crate::host_fs::write(root.state_path(), b"{not json").unwrap();
        assert!(matches!(
            load_runtime_state(&root),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn a_state_file_of_another_format_is_an_error() {
        let (_tmp, root) = vault_root_with(&[]);
        for body in [r#"{"format_version":2,"vaults":{}}"#, r#"{"vaults":{}}"#] {
            crate::host_fs::write(root.state_path(), body.as_bytes()).unwrap();
            assert!(matches!(
                load_runtime_state(&root),
                Err(UprivError::VaultStoreInvalid { .. })
            ));
        }
    }

    #[test]
    fn sweep_removes_mount_dir_when_session_and_lock_are_gone() {
        let (_tmp, root) = vault_root_with(&[]);
        let mount = root.root().join("stale-mount");
        crate::host_fs::create_dir(&mount).unwrap();
        mark_session_open(&root, "notes", Some(mount.display().to_string())).unwrap();
        let swept = sweep_stale_mount_leaves(&root).unwrap();
        assert_eq!(swept, ["notes"]);
        assert!(!mount.host_exists());
    }
}
