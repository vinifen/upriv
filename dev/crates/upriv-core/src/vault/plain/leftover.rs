//! A plaintext folder that outlived its session: a crash, a power cut, or a
//! wipe that could not finish. The store stays the truth. The vault lists as
//! recovery until the user removes the folder. Opening never wipes it on its own.

use std::path::Path;

use serde::Serialize;

use super::disk;
use super::marker::{self, Marker, MARKER_NAME};
use super::sweep::{self, Visit};
use super::{dest, residue};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::runtime_state::{self, PlainRecord};
use crate::vault::wipe::WipeOptions;

/// `vault_plain_leftover`: what recovery shows for this computer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainLeftover {
    pub path: String,
    /// UTC time the folder was made (RFC 3339).
    pub since: String,
    /// The folder is there and carries this vault's marker. When false,
    /// Remove only forgets the record.
    pub found: bool,
    pub files: u64,
    pub bytes: u64,
}

/// What a wipe of a leftover folder did. `kept` files could not be wiped;
/// the vault stays in recovery while any are left.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainWipe {
    pub wiped: u32,
    pub kept: u32,
}

/// The leftover folder this computer can reach for `vault_id`.
pub fn plain_leftover(root: &VaultRoot, vault_id: &str) -> Result<Option<PlainLeftover>> {
    let Some(record) = runtime_state::reachable_plain_record(root, vault_id)? else {
        return Ok(None);
    };
    let folder = record.folder(root);
    let mut leftover = PlainLeftover {
        path: folder.display().to_string(),
        since: record.since.clone(),
        found: false,
        files: 0,
        bytes: 0,
    };
    if let Some(marker) = verified_marker(&folder, vault_id, &record.token) {
        leftover.found = true;
        let mut skip = marker.trusted_helpers();
        skip.push(MARKER_NAME);
        if let Ok((files, bytes)) = disk::tally(&folder, &skip) {
            leftover.files = files;
            leftover.bytes = bytes;
        }
    }
    Ok(Some(leftover))
}

/// Remove: wipe every file in the leftover folder. A folder that is gone or
/// not this vault's is forgotten without being touched.
pub fn remove_plain_leftover(root: &VaultRoot, vault_id: &str) -> Result<PlainWipe> {
    let vault_dir = root.vault_dir(vault_id)?;
    crate::session::with_vault_dir_lock(&vault_dir, || {
        ensure_closed(root, vault_id)?;
        let Some(record) = runtime_state::reachable_plain_record(root, vault_id)? else {
            return Ok(PlainWipe::default());
        };
        wipe_recorded(
            root,
            vault_id,
            &record,
            &WipeOptions::for_vault_dir(&vault_dir),
        )
    })
}

/// Refuse while this computer still has a leftover folder with this vault's
/// marker. A record whose folder is gone, or whose marker does not match, is
/// forgotten: unlock can continue.
pub(crate) fn ensure_no_leftover(root: &VaultRoot, vault_id: &str) -> Result<()> {
    forget_stale_record(root, vault_id)?;
    match runtime_state::reachable_plain_record(root, vault_id)? {
        Some(_) => Err(UprivError::PlainLeftover),
        None => Ok(()),
    }
}

/// True while [`ensure_no_leftover`] would refuse this vault. Reads only: the
/// vault list asks this, so a stale record stays until a write drops it.
pub(crate) fn holds_leftover(root: &VaultRoot, vault_id: &str) -> bool {
    matches!(
        runtime_state::reachable_plain_record(root, vault_id),
        Ok(Some(record)) if verified_marker(&record.folder(root), vault_id, &record.token).is_some()
    )
}

/// Drop a recorded leftover whose folder is gone or no longer this vault's.
fn forget_stale_record(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let Some(record) = runtime_state::reachable_plain_record(root, vault_id)? else {
        return Ok(());
    };
    if verified_marker(&record.folder(root), vault_id, &record.token).is_some() {
        return Ok(());
    }
    runtime_state::remove_plain_record(root, vault_id, &record.token)?;
    Ok(())
}

