//! The data folder list as Setup, the Gate, and the Data folder window use
//! it: the list, the status of one of its folders, the apply that saves an
//! edit and opens the folder it selects, and the search for a data folder
//! that answers when the selected one does not: at launch, or once the one
//! in use was lost while Upriv ran.
//!
//! A search hands over only to a valid data folder that already exists: it
//! never makes one and never takes an incomplete one. An apply makes one only
//! where the person chose: inside a row's folder that exists, or at Default,
//! the app's own folder. After the data folder in use was lost, a search
//! switches only once no vault of it is open and no close or open of one
//! runs, and it reports the vaults that ended with it.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use serde::Serialize;

use crate::config::load_vault_config;
use crate::device::{this_device, DeviceSystem};
use crate::error::{Result, UprivError};
use crate::folder_list::backup::DATA_FOLDER_BACKUPS_DIR;
use crate::folder_list::data_folder::{
    chain, load_data_folder_list, lock_data_folder_list, save_data_folder_list, selected_place,
    selection_of, DataFolderChoice, DataFolderList, DataFolderPlace,
};
use crate::folder_list::{
    apply_changes, fail_over, path_issue, row_folder, ChoiceName, Failover, Level, ListChanges,
    ListKind, ListName, Switch, Try,
};
use crate::folder_probe::{
    probe_writable, within_limit, FolderState, FOLDER_STATUS_CHECK_LIMIT, FOLDER_SWITCH_CHECK_LIMIT,
};
use crate::paths::{
    app_home_dir, copy_data_folder_into, data_folder_in_use, default_data_folder,
    explicit_data_folder, inspect_vault_root_at, open_or_initialize_vault_root, relocate_upriv_dir,
    IncompleteReplacePolicy, UprivDirRelocate, VaultRoot, VaultRootBootstrapPrefs,
    VaultRootDirStatus, VaultRootSource,
};
use crate::session::{Job, JobKind};

use super::lost_sessions::{end_lost_sessions, lost_work_runs};
use super::persistence::load_vault_persistence;

/// How often a search waiting on a folder looks whether it was stopped.
const SEARCH_STOP_POLL: Duration = Duration::from_millis(100);

/// `data_folder_list`: every device's group, and where this device's
/// Default is.
#[derive(Debug, Clone)]
pub struct DataFolderView {
    pub list: DataFolderList,
    /// Default's folder on a computer. `None` on a phone, where Default is
    /// Documents/Upriv.
    pub default_folder: Option<PathBuf>,
    /// The data folder the environment sets (`UPRIV_VAULT_ROOT`), which wins
    /// over the list.
    pub explicit: Option<PathBuf>,
}

/// `new_list` leaves the file unread and shows an empty list: the start of
/// Start a new list, when the file cannot be read.
pub fn data_folder_view(new_list: bool) -> Result<DataFolderView> {
    let list = if new_list {
        DataFolderList::default()
    } else {
        load_data_folder_list(&app_home_dir()?)?
    };
    let default_folder = match DeviceSystem::current() {
        DeviceSystem::Android => None,
        _ => Some(default_data_folder()?),
    };
    Ok(DataFolderView {
        list,
        default_folder,
        explicit: explicit_data_folder(),
    })
}

/// What a folder of the list holds, once it answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DataFolderContent {
    /// A data folder Upriv opens.
    Valid,
    /// `.upriv` is there and broken: Repair.
    Incomplete,
    /// No `.upriv` yet: choosing the folder makes one.
    Empty,
    /// `.upriv` could not be read.
    Unreadable,
}

/// What a valid data folder holds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFolderDetails {
    /// Its vaults, hidden ones not counted.
    pub vaults: u32,
    /// About what its vaults hold, as each recorded it, plus its backup zips.
    pub size_bytes: u64,
}

/// The status of one folder of the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFolderStatus {
    pub state: FolderState,
    pub content: Option<DataFolderContent>,
    pub details: Option<DataFolderDetails>,
}

/// The check behind a status and a search: whether the folder answers and
/// takes a write, then what it holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DataFolderCheck {
    state: FolderState,
    content: Option<DataFolderContent>,
}

impl DataFolderCheck {
    fn failed(state: FolderState) -> Self {
        Self {
            state,
            content: None,
        }
    }
}

