//! `.upriv/state.json` — volatile open-session records (never `persistence.json`).

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};
use crate::paths::{self, VaultRoot};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeState {
    #[serde(default)]
    pub format_version: u32,
    #[serde(default)]
    pub vaults: BTreeMap<String, RuntimeVaultEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeVaultEntry {
    pub session: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mount_point: Option<String>,
}

impl RuntimeState {
    fn closed() -> Self {
        Self {
            format_version: 1,
            vaults: BTreeMap::new(),
        }
    }
}

pub fn load_runtime_state(root: &VaultRoot) -> Result<RuntimeState> {
    let path = root.state_path();
    if !path.is_file() {
        return Ok(RuntimeState::closed());
    }
    let raw = std::fs::read_to_string(&path)?;
    serde_json::from_str(&raw).map_err(|error| UprivError::VaultStoreInvalid {
        path,
        detail: format!("invalid state.json: {error}"),
    })
}

pub fn save_runtime_state(root: &VaultRoot, state: &RuntimeState) -> Result<()> {
    let path = root.state_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
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
    state.format_version = 1;
    state.vaults.insert(
        vault_id.to_string(),
        RuntimeVaultEntry {
            session: "open".into(),
            mount_point,
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
        let _ = std::fs::remove_dir(path);
    }
}

fn mark_session_closed_locked(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let mut state = load_runtime_state(root)?;
    state.vaults.remove(vault_id);
    save_runtime_state(root, &state)
}

/// True when this process holds the session or a live lock still owns the vault.
fn vault_lock_or_session_live(root: &VaultRoot, id: &str) -> bool {
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

/// Vault ids listed as open in `state.json` that are not live in this process
/// and whose lock is missing or stale (dead PID on this host).
pub fn dirty_close_ids(root: &VaultRoot) -> Result<Vec<String>> {
    let state = load_runtime_state(root)?;
    let mut dirty = Vec::new();
    for (id, entry) in state.vaults {
        if entry.session != "open" {
            continue;
        }
        if vault_lock_or_session_live(root, &id) {
            continue;
        }
        dirty.push(id);
    }
    Ok(dirty)
}

/// Clear a dirty-close record after the user discards recovery (no plaintext to wipe).
pub fn acknowledge_dirty_close(root: &VaultRoot, vault_id: &str) -> Result<()> {
    mark_session_closed(root, vault_id)
}

pub fn sweep_stale_mount_leaves(root: &VaultRoot) -> Result<Vec<String>> {
    let state = load_runtime_state(root)?;
    let mut swept = Vec::new();
    for (id, entry) in &state.vaults {
        let Some(mount) = entry.mount_point.as_deref() else {
            continue;
        };
        if vault_lock_or_session_live(root, id) {
            continue;
        }
        let path = Path::new(mount);
        match crate::mount::force_unmount(path) {
            Ok(()) => {
                let _ = std::fs::remove_dir(path);
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
        std::fs::create_dir(&mount).unwrap();
        mark_session_open(&root, "notes", Some(mount.display().to_string())).unwrap();
        let swept = sweep_stale_mount_leaves(&root).unwrap();
        assert!(swept.is_empty());
        assert!(mount.is_dir());
        close_vault(&root, "notes", None).unwrap();
    }

    #[test]
    fn sweep_removes_mount_dir_when_session_and_lock_are_gone() {
        let (_tmp, root) = vault_root_with(&[]);
        let mount = root.root().join("stale-mount");
        std::fs::create_dir(&mount).unwrap();
        mark_session_open(&root, "notes", Some(mount.display().to_string())).unwrap();
        let swept = sweep_stale_mount_leaves(&root).unwrap();
        assert_eq!(swept, ["notes"]);
        assert!(!mount.exists());
    }
}