/// Before a vault is deleted: wipe its leftover folder. A folder that cannot
/// be fully wiped stops the delete.
pub(crate) fn clear_for_delete(root: &VaultRoot, vault_id: &str, vault_dir: &Path) -> Result<()> {
    let Some(record) = runtime_state::reachable_plain_record(root, vault_id)? else {
        return Ok(());
    };
    let wipe = WipeOptions::for_vault_dir(vault_dir);
    if wipe_recorded(root, vault_id, &record, &wipe)?.kept > 0 {
        return Err(UprivError::PlainLeftover);
    }
    Ok(())
}

/// Record again a folder a crash left whose record is gone (a lost
/// `state.json`, or a data folder restored from elsewhere). The folder's
/// marker names the vault and the session; that is all a wipe needs.
pub(crate) fn adopt_orphans(root: &VaultRoot, vaults: &[crate::vault::VaultListEntry]) {
    let host = crate::lockfile::hostname().ok();
    for vault in vaults {
        let id = vault.id.as_str();
        if runtime_state::vault_is_live(root, id) {
            continue;
        }
        let _ = forget_stale_record(root, id);
        let Ok(records) = runtime_state::plain_records(root, id) else {
            continue;
        };
        if records
            .iter()
            .any(|record| record.reachable_here(host.as_deref()))
        {
            continue;
        }
        let Ok(dest) = dest::resolve(root, &vault.config) else {
            continue;
        };
        if !is_real_folder(&dest.folder) {
            continue;
        }
        let Ok(Some(marker)) = marker::read(&dest.folder) else {
            continue;
        };
        if marker.vault_id != id {
            continue;
        }
        let Some(record) = record_for(root, &dest, &marker, host.as_deref()) else {
            continue;
        };
        if runtime_state::adopt_plain_record(root, id, record).is_ok() {
            crate::logging::log_event(
                crate::logging::LogLevel::Warn,
                "vault_plain_orphan_found",
                &[("id", id)],
            );
        }
    }
}

fn record_for(
    root: &VaultRoot,
    dest: &dest::Destination,
    marker: &Marker,
    host: Option<&str>,
) -> Option<PlainRecord> {
    let host = host?.to_string();
    Some(PlainRecord {
        host,
        path: record_path(root, dest)?,
        in_data_folder: dest.in_data_folder(),
        token: marker.token.clone(),
        since: crate::time::utc_timestamp_iso_millis(),
    })
}