/// `folder_status` of the data folder list: Default when `row_path` is
/// `None`, else a row's path. Each check runs within its own limit.
pub fn data_folder_status(row_path: Option<&str>) -> Result<DataFolderStatus> {
    let (folder, may_make) = match row_path {
        None => (default_data_folder()?, true),
        Some(path) => {
            if path_issue(DeviceSystem::current(), ListKind::DataFolder, path).is_some() {
                return Ok(DataFolderStatus {
                    state: FolderState::Refused,
                    content: None,
                    details: None,
                });
            }
            (row_folder(path), false)
        }
    };
    let check = check_within(&folder, may_make, FOLDER_STATUS_CHECK_LIMIT);
    let details = if check.content == Some(DataFolderContent::Valid) {
        let at = folder.clone();
        within_limit(
            &folder,
            "data_folder_details",
            FOLDER_STATUS_CHECK_LIMIT,
            move || details_of(&at),
        )
    } else {
        None
    };
    Ok(DataFolderStatus {
        state: check.state,
        content: check.content,
        details,
    })
}

fn check_within(folder: &Path, may_make: bool, limit: Duration) -> DataFolderCheck {
    let at = folder.to_path_buf();
    within_limit(folder, "data_folder", limit, move || {
        check_folder(&at, may_make)
    })
    .unwrap_or(DataFolderCheck::failed(FolderState::NotResponding))
}

/// `may_make`: Default's folder may not exist yet; choosing it makes it.
fn check_folder(folder: &Path, may_make: bool) -> DataFolderCheck {
    if crate::host_fs::is_unmounted_saf_root(folder) {
        // The platform could not mount the tree: its drive is away or its
        // grant is gone.
        return DataFolderCheck::failed(FolderState::Missing);
    }
    let state = probe_writable(folder);
    let parent_answers = || folder.parent().is_some_and(|parent| parent.host_is_dir());
    if state == FolderState::Missing && may_make && parent_answers() {
        return DataFolderCheck {
            state: FolderState::Ok,
            content: Some(DataFolderContent::Empty),
        };
    }
    if !state.is_ok() {
        return DataFolderCheck::failed(state);
    }
    let content = match inspect_vault_root_at(folder) {
        VaultRootDirStatus::Valid => DataFolderContent::Valid,
        VaultRootDirStatus::Absent => DataFolderContent::Empty,
        VaultRootDirStatus::Incomplete => DataFolderContent::Incomplete,
        VaultRootDirStatus::Unreadable => DataFolderContent::Unreadable,
    };
    DataFolderCheck {
        state,
        content: Some(content),
    }
}

/// Read from the files each vault keeps beside its store and from a listing
/// of its backups: no store file is opened.
fn details_of(folder: &Path) -> DataFolderDetails {
    let mut details = DataFolderDetails::default();
    let Ok(entries) = crate::host_fs::read_dir(VaultRoot::new(folder).vaults_dir()) else {
        return details;
    };
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.host_is_dir()) {
            continue;
        }
        let vault_dir = entry.path();
        let Ok(config) = load_vault_config(&vault_dir) else {
            continue;
        };
        if !config.vault.hidden {
            details.vaults += 1;
        }
        let files = load_vault_persistence(&vault_dir)
            .ok()
            .flatten()
            .and_then(|persistence| persistence.files_bytes)
            .unwrap_or(0);
        let (_, zips) =
            super::folder_status::count_zips(&vault_dir.join(DATA_FOLDER_BACKUPS_DIR), false);
        details.size_bytes = details
            .size_bytes
            .saturating_add(files)
            .saturating_add(zips);
    }
    details
}

/// What a `data_folder_apply` asks for.
#[derive(Debug, Clone)]
pub struct DataFolderApply {
    /// The person's edits of the list. Empty uses the selection as it is.
    pub changes: ListChanges<DataFolderChoice>,
    /// Start from an empty list: the file could not be read, and the person
    /// chose to start a new one.
    pub new_list: bool,
    /// How to replace a broken `.upriv` in the folder it selects.
    pub replace: Option<IncompleteReplacePolicy>,
    /// What a new data folder starts with. A folder that opens keeps its own.
    pub bootstrap: VaultRootBootstrapPrefs,
    /// A phone: copy its private data folder into the folder it selects
    /// first, as this job.
    pub adopt_private: Option<String>,
}

