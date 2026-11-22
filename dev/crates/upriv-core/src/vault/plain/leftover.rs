//! A plaintext folder that outlived its session: a crash, a power cut, or a
//! wipe that could not finish. The store stays the truth. The vault lists as
//! recovery until the user removes the folder. Opening never wipes it on its own.
//!
//! A record is kept while its drive is away. It is dropped only on proof: its
//! `upriv-unlocked` answers, its folder ID file holds the record's ID, and
//! nothing of the session is left there (the vault's folder is gone, or holds
//! no marker of that session: the marker is written before any file and
//! removed last). A folder that merely answers proves nothing: a mount point
//! stays as an empty folder while its drive is gone, and on Windows another
//! drive can take the same letter. A folder or marker that cannot be read
//! proves nothing either.

use std::path::Path;

use serde::Serialize;

use super::dest;
use super::disk;
use super::marker::{self, Marker, MARKER_NAME};
use super::residue;
use super::sweep::{self, Visit};
use crate::device::DeviceSystem;
use crate::error::{Result, UprivError};
use crate::folder_list::unlocked::{container_id, remove_container_if_empty};
use crate::folder_list::UNLOCKED_CONTAINER;
use crate::folder_probe::{within_limit, FOLDER_STATUS_CHECK_LIMIT};
use crate::paths::VaultRoot;
use crate::runtime_state::{self, PlainRecord};
use crate::session::{Job, JobKind};
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

/// What this device can tell about a recorded plain-text folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlainRecordState {
    /// The folder is there with this vault's marker: a leftover to remove.
    Leftover,
    /// Proven gone: the record can go.
    Gone,
    /// Nothing proves where the folder is: its drive is unplugged, not
    /// answering, or another drive took its place.
    Away,
    /// Another device wrote it, and its folder is not reachable from here.
    Elsewhere,
}

/// A recorded plain-text folder as the vault list shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainRecordView {
    /// The device that wrote it ([`crate::device::ThisDevice::record_key`]).
    pub device: String,
    /// That device's system: with the start of the ID, how the UI names it.
    pub system: DeviceSystem,
    pub path: String,
    /// Names the record for [`plain_record_forget`].
    pub token: String,
    pub state: PlainRecordState,
}

/// The state of `record` here: a time-limited look at its folder.
fn record_state(root: &VaultRoot, vault_id: &str, record: &PlainRecord) -> PlainRecordState {
    if !record.reachable_here() {
        return PlainRecordState::Elsewhere;
    }
    let folder = record.folder(root);
    let Some(container) = folder.parent().map(Path::to_path_buf) else {
        return PlainRecordState::Away;
    };
    let vault_id = vault_id.to_string();
    let record = record.clone();
    let key = container.clone();
    within_limit(
        &key,
        "plain_record",
        FOLDER_STATUS_CHECK_LIMIT,
        move || match check_marker(&folder, &vault_id, &record.token) {
            MarkerCheck::Ours(_) => PlainRecordState::Leftover,
            MarkerCheck::Unknown => PlainRecordState::Away,
            MarkerCheck::Absent if container_proves(&container, &record) => PlainRecordState::Gone,
            MarkerCheck::Absent => PlainRecordState::Away,
        },
    )
    .unwrap_or(PlainRecordState::Away)
}

/// This device's record of `vault_id` and its state, with a proven-gone
/// record dropped.
fn settled_record(
    root: &VaultRoot,
    vault_id: &str,
) -> Result<Option<(PlainRecord, PlainRecordState)>> {
    let Some(record) = runtime_state::reachable_plain_record(root, vault_id)? else {
        return Ok(None);
    };
    match record_state(root, vault_id, &record) {
        PlainRecordState::Gone => {
            runtime_state::remove_plain_record(root, vault_id, &record.token)?;
            Ok(None)
        }
        state => Ok(Some((record, state))),
    }
}