/// How `state.json` names a folder: relative to the data folder with `/`
/// separators when it is inside it, so a moved data folder still finds it.
pub(super) fn record_path(root: &VaultRoot, dest: &dest::Destination) -> Option<String> {
    if !dest.in_data_folder() {
        return Some(dest.folder.display().to_string());
    }
    let relative = dest.folder.strip_prefix(root.root()).ok()?;
    let parts: Option<Vec<&str>> = relative
        .components()
        .map(|component| match component {
            std::path::Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect();
    Some(parts?.join("/"))
}

/// Wipe a recorded folder and forget it once nothing is left. That settles
/// the recovery too: the store was saved after every change, so a crash
/// left nothing else to decide.
fn wipe_recorded(
    root: &VaultRoot,
    vault_id: &str,
    record: &PlainRecord,
    opts: &WipeOptions,
) -> Result<PlainWipe> {
    let folder = record.folder(root);
    let wipe = match verified_marker(&folder, vault_id, &record.token) {
        Some(marker) => wipe_folder(&folder, &marker, opts)?,
        None => PlainWipe::default(),
    };
    if wipe.kept == 0 {
        runtime_state::remove_plain_record(root, vault_id, &record.token)?;
        runtime_state::acknowledge_dirty_close(root, vault_id)?;
    }
    crate::logging::log_event(
        crate::logging::LogLevel::Info,
        "vault_plain_leftover_wiped",
        &[
            ("id", vault_id),
            ("wiped", wipe.wiped.to_string().as_str()),
            ("kept", wipe.kept.to_string().as_str()),
        ],
    );
    Ok(wipe)
}

/// Wipe everything under a folder this vault wrote, then leave it the way
/// [`finish_folder`] does.
fn wipe_folder(folder: &Path, marker: &Marker, opts: &WipeOptions) -> Result<PlainWipe> {
    let swept = sweep::sweep_folder(folder, &[MARKER_NAME], opts, &mut |_, _| Visit::Wipe)?;
    let wipe = PlainWipe {
        wiped: swept.removed,
        kept: swept.kept.len() as u32,
    };
    if wipe.kept == 0 {
        finish_folder(folder, marker)?;
    }
    residue::purge_after_close(folder, opts);
    Ok(wipe)
}

/// The folder holds only the marker. The marker goes. A folder Upriv made
/// goes with it, and an empty `workspace/` directory created for that folder
/// goes too. A folder the user made is left empty, with their permissions.
pub(super) fn finish_folder(folder: &Path, marker: &Marker) -> std::io::Result<()> {
    marker::remove(folder)?;
    if marker.made_folder {
        crate::host_fs::remove_dir(folder)?;
        remove_empty_workspace_dir(folder);
    }
    Ok(())
}

/// `workspace/` under the data folder or a custom place is created for the
/// open vault. Once its last vault folder is gone, the directory goes too.
fn remove_empty_workspace_dir(leaf: &Path) {
    let Some(parent) = leaf.parent() else {
        return;
    };
    if parent.file_name().and_then(|name| name.to_str()) != Some("workspace") {
        return;
    }
    if disk::holds_only(parent, &[]).ok() != Some(true) {
        return;
    }
    let _ = crate::host_fs::remove_dir(parent);
}

fn verified_marker(folder: &Path, vault_id: &str, token: &str) -> Option<Marker> {
    if !is_real_folder(folder) {
        return None;
    }
    marker::read(folder)
        .ok()
        .flatten()
        .filter(|marker| marker.written_by(vault_id, token))
}

fn is_real_folder(path: &Path) -> bool {
    matches!(
        crate::host_fs::entry_kind(path),
        Ok(crate::host_fs::EntryKind::Dir)
    )
}

fn ensure_closed(root: &VaultRoot, vault_id: &str) -> Result<()> {
    if runtime_state::vault_is_live(root, vault_id) {
        return Err(UprivError::VaultAlreadyOpen(vault_id.to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{load_vault_config, VaultConfig};
    use crate::store::KdfUnlockPreset;
    use crate::test_support::{vault_root_with, VaultSpec};

    fn plain_root() -> (tempfile::TempDir, VaultRoot) {
        vault_root_with(&[VaultSpec::upriv_plain("notes", "Notes", 1)])
    }

    fn leftover(folder: &Path, vault_id: &str, token: &str) {
        std::fs::create_dir_all(folder.join("sub")).unwrap();
        std::fs::write(folder.join("a.txt"), b"secret a").unwrap();
        std::fs::write(folder.join("sub").join("b.txt"), b"secret b").unwrap();
        std::fs::write(folder.join(".nomedia"), b"").unwrap();
        let helpers = vec![".nomedia".to_string()];
        marker::write(folder, &Marker::open(vault_id, token, &helpers, true)).unwrap();
    }

    fn record(folder: &Path, token: &str) -> PlainRecord {
        PlainRecord {
            host: crate::lockfile::hostname().unwrap(),
            path: folder.display().to_string(),
            in_data_folder: false,
            token: token.to_string(),
            since: "2026-10-16T10:00:00.000Z".into(),
        }
    }

    #[test]
    fn remove_wipes_a_folder_with_the_recorded_marker() {
        let (tmp, root) = plain_root();
        let folder = tmp.path().join("places").join("Notes");
        leftover(&folder, "notes", "t1");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1")).unwrap();

        let found = plain_leftover(&root, "notes").unwrap().expect("leftover");
        assert!(found.found);
        assert_eq!((found.files, found.bytes), (2, 16));

        let wipe = remove_plain_leftover(&root, "notes").unwrap();
        assert_eq!(wipe, PlainWipe { wiped: 3, kept: 0 });
        assert!(plain_leftover(&root, "notes").unwrap().is_none());
        assert!(!folder.exists());
    }

    #[test]
    fn the_list_marks_a_leftover_until_it_is_removed() {
        let listed = |root: &VaultRoot| {
            crate::list_vaults(root)
                .unwrap()
                .into_iter()
                .find(|vault| vault.id == "notes")
                .unwrap()
                .plain_leftover
        };
        let (tmp, root) = plain_root();
        assert!(!listed(&root));
        let folder = tmp.path().join("places").join("Notes");
        leftover(&folder, "notes", "t1");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1")).unwrap();
        assert!(listed(&root));

        remove_plain_leftover(&root, "notes").unwrap();
        assert!(!listed(&root));
    }

    #[test]
    fn the_list_does_not_mark_a_folder_with_another_token() {
        let (tmp, root) = plain_root();
        let folder = tmp.path().join("places").join("Notes");
        leftover(&folder, "notes", "someone-else");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1")).unwrap();
        assert!(!holds_leftover(&root, "notes"));
    }

    #[test]
    fn a_folder_with_another_token_is_forgotten_not_wiped() {
        let (tmp, root) = plain_root();
        let folder = tmp.path().join("places").join("Notes");
        leftover(&folder, "notes", "someone-else");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1")).unwrap();

        assert!(!plain_leftover(&root, "notes").unwrap().unwrap().found);
        assert_eq!(
            remove_plain_leftover(&root, "notes").unwrap(),
            PlainWipe::default()
        );
        assert!(plain_leftover(&root, "notes").unwrap().is_none());
        assert_eq!(std::fs::read(folder.join("a.txt")).unwrap(), b"secret a");
    }

    #[test]
    fn an_orphan_folder_is_recorded_from_its_marker() {
        let (tmp, root) = plain_root();
        let base = tmp.path().join("places");
        std::fs::create_dir_all(&base).unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        let mut config = load_vault_config(&vault_dir).unwrap();
        config
            .mount
            .row_mut(crate::paths::WorkspaceSystem::current())
            .path = base.display().to_string();
        crate::config::save_vault_config(&vault_dir, &config).unwrap();
        let folder = base.join("Notes");
        leftover(&folder, "notes", "t9");

        assert!(plain_leftover(&root, "notes").unwrap().is_none());
        adopt_orphans(&root, &crate::vault::list_vault_entries(&root).unwrap());
        let found = plain_leftover(&root, "notes").unwrap().expect("adopted");
        assert!(found.found);
        assert_eq!(remove_plain_leftover(&root, "notes").unwrap().kept, 0);
    }

    fn own_folder_config(id: &str, name: &str, parent: &Path, plain: bool) -> VaultConfig {
        let mode = if plain {
            "upriv_plain"
        } else {
            "encrypted_dir"
        };
        let mut config: VaultConfig = toml::from_str(&format!(
            "[vault]\nid = \"{id}\"\ndisplay_name = \"{name}\"\norder = 1\n[storage]\nmode = \"{mode}\"\n"
        ))
        .expect("config");
        config
            .mount
            .row_mut(crate::paths::WorkspaceSystem::current())
            .path = parent.display().to_string();
        config.storage.plain_files = crate::config::vault_config::VaultPlainFiles::Whole;
        config
    }

    #[test]
    fn open_fills_the_folder_and_close_wipes_it() {
        let (tmp, root) = vault_root_with(&[]);
        let parent = tmp.path().join("places");
        std::fs::create_dir_all(&parent).unwrap();
        crate::create_vault(
            &root,
            own_folder_config("notes", "Notes", &parent, true),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let folder = parent.join("Notes");
        let outcome = crate::open_vault(&root, "notes", b"pass-word-ok").expect("open");
        let crate::OpenVaultOutcome::PlainConfirm { path, .. } = outcome else {
            panic!("first open confirms the place");
        };
        assert_eq!(path, folder);
        crate::confirm_plain_destination(&root, "notes", &folder).unwrap();
        crate::vault::fs_write_file(&root, "notes", "/hello.txt", b"secret").unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert_eq!(std::fs::read(folder.join("hello.txt")).unwrap(), b"secret");

        let closed = crate::close_vault(&root, "notes").unwrap();
        assert_eq!(closed.plain.unwrap().kept, 0);
        assert!(!folder.exists());

        crate::open_vault_confirmed(&root, "notes", b"pass-word-ok", &folder).unwrap();
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/hello.txt").unwrap(),
            b"secret"
        );
        crate::close_vault(&root, "notes").unwrap();
    }

    /// A plaintext vault open in `<tmp>/places/Notes` with `hello.txt` saved.
    fn open_plain_vault(tmp: &tempfile::TempDir, root: &VaultRoot) -> std::path::PathBuf {
        let parent = tmp.path().join("places");
        std::fs::create_dir_all(&parent).unwrap();
        crate::create_vault(
            root,
            own_folder_config("notes", "Notes", &parent, true),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let folder = parent.join("Notes");
        crate::open_vault(root, "notes", b"pass-word-ok").unwrap();
        crate::confirm_plain_destination(root, "notes", &folder).unwrap();
        crate::vault::fs_write_file(root, "notes", "/hello.txt", b"secret").unwrap();
        crate::plain_sync(root, "notes").unwrap();
        folder
    }

    /// A plaintext vault of chosen files, open, with two files in `docs/` and
    /// one at the top, none of them sent.
    fn open_chosen_vault(tmp: &tempfile::TempDir, root: &VaultRoot) -> std::path::PathBuf {
        let parent = tmp.path().join("places");
        std::fs::create_dir_all(&parent).unwrap();
        let mut config = own_folder_config("notes", "Notes", &parent, true);
        config.storage.plain_files = crate::config::vault_config::VaultPlainFiles::Chosen;
        crate::create_vault(root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let folder = parent.join("Notes");
        crate::open_vault(root, "notes", b"pass-word-ok").unwrap();
        crate::confirm_plain_destination(root, "notes", &folder).unwrap();
        crate::vault::fs_mkdir(root, "notes", "/docs").unwrap();
        crate::vault::fs_write_file(root, "notes", "/docs/a.txt", b"first").unwrap();
        crate::vault::fs_write_file(root, "notes", "/docs/b.txt", b"second").unwrap();
        crate::vault::fs_write_file(root, "notes", "/top.txt", b"third").unwrap();
        crate::plain_sync(root, "notes").unwrap();
        folder
    }

    fn send(root: &VaultRoot, paths: &[&str]) -> u32 {
        let paths: Vec<String> = paths.iter().map(|path| path.to_string()).collect();
        let queued = crate::plain_send(root, "notes", &paths).unwrap();
        crate::plain_sync(root, "notes").unwrap();
        queued
    }

    fn folder_files(folder: &Path) -> Vec<String> {
        let mut found = Vec::new();
        let mut pending = vec![folder.to_path_buf()];
        while let Some(dir) = pending.pop() {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if entry.path().is_dir() {
                    pending.push(entry.path());
                } else if !name.starts_with('.') {
                    found.push(name);
                }
            }
        }
        found.sort();
        found
    }

    #[test]
    fn chosen_files_leave_the_folder_empty_until_one_is_sent() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        assert!(folder_files(&folder).is_empty());
        assert!(!folder.join("docs").exists());

        assert_eq!(send(&root, &["/docs/a.txt"]), 1);
        assert_eq!(folder_files(&folder), ["a.txt"]);
        assert_eq!(std::fs::read(folder.join("docs/a.txt")).unwrap(), b"first");
        crate::close_vault(&root, "notes").unwrap();
        assert!(!folder.exists());
    }

    #[test]
    fn sending_a_folder_sends_what_is_under_it() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        assert_eq!(send(&root, &["/docs"]), 2);
        assert_eq!(folder_files(&folder), ["a.txt", "b.txt"]);
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn the_tree_marks_only_what_the_folder_holds() {
        let (tmp, root) = vault_root_with(&[]);
        open_chosen_vault(&tmp, &root);
        send(&root, &["/docs/a.txt"]);
        let tree = crate::vault::fs_list_tree(&root, "notes").unwrap();
        assert_eq!(tree.in_folder, Some(true));
        let children = tree.children.unwrap();
        let docs = children.iter().find(|node| node.name == "docs").unwrap();
        assert_eq!(docs.in_folder, Some(true));
        let inner = docs.children.as_ref().unwrap();
        let marks: Vec<_> = inner.iter().map(|node| node.in_folder).collect();
        assert_eq!(marks, [Some(true), Some(false)]);
        let top = children.iter().find(|node| node.name == "top.txt").unwrap();
        assert_eq!(top.in_folder, Some(false));
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_whole_vault_tree_carries_no_marks() {
        let (tmp, root) = vault_root_with(&[]);
        open_plain_vault(&tmp, &root);
        let tree = crate::vault::fs_list_tree(&root, "notes").unwrap();
        assert_eq!(tree.in_folder, None);
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn the_app_edits_and_deletes_files_never_sent() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        crate::vault::fs_write_file(&root, "notes", "/top.txt", b"edited").unwrap();
        crate::vault::fs_delete(&root, "notes", "/docs/b.txt").unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert!(folder_files(&folder).is_empty());
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/top.txt").unwrap(),
            b"edited"
        );
        assert!(crate::vault::fs_read_file(&root, "notes", "/docs/b.txt").is_err());
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn deleting_a_sent_file_from_the_folder_deletes_it_from_the_vault() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        send(&root, &["/docs/a.txt"]);
        std::fs::remove_file(folder.join("docs/a.txt")).unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert!(crate::vault::fs_read_file(&root, "notes", "/docs/a.txt").is_err());
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/docs/b.txt").unwrap(),
            b"second"
        );
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn deleting_a_folder_from_disk_keeps_the_files_never_sent() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        send(&root, &["/docs/a.txt"]);
        std::fs::remove_dir_all(folder.join("docs")).unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert!(crate::vault::fs_read_file(&root, "notes", "/docs/a.txt").is_err());
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/docs/b.txt").unwrap(),
            b"second"
        );
        assert!(!folder.join("docs").exists());
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_file_another_app_adds_joins_the_vault() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        std::fs::write(folder.join("new.txt"), b"from an app").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2_100));
        crate::plain_sync(&root, "notes").unwrap();
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/new.txt").unwrap(),
            b"from an app"
        );
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn removing_from_the_folder_keeps_the_file_in_the_vault() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        send(&root, &["/docs/a.txt", "/top.txt"]);
        let outcome = crate::plain_unsend(&root, "notes", &["/docs/a.txt".to_string()]).unwrap();
        assert_eq!((outcome.removed, outcome.kept), (1, 0));
        crate::plain_sync(&root, "notes").unwrap();
        assert_eq!(folder_files(&folder), ["top.txt"]);
        assert!(!folder.join("docs").exists());
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/docs/a.txt").unwrap(),
            b"first"
        );
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_sent_file_follows_a_rename_in_the_app() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        send(&root, &["/top.txt"]);
        crate::vault::fs_rename(&root, "notes", "/top.txt", "renamed.txt").unwrap();
        let shown = crate::vault::fs_tree_revision(&root, "notes").unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert_eq!(folder_files(&folder), ["renamed.txt"]);
        // Same count of files, another name: the marks still have to move.
        assert!(crate::vault::fs_tree_revision(&root, "notes").unwrap() > shown);
        let tree = crate::vault::fs_list_tree(&root, "notes").unwrap();
        let children = tree.children.unwrap();
        let renamed = children.iter().find(|node| node.name == "renamed.txt");
        assert_eq!(renamed.and_then(|node| node.in_folder), Some(true));
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_sent_folder_follows_a_rename_and_a_move_in_the_app() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        send(&root, &["/docs"]);
        crate::vault::fs_rename(&root, "notes", "/docs", "papers").unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert!(folder.join("papers/a.txt").exists());
        assert!(folder.join("papers/b.txt").exists());
        assert!(!folder.join("docs").exists());

        crate::vault::fs_mkdir(&root, "notes", "/shelf").unwrap();
        crate::vault::fs_move(&root, "notes", "/papers/a.txt", "/shelf").unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert!(folder.join("shelf/a.txt").exists());
        assert!(!folder.join("papers/a.txt").exists());
        assert!(folder.join("papers/b.txt").exists());
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_whole_vault_folder_keeps_every_file() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_plain_vault(&tmp, &root);
        let outcome = crate::plain_unsend(&root, "notes", &["/hello.txt".to_string()]).unwrap();
        assert_eq!((outcome.removed, outcome.kept), (0, 0));
        assert!(folder.join("hello.txt").exists());
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_file_changed_this_moment_stays_in_the_folder() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        send(&root, &["/top.txt"]);
        std::fs::write(folder.join("top.txt"), b"still being written").unwrap();
        let outcome = crate::plain_unsend(&root, "notes", &["/top.txt".to_string()]).unwrap();
        assert_eq!((outcome.removed, outcome.kept), (0, 1));
        assert_eq!(
            std::fs::read(folder.join("top.txt")).unwrap(),
            b"still being written"
        );
        crate::close_vault(&root, "notes").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_close_now_sends_the_same_files_again() {
        use std::os::unix::fs::PermissionsExt;
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_chosen_vault(&tmp, &root);
        send(&root, &["/docs/a.txt"]);
        let index = root.vault_dir("notes").unwrap().join("store/index");
        std::fs::set_permissions(&index, std::fs::Permissions::from_mode(0o500)).unwrap();
        let failed = crate::close_vault_now(&root, "notes");
        std::fs::set_permissions(&index, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(failed.is_err());

        crate::plain_sync(&root, "notes").unwrap();
        assert_eq!(folder_files(&folder), ["a.txt"]);
        // `a.txt` and the folder's helper file, once: what the failed close
        // removed is not counted again.
        let closed = crate::close_vault(&root, "notes").unwrap();
        assert_eq!(closed.plain.unwrap().removed, 2);
    }

    #[test]
    fn close_now_removes_the_folder_and_loses_what_the_last_pass_never_saw() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_plain_vault(&tmp, &root);
        std::fs::write(folder.join("hello.txt"), b"changed").unwrap();
        std::fs::write(folder.join("unsaved.txt"), b"new").unwrap();

        let closed = crate::close_vault_now(&root, "notes").unwrap();
        let summary = closed.plain.unwrap();
        assert_eq!((summary.saved, summary.kept), (0, 0));
        assert!(!folder.exists());
        assert!(plain_leftover(&root, "notes").unwrap().is_none());

        crate::open_vault_confirmed(&root, "notes", b"pass-word-ok", &folder).unwrap();
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/hello.txt").unwrap(),
            b"secret"
        );
        assert!(crate::vault::fs_read_file(&root, "notes", "/unsaved.txt").is_err());
        crate::close_vault(&root, "notes").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_close_now_that_cannot_seal_keeps_the_vault_open_and_refills_the_folder() {
        use std::os::unix::fs::PermissionsExt;
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_plain_vault(&tmp, &root);
        let index = root.vault_dir("notes").unwrap().join("store/index");
        std::fs::set_permissions(&index, std::fs::Permissions::from_mode(0o500)).unwrap();
        let failed = crate::close_vault_now(&root, "notes");
        std::fs::set_permissions(&index, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(failed.is_err());
        assert!(!folder.join("hello.txt").exists());

        crate::plain_sync(&root, "notes").unwrap();
        assert_eq!(std::fs::read(folder.join("hello.txt")).unwrap(), b"secret");
        assert_eq!(
            crate::vault::fs_read_file(&root, "notes", "/hello.txt").unwrap(),
            b"secret"
        );
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn close_now_keeps_files_it_cannot_prove_are_the_sessions() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_plain_vault(&tmp, &root);
        std::fs::remove_file(folder.join(marker::MARKER_NAME)).unwrap();
        std::fs::write(folder.join("theirs.txt"), b"not the vault's").unwrap();

        let closed = crate::close_vault_now(&root, "notes").unwrap();
        assert_eq!(closed.plain.unwrap().kept, 1);
        assert!(!folder.join("hello.txt").exists());
        assert_eq!(
            std::fs::read(folder.join("theirs.txt")).unwrap(),
            b"not the vault's"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_the_user_made_stays_empty_with_its_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let (tmp, root) = vault_root_with(&[]);
        let parent = tmp.path().join("places");
        let folder = parent.join("Notes");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o750)).unwrap();
        crate::create_vault(
            &root,
            own_folder_config("notes", "Notes", &parent, true),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::confirm_plain_destination(&root, "notes", &folder).unwrap();
        crate::vault::fs_write_file(&root, "notes", "/hello.txt", b"secret").unwrap();
        crate::plain_sync(&root, "notes").unwrap();

        let closed = crate::close_vault(&root, "notes").unwrap();
        assert_eq!(closed.plain.unwrap().kept, 0);
        assert!(disk::holds_only(&folder, &[]).unwrap());
        let mode = std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o750);
    }

    #[test]
    fn encrypted_open_does_not_write_a_plaintext_folder() {
        let (tmp, root) = vault_root_with(&[]);
        let parent = tmp.path().join("places");
        std::fs::create_dir_all(&parent).unwrap();
        crate::create_vault(
            &root,
            own_folder_config("notes", "Notes", &parent, false),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::fs_write_file(&root, "notes", "/hello.txt", b"secret").unwrap();
        assert!(!parent.join("Notes").exists());
        crate::close_vault(&root, "notes").unwrap();
        assert!(!parent.join("Notes").exists());
    }
}