/// What an apply did.
#[derive(Debug)]
pub struct DataFolderApplied {
    /// The data folder in use afterwards.
    pub root: VaultRoot,
    pub source: VaultRootSource,
    /// The data folder in use changed, or there was none: the caller moves
    /// the log to it.
    pub switched: bool,
    /// What the folder held before a switch made or replaced it.
    pub prior: VaultRootDirStatus,
    pub created: bool,
    pub private_root: Option<UprivDirRelocate>,
}

/// Save the person's edits of the list and open the folder it selects,
/// making a data folder there when it has none. The list is written only
/// once that folder opened, so a launch never selects a folder that failed.
///
/// The list is edited only while no vault is busy (`root_idle`): the caller
/// ends the vaults still open in a lost data folder
/// ([`crate::end_lost_sessions`]), then refuses with
/// [`UprivError::VaultRootBusy`] while any other work runs.
pub fn apply_data_folder(request: &DataFolderApply) -> Result<DataFolderApplied> {
    let device = this_device();
    let home = app_home_dir()?;
    let _list = lock_data_folder_list();
    let before = if request.new_list {
        DataFolderList::default()
    } else {
        load_data_folder_list(&home)?
    };
    let mut list = before.clone();
    let default = default_data_folder()?;
    apply_changes(
        &mut list.devices,
        &request.changes,
        device,
        &fixed_folders(&default),
    )?;

    if let Some(explicit) = explicit_data_folder() {
        save_data_folder_list(&home, &list)?;
        return Ok(DataFolderApplied {
            root: VaultRoot::discover(&explicit)?,
            source: VaultRootSource::Explicit,
            switched: false,
            prior: VaultRootDirStatus::Valid,
            created: false,
            private_root: None,
        });
    }
    let place = selected_place(&list, device);
    let (folder, source) = match &place {
        DataFolderPlace::Default => (default, VaultRootSource::Default),
        DataFolderPlace::Row(row) => (data_folder_in_use(row), VaultRootSource::Row),
    };
    // A repair (a replace policy) always runs, also on the folder in use.
    let stays = !request.new_list
        && request.replace.is_none()
        && crate::logging::vault_root_was_ready()
        && selected_place(&before, device) == place;
    if stays {
        save_data_folder_list(&home, &list)?;
        return Ok(DataFolderApplied {
            root: VaultRoot::discover(&folder)?,
            source,
            switched: false,
            prior: VaultRootDirStatus::Valid,
            created: false,
            private_root: None,
        });
    }
    if matches!(place, DataFolderPlace::Row(_)) {
        // Upriv makes `.upriv` inside a row's folder, never the folder itself.
        let state = folder_answers(&folder);
        if !state.is_ok() {
            return Err(UprivError::DataFolderUnavailable(state));
        }
    }
    let private_root = match &request.adopt_private {
        Some(job) => Some(adopt_private_root(&home, &folder, job)?),
        None => None,
    };
    let prior = inspect_vault_root_at(&folder);
    let bootstrap = (prior != VaultRootDirStatus::Valid).then_some(&request.bootstrap);
    let opened = open_or_initialize_vault_root(&folder, request.replace, bootstrap)
        .and_then(|opened| save_data_folder_list(&home, &list).map(|()| opened));
    match opened {
        Ok(opened) => Ok(DataFolderApplied {
            root: opened.root,
            source,
            switched: true,
            prior,
            created: opened.created,
            private_root,
        }),
        Err(error) => {
            if private_root == Some(UprivDirRelocate::Moved) {
                put_private_root_back(&home, &folder);
            }
            Err(error)
        }
    }
}

/// The folders of this device's fixed choices, which no row may name.
fn fixed_folders(default: &Path) -> Vec<String> {
    match DeviceSystem::current() {
        // A phone's Default is a tree the platform mounts, not a path.
        DeviceSystem::Android => Vec::new(),
        _ => vec![default.display().to_string()],
    }
}

fn folder_answers(folder: &Path) -> FolderState {
    if crate::host_fs::is_unmounted_saf_root(folder) {
        return FolderState::Missing;
    }
    match crate::host_fs::entry_kind(folder) {
        Ok(crate::host_fs::EntryKind::Dir) => FolderState::Ok,
        Ok(_) => FolderState::Missing,
        Err(error) => FolderState::of_io(&error),
    }
}