fn unreachable(root: &VaultRoot, record: &PlainRecord) -> UprivError {
    UprivError::PlainFolderUnreachable {
        device: record.device.clone(),
        system: record.system,
        path: record.folder(root).display().to_string(),
    }
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

/// Remove: wipe every file in the leftover folder, as the job `job_id`, whose
/// total is the folder's bytes. A record proven gone is forgotten without
/// touching anything; one whose drive is away is refused. A stop leaves the
/// files not reached yet: the vault stays in recovery, and a later Remove
/// finishes the wipe.
pub fn remove_plain_leftover(root: &VaultRoot, vault_id: &str, job_id: &str) -> Result<PlainWipe> {
    Job::run(job_id, JobKind::PlainRemove, Some(vault_id), |job| {
        let vault_dir = root.vault_dir(vault_id)?;
        crate::session::with_vault_dir_lock(&vault_dir, || {
            ensure_closed(root, vault_id)?;
            let Some((record, state)) = settled_record(root, vault_id)? else {
                runtime_state::acknowledge_dirty_close(root, vault_id)?;
                return Ok(PlainWipe::default());
            };
            if state != PlainRecordState::Leftover {
                return Err(unreachable(root, &record));
            }
            let wipe = wipe_recorded(
                root,
                vault_id,
                &record,
                &WipeOptions::for_vault_dir(&vault_dir),
                job,
            )?;
            if wipe.kept > 0 && job.is_stopped() {
                return Err(UprivError::JobCancelled);
            }
            Ok(wipe)
        })
    })
}

/// Refuse while this device still has a plain-text folder of this vault on
/// record: a leftover to remove, or one on a drive that cannot be proven
/// here. A record proven gone is dropped, and the unlock can continue.
pub(crate) fn ensure_no_leftover(root: &VaultRoot, vault_id: &str) -> Result<()> {
    match settled_record(root, vault_id)? {
        None => Ok(()),
        Some((_, PlainRecordState::Leftover)) => Err(UprivError::PlainLeftover),
        Some((record, _)) => Err(unreachable(root, &record)),
    }
}

/// True while this device has a leftover folder of this vault with its
/// marker. Reads only: the vault list asks this.
pub(crate) fn holds_leftover(root: &VaultRoot, vault_id: &str) -> bool {
    matches!(
        runtime_state::reachable_plain_record(root, vault_id),
        Ok(Some(record)) if record_state(root, vault_id, &record) == PlainRecordState::Leftover
    )
}

/// `records` of `vault_id` but those proven gone, for the vault list. Reads
/// only; another device's record is not looked at.
pub(crate) fn plain_record_views(
    root: &VaultRoot,
    vault_id: &str,
    records: Vec<PlainRecord>,
) -> Vec<PlainRecordView> {
    records
        .into_iter()
        .filter_map(|record| {
            let state = record_state(root, vault_id, &record);
            (state != PlainRecordState::Gone).then(|| PlainRecordView {
                device: record.device.clone(),
                system: record.system,
                path: record.folder(root).display().to_string(),
                token: record.token.clone(),
                state,
            })
        })
        .collect()
}

/// `plain_record_forget`: forget one plain-text folder on record, whatever
/// device wrote it. Its files stay where they are, as they are. Refused
/// while the vault is open.
pub fn plain_record_forget(root: &VaultRoot, vault_id: &str, token: &str) -> Result<()> {
    let vault_dir = root.vault_dir(vault_id)?;
    crate::session::with_vault_dir_lock(&vault_dir, || {
        ensure_closed(root, vault_id)?;
        let known = runtime_state::plain_records(root, vault_id)?
            .iter()
            .any(|record| record.token == token);
        if !known {
            return Ok(());
        }
        runtime_state::remove_plain_record(root, vault_id, token)?;
        if runtime_state::reachable_plain_record(root, vault_id)?.is_none() {
            runtime_state::acknowledge_dirty_close(root, vault_id)?;
        }
        crate::logging::log_event(
            crate::logging::LogLevel::Warn,
            "vault_plain_record_forgotten",
            &[("id", vault_id)],
        );
        Ok(())
    })
}

/// [`UprivError::VaultPlainElsewhere`] while another device has a plain-text
/// folder of this vault on record: deleting the vault would lose track of
/// files only that device can reach.
pub(crate) fn refuse_if_elsewhere(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let elsewhere = runtime_state::plain_records(root, vault_id)?
        .into_iter()
        .find(|record| !record.reachable_here());
    match elsewhere {
        Some(record) => Err(UprivError::VaultPlainElsewhere {
            device: record.device,
            system: record.system,
            path: record.path,
        }),
        None => Ok(()),
    }
}

/// Before a vault is deleted: wipe its leftover folder. A folder that cannot
/// be fully wiped, or whose drive is away, stops the delete.
pub(crate) fn clear_for_delete(root: &VaultRoot, vault_id: &str, vault_dir: &Path) -> Result<()> {
    let Some((record, state)) = settled_record(root, vault_id)? else {
        return Ok(());
    };
    if state != PlainRecordState::Leftover {
        return Err(unreachable(root, &record));
    }
    let wipe = WipeOptions::for_vault_dir(vault_dir);
    if wipe_recorded(root, vault_id, &record, &wipe, &Job::untracked())?.kept > 0 {
        return Err(UprivError::PlainLeftover);
    }
    Ok(())
}

/// Record again a folder a crash left whose record is gone (a lost
/// `state.json`, or a data folder restored from elsewhere). The folder's
/// marker names the vault and the session, and its `upriv-unlocked` the
/// drive: that is all a wipe needs.
pub(crate) fn adopt_orphans(root: &VaultRoot, vaults: &[crate::vault::VaultListEntry]) {
    if crate::device::this_device().id.is_none() {
        return;
    }
    for vault in vaults {
        let id = vault.id.as_str();
        if runtime_state::vault_is_live(root, id) {
            continue;
        }
        let Ok(records) = runtime_state::plain_records(root, id) else {
            continue;
        };
        if records.iter().any(PlainRecord::reachable_here) {
            continue;
        }
        let Ok(places) = dest::places(root, &vault.config) else {
            continue;
        };
        let dest = dest::Destination::new(root, places.selected, &vault.config.vault.display_name);
        let folder = dest.folder.clone();
        let container = dest.container(root);
        let vault_id = id.to_string();
        let key = container.clone();
        let found = within_limit(&key, "plain_orphan", FOLDER_STATUS_CHECK_LIMIT, move || {
            if !is_real_folder(&folder) {
                return None;
            }
            let marker = marker::read(&folder).ok().flatten()?;
            if marker.vault_id != vault_id {
                return None;
            }
            let folder_id = container_id(&container).ok().flatten()?;
            Some((marker.token, folder_id))
        })
        .flatten();
        let Some((token, folder_id)) = found else {
            continue;
        };
        let Some(path) = record_path(root, &dest) else {
            continue;
        };
        let record = PlainRecord::written_here(path, dest.in_data_folder(), token, folder_id);
        if runtime_state::adopt_plain_record(root, id, record).is_ok() {
            crate::logging::log_event(
                crate::logging::LogLevel::Warn,
                "vault_plain_orphan_found",
                &[("id", id)],
            );
        }
    }
}

/// A record another device wrote becomes this device's when its folder is at
/// its path here with the vault's marker and token: the drive moved with
/// the data folder. One time-limited look per record.
pub(crate) fn follow_records(root: &VaultRoot, vaults: &[crate::vault::VaultListEntry]) {
    if crate::device::this_device().id.is_none() {
        return;
    }
    for vault in vaults {
        let id = vault.id.as_str();
        let Ok(records) = runtime_state::plain_records(root, id) else {
            continue;
        };
        for record in records
            .into_iter()
            .filter(|record| !record.reachable_here())
        {
            let folder = record.folder(root);
            let vault_id = id.to_string();
            let token = record.token.clone();
            let probe = folder.clone();
            let here = within_limit(
                &folder,
                "plain_follow",
                FOLDER_STATUS_CHECK_LIMIT,
                move || verified_marker(&probe, &vault_id, &token).is_some(),
            )
            .unwrap_or(false);
            if here && runtime_state::follow_plain_record(root, id, &record.token).is_ok() {
                crate::logging::log_event(
                    crate::logging::LogLevel::Info,
                    "vault_plain_record_followed",
                    &[("id", id)],
                );
            }
        }
    }
}

/// How many of this device's plain-text folders on record are in `container`.
pub(crate) fn records_left_under(root: &VaultRoot, container: &Path) -> u32 {
    let Ok(state) = runtime_state::load_runtime_state(root) else {
        return 0;
    };
    state
        .vaults
        .values()
        .flat_map(|entry| entry.plain.iter())
        .filter(|record| record.reachable_here())
        .filter(|record| record.folder(root).parent() == Some(container))
        .count() as u32
}

/// Drop this device's records of folders under `container` that are proven
/// gone, before the container itself goes and that proof with it.
pub(crate) fn forget_gone_records_under(root: &VaultRoot, container: &Path) {
    let Ok(state) = runtime_state::load_runtime_state(root) else {
        return;
    };
    for (vault_id, entry) in state.vaults {
        for record in entry.plain.iter().filter(|record| record.reachable_here()) {
            let folder = record.folder(root);
            if folder.parent() != Some(container) {
                continue;
            }
            let gone = matches!(
                check_marker(&folder, &vault_id, &record.token),
                MarkerCheck::Absent
            ) && container_proves(container, record);
            if gone {
                let _ = runtime_state::remove_plain_record(root, &vault_id, &record.token);
            }
        }
    }
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
    job: &Job,
) -> Result<PlainWipe> {
    let folder = record.folder(root);
    let wipe = match check_marker(&folder, vault_id, &record.token) {
        MarkerCheck::Ours(marker) => wipe_folder(root, &folder, &marker, opts, job)?,
        MarkerCheck::Absent => PlainWipe::default(),
        // Read again here, the marker no longer answers: the record stays.
        MarkerCheck::Unknown => return Err(unreachable(root, record)),
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
/// [`finish_folder`] does. `job` reports the bytes, and a stop keeps what is
/// left.
fn wipe_folder(
    root: &VaultRoot,
    folder: &Path,
    marker: &Marker,
    opts: &WipeOptions,
    job: &Job,
) -> Result<PlainWipe> {
    if let Ok((_, bytes)) = disk::tally(folder, &[MARKER_NAME]) {
        job.set_total(bytes);
    }
    let swept = sweep::sweep_folder(folder, &[MARKER_NAME], opts, &mut |_, stamp| {
        if job.is_stopped() {
            return Visit::Keep;
        }
        job.advance(stamp.len);
        Visit::Wipe
    })?;
    let wipe = PlainWipe {
        wiped: swept.removed,
        kept: swept.kept.len() as u32,
    };
    if wipe.kept == 0 {
        finish_folder(root, folder, marker)?;
    }
    residue::purge_after_close(folder, opts);
    Ok(wipe)
}

/// The folder holds only the marker. The marker goes. A folder Upriv made
/// goes with it, and its `upriv-unlocked` goes once that holds nothing but
/// its folder ID file. A folder the user made is left empty, with their
/// permissions.
pub(super) fn finish_folder(
    root: &VaultRoot,
    folder: &Path,
    marker: &Marker,
) -> std::io::Result<()> {
    marker::remove(folder)?;
    if marker.made_folder {
        crate::host_fs::remove_dir(folder)?;
        release_container_of(root, folder);
    }
    Ok(())
}

/// `upriv-unlocked` goes with its last vault folder. The records of folders
/// under it that are gone are dropped first, while that is still provable.
pub(crate) fn release_container_of(root: &VaultRoot, vault_folder: &Path) {
    let Some(container) = vault_folder.parent() else {
        return;
    };
    if !crate::folder_list::names_folder(container, UNLOCKED_CONTAINER) {
        return;
    }
    forget_gone_records_under(root, container);
    remove_container_if_empty(container);
}

/// What a recorded folder holds of the session that wrote it.
enum MarkerCheck {
    /// The folder is there with that session's marker: its files may be too.
    Ours(Marker),
    /// Nothing of the session is there: no folder, or one without its marker.
    Absent,
    /// The folder or its marker did not read: nothing is proven.
    Unknown,
}

fn check_marker(folder: &Path, vault_id: &str, token: &str) -> MarkerCheck {
    match crate::host_fs::entry_kind(folder) {
        Ok(crate::host_fs::EntryKind::Dir) => {}
        // A file or a link stands where the folder was: Upriv makes neither.
        Ok(_) => return MarkerCheck::Absent,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return MarkerCheck::Absent,
        Err(_) => return MarkerCheck::Unknown,
    }
    match marker::read(folder) {
        Ok(Some(marker)) if marker.written_by(vault_id, token) => MarkerCheck::Ours(marker),
        Ok(_) => MarkerCheck::Absent,
        Err(_) => MarkerCheck::Unknown,
    }
}

fn verified_marker(folder: &Path, vault_id: &str, token: &str) -> Option<Marker> {
    match check_marker(folder, vault_id, token) {
        MarkerCheck::Ours(marker) => Some(marker),
        MarkerCheck::Absent | MarkerCheck::Unknown => None,
    }
}

/// The `upriv-unlocked` that held the record's folder answers with the
/// record's ID: the same folder, on the same drive.
fn container_proves(container: &Path, record: &PlainRecord) -> bool {
    container_id(container)
        .ok()
        .flatten()
        .is_some_and(|id| id == record.folder_id)
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
    use crate::folder_list::unlocked::ensure_container;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::{test_job_id, unlocked_rows, vault_root_with, VaultSpec};
    use std::path::PathBuf;

    fn plain_root() -> (tempfile::TempDir, VaultRoot) {
        vault_root_with(&[VaultSpec::upriv_plain("notes", "Notes", 1)])
    }

    /// `<tmp>/places/upriv-unlocked/Notes`, and the ID of its `upriv-unlocked`.
    fn notes_folder(tmp: &tempfile::TempDir) -> (PathBuf, String) {
        let container = tmp.path().join("places").join(UNLOCKED_CONTAINER);
        std::fs::create_dir_all(container.parent().unwrap()).unwrap();
        let id = ensure_container(&container).unwrap();
        (container.join("Notes"), id)
    }

    fn leftover(folder: &Path, vault_id: &str, token: &str) {
        std::fs::create_dir_all(folder.join("sub")).unwrap();
        std::fs::write(folder.join("a.txt"), b"secret a").unwrap();
        std::fs::write(folder.join("sub").join("b.txt"), b"secret b").unwrap();
        std::fs::write(folder.join(".nomedia"), b"").unwrap();
        let helpers = vec![".nomedia".to_string()];
        marker::write(folder, &Marker::open(vault_id, token, &helpers, true)).unwrap();
    }

    fn record(folder: &Path, token: &str, folder_id: &str) -> PlainRecord {
        PlainRecord::written_here(
            folder.display().to_string(),
            false,
            token.to_string(),
            folder_id.to_string(),
        )
    }

    /// Tests run side by side, and a running job id is taken.
    fn remove_leftover(root: &VaultRoot) -> Result<PlainWipe> {
        static NEXT_JOB: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let job = NEXT_JOB.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        remove_plain_leftover(root, "notes", &format!("leftover-{job}"))
    }

    #[test]
    fn a_stopped_wipe_keeps_the_rest_and_the_vault_stays_in_recovery() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "t1");
        let saved = record(&folder, "t1", &id);
        runtime_state::adopt_plain_record(&root, "notes", saved.clone()).unwrap();

        let stopped = Job::stopped_by(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(
            true,
        )));
        let wipe = wipe_recorded(
            &root,
            "notes",
            &saved,
            &WipeOptions::for_vault_dir(&root.vault_dir("notes").unwrap()),
            &stopped,
        )
        .unwrap();
        assert_eq!(wipe.wiped, 0);
        assert!(wipe.kept > 0);
        assert!(folder.join("a.txt").exists());
        assert!(holds_leftover(&root, "notes"));

        assert_eq!(remove_leftover(&root).unwrap().kept, 0);
        assert!(!holds_leftover(&root, "notes"));
    }

    #[test]
    fn a_wipe_reports_the_bytes_of_the_folder() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "t1");
        let saved = record(&folder, "t1", &id);
        runtime_state::adopt_plain_record(&root, "notes", saved.clone()).unwrap();

        let job_id = test_job_id();
        let job = Job::start(&job_id).unwrap();
        let wipe = WipeOptions::for_vault_dir(&root.vault_dir("notes").unwrap());
        wipe_recorded(&root, "notes", &saved, &wipe, &job).unwrap();
        let status = crate::session::job_status(&job_id).expect("running");
        assert_eq!((status.bytes_done, status.bytes_total), (16, 16));
    }

    #[test]
    fn remove_wipes_the_folder_and_its_empty_upriv_unlocked() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "t1");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();

        let found = plain_leftover(&root, "notes").unwrap().expect("leftover");
        assert!(found.found);
        assert_eq!((found.files, found.bytes), (2, 16));

        let wipe = remove_leftover(&root).unwrap();
        assert_eq!(wipe, PlainWipe { wiped: 3, kept: 0 });
        assert!(plain_leftover(&root, "notes").unwrap().is_none());
        assert!(!folder.exists());
        assert!(!folder.parent().unwrap().exists());
        assert!(tmp.path().join("places").exists());
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
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "t1");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();
        assert!(listed(&root));

        remove_leftover(&root).unwrap();
        assert!(!listed(&root));
    }

    #[test]
    fn the_list_does_not_mark_a_folder_with_another_token() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "someone-else");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();
        assert!(!holds_leftover(&root, "notes"));
    }

    #[test]
    fn a_marker_that_does_not_read_proves_nothing_and_keeps_the_record() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "t1");
        let saved = record(&folder, "t1", &id);
        runtime_state::adopt_plain_record(&root, "notes", saved.clone()).unwrap();
        // The folder and its files are there; its marker no longer reads.
        std::fs::write(folder.join(MARKER_NAME), b"{").unwrap();

        assert!(matches!(
            ensure_no_leftover(&root, "notes"),
            Err(UprivError::PlainFolderUnreachable { .. })
        ));
        forget_gone_records_under(&root, folder.parent().unwrap());
        let wipe = WipeOptions::for_vault_dir(&root.vault_dir("notes").unwrap());
        assert!(wipe_recorded(&root, "notes", &saved, &wipe, &Job::untracked()).is_err());
        assert_eq!(
            runtime_state::plain_records(&root, "notes").unwrap().len(),
            1
        );
        assert!(folder.join("a.txt").exists());
    }

    #[test]
    fn a_folder_gone_from_its_proven_container_drops_the_record() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();
        assert!(ensure_no_leftover(&root, "notes").is_ok());
        assert!(runtime_state::plain_records(&root, "notes")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_folder_with_another_token_on_a_proven_drive_is_forgotten_not_wiped() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "someone-else");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();

        assert!(!plain_leftover(&root, "notes").unwrap().unwrap().found);
        assert_eq!(remove_leftover(&root).unwrap(), PlainWipe::default());
        assert!(plain_leftover(&root, "notes").unwrap().is_none());
        assert_eq!(std::fs::read(folder.join("a.txt")).unwrap(), b"secret a");
    }

    #[test]
    fn a_folder_that_merely_answers_empty_keeps_the_record() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();
        // The mount point is there, empty: its drive is gone.
        std::fs::remove_file(
            folder
                .parent()
                .unwrap()
                .join(crate::folder_list::unlocked::UNLOCKED_ID_FILE),
        )
        .unwrap();
        assert!(matches!(
            ensure_no_leftover(&root, "notes"),
            Err(UprivError::PlainFolderUnreachable { .. })
        ));
        assert!(runtime_state::reachable_plain_record(&root, "notes")
            .unwrap()
            .is_some());
    }

    #[test]
    fn another_drive_in_its_place_keeps_the_record() {
        let (tmp, root) = plain_root();
        let (folder, _) = notes_folder(&tmp);
        runtime_state::adopt_plain_record(
            &root,
            "notes",
            record(&folder, "t1", "0123456789abcdef0123456789abcdef"),
        )
        .unwrap();
        assert!(matches!(
            ensure_no_leftover(&root, "notes"),
            Err(UprivError::PlainFolderUnreachable { .. })
        ));
        let records = runtime_state::plain_records(&root, "notes").unwrap();
        let views = plain_record_views(&root, "notes", records);
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].state, PlainRecordState::Away);
    }

    #[test]
    fn the_right_drive_without_the_folder_drops_the_record() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();
        ensure_no_leftover(&root, "notes").unwrap();
        assert!(runtime_state::reachable_plain_record(&root, "notes")
            .unwrap()
            .is_none());
    }

    #[test]
    fn forget_drops_a_record_whose_drive_is_away_and_leaves_its_files() {
        let (tmp, root) = plain_root();
        let gone = tmp
            .path()
            .join("unplugged")
            .join(UNLOCKED_CONTAINER)
            .join("Notes");
        runtime_state::adopt_plain_record(
            &root,
            "notes",
            record(&gone, "t1", "0123456789abcdef0123456789abcdef"),
        )
        .unwrap();
        assert!(ensure_no_leftover(&root, "notes").is_err());
        plain_record_forget(&root, "notes", "t1").unwrap();
        ensure_no_leftover(&root, "notes").unwrap();
    }

    #[test]
    fn a_record_follows_its_folder_to_this_device() {
        let (tmp, root) = plain_root();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "t1");
        let mut state = runtime_state::load_runtime_state(&root).unwrap();
        state.vaults.insert(
            "notes".into(),
            runtime_state::RuntimeVaultEntry {
                session: "closed".into(),
                mount_point: None,
                plain: vec![PlainRecord {
                    device: "3e301fc022fc5185e12822bc2a251f64".into(),
                    ..record(&folder, "t1", &id)
                }],
            },
        );
        runtime_state::save_runtime_state(&root, &state).unwrap();
        assert!(!holds_leftover(&root, "notes"));

        follow_records(&root, &crate::vault::list_vault_entries(&root).unwrap());
        assert!(holds_leftover(&root, "notes"));
    }

    #[test]
    fn an_orphan_folder_is_recorded_from_its_marker() {
        let (tmp, root) = plain_root();
        let base = tmp.path().join("places");
        let vault_dir = root.vault_dir("notes").unwrap();
        let mut config = load_vault_config(&vault_dir).unwrap();
        unlocked_rows(&mut config, &[&base]);
        crate::config::save_vault_config(&vault_dir, &config).unwrap();
        let (folder, _) = notes_folder(&tmp);
        leftover(&folder, "notes", "t9");

        assert!(plain_leftover(&root, "notes").unwrap().is_none());
        adopt_orphans(&root, &crate::vault::list_vault_entries(&root).unwrap());
        let found = plain_leftover(&root, "notes").unwrap().expect("adopted");
        assert!(found.found);
        assert_eq!(remove_leftover(&root).unwrap().kept, 0);
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
        unlocked_rows(&mut config, &[parent]);
        config.storage.plain_files = crate::store::VaultPlainFiles::Whole;
        config
    }

    fn vault_folder(parent: &Path) -> PathBuf {
        parent.join(UNLOCKED_CONTAINER).join("Notes")
    }

    #[test]
    fn an_unplugged_row_hands_over_to_the_next_with_a_saved_switch() {
        let (tmp, root) = vault_root_with(&[]);
        let unplugged = tmp.path().join("unplugged");
        let second = tmp.path().join("second");
        std::fs::create_dir_all(&second).unwrap();
        let mut config = own_folder_config("notes", "Notes", &unplugged, true);
        unlocked_rows(&mut config, &[&unplugged, &second]);
        crate::create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();

        let opened = crate::open_vault(&root, "notes", b"pass-word-ok").expect("open");
        assert!(vault_folder(&second).is_dir());
        assert!(!unplugged.exists());
        assert_eq!(opened.switches.len(), 1);
        assert!(opened.switches[0].saved);
        crate::close_vault(&root, "notes").unwrap();

        let device = crate::device::this_device();
        let saved = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        assert_eq!(
            saved.unlocked_folder.devices.selection_here(device),
            crate::folder_list::Selection::Row(2)
        );
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
        let folder = vault_folder(&parent);
        crate::open_vault(&root, "notes", b"pass-word-ok").expect("open");
        assert!(folder.is_dir());
        crate::vault::fs_write_file(&root, "notes", "/hello.txt", b"secret").unwrap();
        crate::plain_sync(&root, "notes").unwrap();
        assert_eq!(std::fs::read(folder.join("hello.txt")).unwrap(), b"secret");

        let closed = crate::close_vault(&root, "notes").unwrap();
        assert_eq!(closed.plain.unwrap().kept, 0);
        assert!(!folder.exists());

        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
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
        let folder = vault_folder(&parent);
        crate::open_vault(root, "notes", b"pass-word-ok").unwrap();
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
        config.storage.plain_files = crate::store::VaultPlainFiles::Chosen;
        crate::create_vault(root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        let folder = vault_folder(&parent);
        crate::open_vault(root, "notes", b"pass-word-ok").unwrap();
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
    fn a_whole_vault_folder_holds_a_damaged_file_with_zeros_and_marks_it() {
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_plain_vault(&tmp, &root);
        crate::vault::fs_write_file(&root, "notes", "/broken.txt", b"lost bytes").unwrap();
        let blob =
            crate::session::with_open_session(&root.vault_dir("notes").unwrap(), |session| {
                let (file_id, _, _) = session
                    .index
                    .find("broken.txt")
                    .and_then(|node| node.as_file())
                    .expect("broken.txt");
                crate::store::blob_path(root.vault_store_dir("notes").unwrap(), file_id)
            })
            .unwrap();
        crate::close_vault(&root, "notes").unwrap();
        // Past the key copy and the 24-byte nonce: the first chunk fails its tag.
        let mut bytes = std::fs::read(&blob).unwrap();
        bytes[crate::store::KEY_COPY_LEN as usize + 24] ^= 0x01;
        std::fs::write(&blob, &bytes).unwrap();

        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(std::fs::read(folder.join("hello.txt")).unwrap(), b"secret");
        assert_eq!(
            std::fs::read(folder.join("broken.txt")).unwrap(),
            vec![0u8; b"lost bytes".len()]
        );
        let mark = crate::vault::fs_list_tree(&root, "notes")
            .unwrap()
            .children
            .unwrap_or_default()
            .into_iter()
            .find(|child| child.name == "broken.txt")
            .and_then(|child| child.problem);
        assert_eq!(mark, Some(crate::store::FileProblem::Damaged));
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

        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
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
        let summary = closed.plain.unwrap();
        assert_eq!((summary.kept, summary.leftover), (1, false));
        assert!(!folder.join("hello.txt").exists());
        assert_eq!(
            std::fs::read(folder.join("theirs.txt")).unwrap(),
            b"not the vault's"
        );
    }

    #[test]
    fn a_close_that_keeps_files_reports_the_leftover_the_list_shows() {
        let listed = |root: &VaultRoot| {
            crate::list_vaults(root)
                .unwrap()
                .into_iter()
                .find(|vault| vault.id == "notes")
                .unwrap()
        };
        let (tmp, root) = vault_root_with(&[]);
        let folder = open_plain_vault(&tmp, &root);
        // A name the vault never holds: the closing pass leaves it in the folder.
        std::fs::create_dir_all(folder.join(".upriv-config")).unwrap();
        std::fs::write(folder.join(".upriv-config/notes.txt"), b"not the vault's").unwrap();

        let summary = crate::close_vault(&root, "notes").unwrap().plain.unwrap();
        assert_eq!((summary.kept, summary.leftover), (1, true));
        assert!(listed(&root).plain_leftover);

        remove_leftover(&root).unwrap();
        let after = listed(&root);
        assert!(!after.plain_leftover);
        assert_eq!(after.session, None);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_the_user_made_stays_empty_with_its_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let (tmp, root) = vault_root_with(&[]);
        let parent = tmp.path().join("places");
        let folder = vault_folder(&parent);
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
        assert!(!parent.join(UNLOCKED_CONTAINER).exists());
        crate::close_vault(&root, "notes").unwrap();
        assert!(!parent.join(UNLOCKED_CONTAINER).exists());
    }

    /// A leftover is real plain text on the disk, whatever `config.toml`
    /// says the vault is: an open whose copy says encrypted is refused too,
    /// and Remove the folder lets it through.
    #[test]
    fn a_leftover_blocks_an_open_whose_copy_says_encrypted() {
        let (tmp, root) = vault_root_with(&[]);
        crate::create_vault(
            &root,
            crate::test_support::quiet_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
        let (folder, id) = notes_folder(&tmp);
        leftover(&folder, "notes", "t1");
        runtime_state::adopt_plain_record(&root, "notes", record(&folder, "t1", &id)).unwrap();

        assert!(matches!(
            crate::open_vault(&root, "notes", b"pass-word-ok"),
            Err(UprivError::PlainLeftover)
        ));
        assert_eq!(remove_leftover(&root).unwrap().kept, 0);
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        crate::close_vault(&root, "notes").unwrap();
    }
}