/// A phone copies the data folder it kept in its private app folder into
/// the folder it selects, which the platform mounted as the data folder.
fn adopt_private_root(home: &Path, folder: &Path, job: &str) -> Result<UprivDirRelocate> {
    if folder != Path::new(crate::host_fs::SAF_VAULT_ROOT)
        || !crate::host_fs::is_bridge_path(folder)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "only a phone's mounted data folder takes its private data folder",
        )
        .into());
    }
    copy_data_folder_into(home, folder, job)
}

/// Put a copied private `.upriv` back when the apply does not finish: the
/// phone keeps using the folder it had, so the only copy must not stay in
/// the folder that failed.
fn put_private_root_back(home: &Path, folder: &Path) {
    if home.join(".upriv").host_is_dir() {
        return;
    }
    let _ = relocate_upriv_dir(folder, home);
}

/// What a `data_folder_search` found.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFolderSearch {
    /// A data folder answers: the selection, kept or switched to it.
    pub found: bool,
    /// The switch, when the selection changed.
    pub switch: Option<Switch>,
    /// The vaults that ended with the lost data folder.
    pub ended: Vec<String>,
}

/// Look for a data folder that answers, as the job `job_id`, after the
/// selected one did not (at launch, or once the one in use was lost): the
/// selection, then this device's rows, then Default. Every folder is
/// checked at once, each within its own limit, and the chain's order decides
/// which of those that answer is taken. The first that works becomes the
/// selection, once no vault work holds the data folder it leaves.
pub fn search_data_folder(job_id: &str) -> Result<DataFolderSearch> {
    Job::run(job_id, JobKind::DataFolderSearch, None, search)
}

fn search(job: &Job) -> Result<DataFolderSearch> {
    let mut ended = end_lost_sessions();
    let device = this_device();
    if explicit_data_folder().is_some() || device.id.is_none() {
        return Ok(DataFolderSearch {
            found: false,
            switch: None,
            ended,
        });
    }
    let home = app_home_dir()?;
    let list = load_data_folder_list(&home)?;
    let selected = selected_place(&list, device);
    let links = chain(&list, device);
    let default = default_data_folder()?;
    let (sender, receiver) = mpsc::channel();
    for (index, place) in links.iter().enumerate() {
        let folder = match place {
            DataFolderPlace::Default => default.clone(),
            DataFolderPlace::Row(row) => row_folder(&row.path),
        };
        let sender = sender.clone();
        std::thread::spawn(move || {
            let check = check_within(&folder, false, FOLDER_SWITCH_CHECK_LIMIT);
            let answer = match check.content {
                Some(DataFolderContent::Valid) => Ok(()),
                Some(_) => Err(FolderState::Missing),
                None => Err(check.state),
            };
            let _ = sender.send((index, answer));
        });
    }
    drop(sender);

    let mut answers: Vec<Option<std::result::Result<(), FolderState>>> = vec![None; links.len()];
    let outcome = fail_over(&selected, &links, |place| {
        let Some(index) = links.iter().position(|link| link == place) else {
            return Try::Fails(FolderState::Missing);
        };
        loop {
            if let Some(answer) = answers[index] {
                return match answer {
                    Ok(()) => Try::Works(()),
                    Err(state) => Try::Fails(state),
                };
            }
            if job.is_stopped() {
                return Try::Stop(UprivError::JobCancelled);
            }
            match receiver.recv_timeout(SEARCH_STOP_POLL) {
                Ok((at, answer)) => answers[at] = Some(answer),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    answers[index] = Some(Err(FolderState::NotResponding));
                }
            }
        }
    });
    match outcome {
        Failover::Kept(()) => Ok(DataFolderSearch {
            found: true,
            switch: None,
            ended,
        }),
        Failover::Switched { link, reason, .. } => {
            wait_until_root_idle(job, &mut ended)?;
            Ok(DataFolderSearch {
                found: true,
                switch: Some(save_switch(&home, &selected, link, reason)),
                ended,
            })
        }
        Failover::Stopped(error) => Err(error),
        Failover::Unavailable(_) => Ok(DataFolderSearch {
            found: false,
            switch: None,
            ended,
        }),
    }
}

/// Before a switch: no vault of the lost data folder may stay open, and a
/// close or an open still running on one (it fails on its own) is waited
/// for as long as the job runs.
fn wait_until_root_idle(job: &Job, ended: &mut Vec<String>) -> Result<()> {
    loop {
        *ended = end_lost_sessions();
        if !lost_work_runs() {
            return Ok(());
        }
        if job.is_stopped() {
            return Err(UprivError::JobCancelled);
        }
        std::thread::sleep(SEARCH_STOP_POLL);
    }
}

/// Select `to` on this device, reading the list again, and log the switch.
/// A list that cannot be written keeps the switch for this run only.
fn save_switch(
    home: &Path,
    from: &DataFolderPlace,
    to: &DataFolderPlace,
    reason: FolderState,
) -> Switch {
    let device = this_device();
    let _list = lock_data_folder_list();
    let loaded = load_data_folder_list(home);
    let (from_name, to_name) = match &loaded {
        Ok(list) => (
            list.devices.choice_name(device, selection_of(from)),
            list.devices.choice_name(device, selection_of(to)),
        ),
        Err(_) => (ChoiceName::Nothing, ChoiceName::Nothing),
    };
    let saved = loaded.and_then(|mut list| {
        list.devices.select_here(device, selection_of(to));
        save_data_folder_list(home, &list)
    });
    let switch = Switch {
        list: ListName::DataFolder,
        level: Level::App,
        vault: None,
        from: from_name,
        to: to_name,
        reason,
        saved: saved.is_ok(),
    };
    switch.log();
    switch
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::{DeviceGroup, GroupChange, Row, Selection};
    use crate::paths::{initialize_vault_root, EnvGuard, ENV_LOCK};

    /// An app home of its own, with Default in it, for the length of a test.
    struct Home {
        dir: tempfile::TempDir,
        _env: EnvGuard,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl Home {
        fn new() -> Self {
            let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let env =
                EnvGuard::capture(&["UPRIV_DEFAULT_ROOT_ANCHOR", "APPIMAGE", "UPRIV_VAULT_ROOT"]);
            let dir = tempfile::tempdir().unwrap();
            std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", dir.path());
            std::env::remove_var("APPIMAGE");
            std::env::remove_var("UPRIV_VAULT_ROOT");
            crate::logging::reset_vault_root_ready();
            super::super::lost_sessions::forget_data_folder_in_use();
            Self {
                dir,
                _env: env,
                _lock: lock,
            }
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            crate::logging::reset_vault_root_ready();
            super::super::lost_sessions::forget_data_folder_in_use();
        }
    }

    fn row(number: u32, path: &Path) -> Row {
        Row {
            number,
            name: String::new(),
            path: path.display().to_string(),
        }
    }

    /// This device's rows, with `selected` chosen.
    fn changes(
        rows: Vec<Row>,
        selected: Selection<DataFolderChoice>,
    ) -> ListChanges<DataFolderChoice> {
        let mut changes = ListChanges::default();
        changes.groups.insert(
            this_device()
                .id
                .clone()
                .expect("tests need this device's ID"),
            GroupChange {
                remove: false,
                next_number: Some(rows.len() as u32 + 1),
                rows: Some(rows),
                selected: Some(selected),
            },
        );
        changes
    }

    fn request(changes: ListChanges<DataFolderChoice>) -> DataFolderApply {
        DataFolderApply {
            changes,
            new_list: false,
            replace: None,
            bootstrap: VaultRootBootstrapPrefs {
                locale: Some("pt-BR".into()),
            },
            adopt_private: None,
        }
    }

    fn save_list(home: &Path, rows: Vec<Row>, selected: Selection<DataFolderChoice>) {
        let device = this_device();
        let mut list = DataFolderList::default();
        list.devices.0.insert(
            device.id.clone().unwrap(),
            DeviceGroup {
                next_number: rows.len() as u32 + 1,
                rows,
                selected,
                ..DeviceGroup::for_device(device)
            },
        );
        save_data_folder_list(home, &list).unwrap();
    }

    #[test]
    fn default_with_no_data_folder_makes_one_with_the_first_run_locale() {
        let home = Home::new();
        let applied = apply_data_folder(&request(ListChanges::default())).unwrap();
        assert!(applied.switched && applied.created);
        assert_eq!(applied.source, VaultRootSource::Default);
        assert_eq!(applied.prior, VaultRootDirStatus::Absent);
        let settings = std::fs::read_to_string(home.path().join(".upriv/settings.toml")).unwrap();
        assert!(settings.contains("locale = \"pt-BR\""), "{settings}");
        // Default holds nothing a list must keep.
        assert!(!crate::folder_list::data_folder::list_path(home.path()).exists());
    }

    #[test]
    fn a_selected_row_opens_and_the_list_is_written_after() {
        let home = Home::new();
        let usb = tempfile::tempdir().unwrap();
        initialize_vault_root(usb.path()).unwrap();
        let applied = apply_data_folder(&request(changes(
            vec![row(1, usb.path())],
            Selection::Row(1),
        )))
        .unwrap();
        assert_eq!(applied.source, VaultRootSource::Row);
        assert!(!applied.created);
        assert_eq!(applied.root.root(), usb.path().canonicalize().unwrap());
        let list = load_data_folder_list(home.path()).unwrap();
        assert_eq!(
            selected_place(&list, this_device()),
            DataFolderPlace::Row(row(1, usb.path()))
        );
    }

    #[test]
    fn a_row_whose_folder_is_gone_is_refused_and_nothing_is_made() {
        let home = Home::new();
        let gone = home.path().join("unplugged");
        let error = apply_data_folder(&request(changes(vec![row(1, &gone)], Selection::Row(1))))
            .unwrap_err();
        assert!(matches!(
            error,
            UprivError::DataFolderUnavailable(FolderState::Missing)
        ));
        assert!(!gone.exists());
        assert!(!crate::folder_list::data_folder::list_path(home.path()).exists());
    }

    #[test]
    fn a_row_may_not_name_defaults_folder() {
        let home = Home::new();
        let error = apply_data_folder(&request(changes(
            vec![row(1, home.path())],
            Selection::Row(1),
        )))
        .unwrap_err();
        assert!(matches!(error, UprivError::FolderPathDuplicate { .. }));
    }

    #[test]
    fn an_incomplete_folder_needs_a_replace_choice() {
        let home = Home::new();
        let broken = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(broken.path().join(".upriv")).unwrap();
        let ask = request(changes(vec![row(1, broken.path())], Selection::Row(1)));
        assert!(matches!(
            apply_data_folder(&ask),
            Err(UprivError::VaultRootIncomplete { .. })
        ));
        let replace = DataFolderApply {
            replace: Some(IncompleteReplacePolicy::Rename),
            ..ask
        };
        let applied = apply_data_folder(&replace).unwrap();
        assert!(applied.created);
        assert_eq!(applied.prior, VaultRootDirStatus::Incomplete);
        drop(home);
    }

    #[test]
    fn a_repair_runs_on_the_data_folder_in_use() {
        let home = Home::new();
        let folder = tempfile::tempdir().unwrap();
        let ask = request(changes(vec![row(1, folder.path())], Selection::Row(1)));
        let applied = apply_data_folder(&ask).unwrap();
        crate::logging::log_vault_root_ready("row", &applied.root.root().display().to_string());
        std::fs::remove_file(folder.path().join(".upriv").join("settings.toml")).unwrap();
        let unchanged = request(ListChanges::default());
        let kept = apply_data_folder(&unchanged);
        assert!(matches!(kept, Err(UprivError::VaultRootIncomplete { .. })));
        let repair = DataFolderApply {
            replace: Some(IncompleteReplacePolicy::ResetSettings),
            ..unchanged
        };
        let repaired = apply_data_folder(&repair).unwrap();
        assert!(repaired.switched);
        assert_eq!(repaired.prior, VaultRootDirStatus::Incomplete);
        assert!(folder.path().join(".upriv").join("settings.toml").is_file());
        drop(home);
    }

    #[test]
    fn a_new_list_replaces_one_that_cannot_be_read() {
        let home = Home::new();
        std::fs::write(
            crate::folder_list::data_folder::list_path(home.path()),
            "not a list",
        )
        .unwrap();
        assert!(matches!(
            apply_data_folder(&request(ListChanges::default())),
            Err(UprivError::DataFolderListInvalid { .. })
        ));
        let fresh = DataFolderApply {
            new_list: true,
            ..request(ListChanges::default())
        };
        assert!(data_folder_view(false).is_err());
        assert_eq!(
            data_folder_view(true).unwrap().list,
            DataFolderList::default()
        );
        apply_data_folder(&fresh).unwrap();
        assert_eq!(
            load_data_folder_list(home.path()).unwrap(),
            DataFolderList::default()
        );
    }

    #[test]
    fn the_status_of_a_row_says_what_its_folder_holds() {
        let _home = Home::new();
        let usb = tempfile::tempdir().unwrap();
        let empty = data_folder_status(Some(&usb.path().display().to_string())).unwrap();
        assert_eq!(empty.state, FolderState::Ok);
        assert_eq!(empty.content, Some(DataFolderContent::Empty));
        assert!(empty.details.is_none());

        let root = initialize_vault_root(usb.path()).unwrap();
        for spec in [
            crate::test_support::VaultSpec::encrypted("notes", "Notes", 1),
            crate::test_support::VaultSpec::encrypted("work", "Work", 2),
        ] {
            crate::test_support::write_vault_dir(&root.vaults_dir(), &spec);
        }
        crate::config::set_vault_hidden(root.vault_dir("work").unwrap(), true).unwrap();
        let backups = root.vault_dir("notes").unwrap().join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::write(backups.join("20260101000000-notes.zip"), [0u8; 10]).unwrap();
        let valid = data_folder_status(Some(&usb.path().display().to_string())).unwrap();
        assert_eq!(valid.content, Some(DataFolderContent::Valid));
        let details = valid.details.unwrap();
        assert_eq!(details.vaults, 1);
        assert!(details.size_bytes >= 10);
    }

    #[test]
    fn a_missing_row_folder_is_missing_and_defaults_may_be_made() {
        let home = Home::new();
        let gone = home.path().join("gone").display().to_string();
        let row_status = data_folder_status(Some(&gone)).unwrap();
        assert_eq!(row_status.state, FolderState::Missing);
        std::env::set_var("UPRIV_DEFAULT_ROOT_ANCHOR", home.path().join("not-yet"));
        let default_status = data_folder_status(None).unwrap();
        assert_eq!(default_status.state, FolderState::Ok);
        assert_eq!(default_status.content, Some(DataFolderContent::Empty));
    }

    #[test]
    fn a_search_takes_the_first_row_that_answers_and_never_makes_one() {
        let home = Home::new();
        let gone = home.path().join("unplugged");
        let empty = tempfile::tempdir().unwrap();
        let usb = tempfile::tempdir().unwrap();
        initialize_vault_root(usb.path()).unwrap();
        save_list(
            home.path(),
            vec![row(1, &gone), row(2, empty.path()), row(3, usb.path())],
            Selection::Row(1),
        );
        let found = search_data_folder(&crate::test_support::test_job_id()).unwrap();
        assert!(found.found);
        let switch = found.switch.expect("a switch");
        assert_eq!(switch.reason, FolderState::Missing);
        assert!(switch.saved);
        let list = load_data_folder_list(home.path()).unwrap();
        assert_eq!(
            selected_place(&list, this_device()),
            DataFolderPlace::Row(row(3, usb.path()))
        );
        assert!(!gone.exists());
        assert!(!empty.path().join(".upriv").exists());
    }

    #[test]
    fn a_search_that_finds_nothing_keeps_the_selection() {
        let home = Home::new();
        let gone = home.path().join("unplugged");
        save_list(home.path(), vec![row(1, &gone)], Selection::Row(1));
        let found = search_data_folder(&crate::test_support::test_job_id()).unwrap();
        assert!(!found.found && found.switch.is_none());
        let list = load_data_folder_list(home.path()).unwrap();
        assert_eq!(
            list.devices.selection_here(this_device()),
            Selection::Row(1)
        );
    }

    #[test]
    fn a_search_hands_over_to_default_when_it_holds_a_data_folder() {
        let home = Home::new();
        initialize_vault_root(home.path()).unwrap();
        let gone = home.path().join("unplugged");
        save_list(home.path(), vec![row(1, &gone)], Selection::Row(1));
        let found = search_data_folder(&crate::test_support::test_job_id()).unwrap();
        let switch = found.switch.expect("a switch");
        assert_eq!(switch.to, ChoiceName::Fixed { choice: "default" });
    }

    #[test]
    fn a_search_from_default_with_no_data_folder_takes_a_row_that_answers() {
        let home = Home::new();
        let usb = tempfile::tempdir().unwrap();
        initialize_vault_root(usb.path()).unwrap();
        save_list(
            home.path(),
            vec![row(1, usb.path())],
            Selection::Fixed(DataFolderChoice::Default),
        );
        let found = search_data_folder(&crate::test_support::test_job_id()).unwrap();
        let switch = found.switch.expect("a switch");
        assert_eq!(switch.from, ChoiceName::Fixed { choice: "default" });
        assert!(!home.path().join(".upriv").exists());
    }

    #[test]
    fn a_search_after_a_loss_names_the_vaults_that_ended_and_switches() {
        let home = Home::new();
        let lost = tempfile::tempdir().unwrap();
        let usb = tempfile::tempdir().unwrap();
        initialize_vault_root(usb.path()).unwrap();
        let root = initialize_vault_root(lost.path()).unwrap();
        let config = toml::from_str(
            "[vault]\nid = \"notes\"\ndisplay_name = \"Notes\"\norder = 1\n\
             [storage]\nmode = \"encrypted_dir\"\n",
        )
        .unwrap();
        crate::vault::create_vault(
            &root,
            config,
            b"pass-word-ok",
            crate::store::KdfUnlockPreset::M32,
        )
        .unwrap();
        crate::vault::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        let vault_dir = root.vault_dir("notes").unwrap();
        save_list(
            home.path(),
            vec![row(1, lost.path()), row(2, usb.path())],
            Selection::Row(1),
        );
        crate::vault::data_folder_entered(root.root());

        // The drive that held the data folder in use goes away, and the
        // resolve after it finds the selection failing.
        drop(lost);
        assert_eq!(
            crate::vault::leave_lost_data_folder(),
            vec!["Notes".to_string()]
        );
        assert!(!crate::session::is_vault_open_at(&vault_dir));
        let found = search_data_folder(&crate::test_support::test_job_id()).unwrap();

        // The search names it too, for the toast of the switch.
        assert_eq!(found.ended, vec!["Notes".to_string()]);
        let switch = found.switch.expect("a switch");
        assert_eq!(
            switch.to,
            ChoiceName::Row {
                number: 2,
                name: String::new()
            }
        );
    }

    #[test]
    fn a_copied_private_data_folder_goes_back_to_the_app_home() {
        let home = tempfile::tempdir().unwrap();
        let grant = tempfile::tempdir().unwrap();
        let marker = home.path().join(".upriv/marker.txt");
        std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
        std::fs::write(&marker, b"vault").unwrap();
        relocate_upriv_dir(home.path(), grant.path()).unwrap();
        assert!(!marker.exists());
        put_private_root_back(home.path(), grant.path());
        assert_eq!(std::fs::read(&marker).unwrap(), b"vault");
        assert!(!grant.path().join(".upriv").exists());
    }

    #[test]
    fn the_way_back_never_replaces_a_private_data_folder() {
        let home = tempfile::tempdir().unwrap();
        let grant = tempfile::tempdir().unwrap();
        for (parent, text) in [(home.path(), "private"), (grant.path(), "grant")] {
            std::fs::create_dir_all(parent.join(".upriv")).unwrap();
            std::fs::write(parent.join(".upriv/marker.txt"), text).unwrap();
        }
        put_private_root_back(home.path(), grant.path());
        for (parent, text) in [(home.path(), "private"), (grant.path(), "grant")] {
            assert_eq!(
                std::fs::read_to_string(parent.join(".upriv/marker.txt")).unwrap(),
                text
            );
        }
    }

    #[test]
    fn a_stopped_search_ends_as_stopped() {
        let home = Home::new();
        save_list(
            home.path(),
            vec![row(1, &home.path().join("x"))],
            Selection::Row(1),
        );
        let job = crate::test_support::test_job_id();
        crate::session::cancel_job(&job).unwrap();
        assert!(matches!(
            search_data_folder(&job),
            Err(UprivError::JobCancelled)
        ));
    }
}
