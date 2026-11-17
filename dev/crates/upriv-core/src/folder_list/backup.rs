//! The backup folder lists: the app's (`[backups]` in `settings.toml`) and
//! each vault's (`[backup]` in its `config.toml`), and the folder a vault's
//! zips go to in each choice.
//!
//! The data folder keeps them in `vaults/<id>/backups/`. An app row keeps
//! them in `{row}/upriv-backups/{folder id}/`, a vault row in
//! `{row}/upriv-{folder id}-backups/`; each holds the zips and `saves/`.
//! `{folder id}` is the vault id at the first backup there, kept in
//! `persistence.json`, so a rename keeps finding it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::chain::{Level, ListName, Switch};
use super::model::{DeviceGroups, FixedChoice, Row, Selection};
use super::path_rules::{ListKind, SHARED_BACKUPS_CONTAINER};
use crate::device::ThisDevice;
use crate::folder_probe::FolderState;

/// `backups/` of a vault's folder in the data folder.
pub const DATA_FOLDER_BACKUPS_DIR: &str = "backups";

/// The app list's fixed choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppBackupChoice {
    DataFolder,
}

impl FixedChoice for AppBackupChoice {
    const LIST: ListKind = ListKind::Backup;
    const ALL: &'static [Self] = &[Self::DataFolder];
    const DEFAULT: Selection<Self> = Selection::Fixed(Self::DataFolder);
    const ALLOWS_NOTHING: bool = false;

    fn as_str(self) -> &'static str {
        "data_folder"
    }
}

/// A vault list's fixed choices, top to bottom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultBackupChoice {
    /// Use the app's.
    Inherit,
    DataFolder,
}

impl FixedChoice for VaultBackupChoice {
    const LIST: ListKind = ListKind::Backup;
    const ALL: &'static [Self] = &[Self::Inherit, Self::DataFolder];
    const DEFAULT: Selection<Self> = Selection::Fixed(Self::Inherit);
    const ALLOWS_NOTHING: bool = false;

    fn as_str(self) -> &'static str {
        match self {
            Self::Inherit => "inherit",
            Self::DataFolder => "data_folder",
        }
    }
}

/// `[backups]` in `settings.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppBackupFolders {
    #[serde(default, skip_serializing_if = "DeviceGroups::is_empty")]
    pub devices: DeviceGroups<AppBackupChoice>,
}

/// Where a vault's backups go on this device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackupPlace {
    DataFolder,
    AppRow(Row),
    VaultRow(Row),
}

impl BackupPlace {
    /// The folder that holds the zips and `saves/`. A row that already is
    /// that folder is used as it is.
    pub fn dir(&self, vault_dir: &Path, folder_id: &str) -> PathBuf {
        match self {
            Self::DataFolder => vault_dir.join(DATA_FOLDER_BACKUPS_DIR),
            Self::AppRow(row) => {
                let base = super::row_folder(&row.path);
                if super::names_folder(&base, SHARED_BACKUPS_CONTAINER) {
                    base.join(folder_id)
                } else {
                    base.join(SHARED_BACKUPS_CONTAINER).join(folder_id)
                }
            }
            Self::VaultRow(row) => {
                let base = super::row_folder(&row.path);
                let own = own_backups_name(folder_id);
                if super::names_folder(&base, &own) {
                    base
                } else {
                    base.join(own)
                }
            }
        }
    }

    /// The folder the person added, which must exist: a drive that is not
    /// there is never made. `None` for the data folder.
    pub fn row_folder(&self) -> Option<PathBuf> {
        match self {
            Self::DataFolder => None,
            Self::AppRow(row) | Self::VaultRow(row) => Some(super::row_folder(&row.path)),
        }
    }

    pub fn row_path(&self) -> Option<&str> {
        match self {
            Self::DataFolder => None,
            Self::AppRow(row) | Self::VaultRow(row) => Some(row.path.as_str()),
        }
    }
}

/// `upriv-<folder id>-backups`.
pub fn own_backups_name(folder_id: &str) -> String {
    format!("upriv-{folder_id}-backups")
}

fn app_selected(app: &AppBackupFolders, device: &ThisDevice) -> BackupPlace {
    match app.devices.selection_here(device) {
        Selection::Row(number) => app
            .devices
            .row_here(device, number)
            .cloned()
            .map_or(BackupPlace::DataFolder, BackupPlace::AppRow),
        Selection::Fixed(AppBackupChoice::DataFolder) | Selection::Nothing => {
            BackupPlace::DataFolder
        }
    }
}

/// The folder this device's selection names for a vault's backups.
pub fn selected_place(
    app: &AppBackupFolders,
    vault: &DeviceGroups<VaultBackupChoice>,
    device: &ThisDevice,
) -> BackupPlace {
    match vault.selection_here(device) {
        Selection::Row(number) => vault
            .row_here(device, number)
            .cloned()
            .map_or(BackupPlace::DataFolder, BackupPlace::VaultRow),
        Selection::Fixed(VaultBackupChoice::DataFolder) => BackupPlace::DataFolder,
        Selection::Fixed(VaultBackupChoice::Inherit) | Selection::Nothing => {
            app_selected(app, device)
        }
    }
}

/// The order failover tries for a vault: its own rows, then the app's
/// selection, then the app's rows, then the data folder.
pub fn chain(
    app: &AppBackupFolders,
    vault: &DeviceGroups<VaultBackupChoice>,
    device: &ThisDevice,
) -> Vec<BackupPlace> {
    let mut chain: Vec<BackupPlace> = vault
        .rows_here(device)
        .iter()
        .cloned()
        .map(BackupPlace::VaultRow)
        .collect();
    let mut push = |place: BackupPlace| {
        if !chain.contains(&place) {
            chain.push(place);
        }
    };
    push(app_selected(app, device));
    for row in app.devices.rows_here(device) {
        push(BackupPlace::AppRow(row.clone()));
    }
    push(BackupPlace::DataFolder);
    chain
}

/// The selections that taking `place` changes on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BackupSelections {
    pub vault: Option<Selection<VaultBackupChoice>>,
    pub app: Option<Selection<AppBackupChoice>>,
}

/// A vault row is the vault's own. Anything else is reached through the
/// app's chain: the vault uses the app's, and the app takes the place. A
/// vault that chose the data folder keeps it.
pub fn selections_taking(
    app: &AppBackupFolders,
    vault: &DeviceGroups<VaultBackupChoice>,
    device: &ThisDevice,
    place: &BackupPlace,
) -> BackupSelections {
    let vault_now = vault.selection_here(device);
    let app_now = app.devices.selection_here(device);
    let (vault_to, app_to) = match place {
        BackupPlace::VaultRow(row) => (Selection::Row(row.number), None),
        BackupPlace::AppRow(row) => (
            Selection::Fixed(VaultBackupChoice::Inherit),
            Some(Selection::Row(row.number)),
        ),
        BackupPlace::DataFolder if vault_now == Selection::Fixed(VaultBackupChoice::DataFolder) => {
            (vault_now, None)
        }
        BackupPlace::DataFolder => (
            Selection::Fixed(VaultBackupChoice::Inherit),
            Some(Selection::Fixed(AppBackupChoice::DataFolder)),
        ),
    };
    BackupSelections {
        vault: (vault_now != vault_to).then_some(vault_to),
        app: app_to.filter(|to| app_now != *to),
    }
}

/// The switches `taking` records, named from the lists as they were.
pub fn switches(
    app: &AppBackupFolders,
    vault: &DeviceGroups<VaultBackupChoice>,
    device: &ThisDevice,
    vault_id: &str,
    taking: BackupSelections,
    reason: FolderState,
) -> Vec<Switch> {
    let mut out = Vec::new();
    if let Some(to) = taking.vault {
        out.push(Switch {
            list: ListName::Backup,
            level: Level::Vault,
            vault: Some(vault_id.to_string()),
            from: vault.choice_name(device, vault.selection_here(device)),
            to: vault.choice_name(device, to),
            reason,
            saved: false,
        });
    }
    if let Some(to) = taking.app {
        out.push(Switch {
            list: ListName::Backup,
            level: Level::App,
            vault: None,
            from: app
                .devices
                .choice_name(device, app.devices.selection_here(device)),
            to: app.devices.choice_name(device, to),
            reason,
            saved: false,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::model::tests::device;
    use crate::folder_list::model::DeviceGroup;

    fn row(number: u32, path: &str) -> Row {
        Row {
            number,
            name: String::new(),
            path: path.into(),
        }
    }

    fn app_with(
        here: &ThisDevice,
        rows: Vec<Row>,
        selected: Selection<AppBackupChoice>,
    ) -> AppBackupFolders {
        let mut app = AppBackupFolders::default();
        app.devices.0.insert(
            here.id.clone().unwrap(),
            DeviceGroup {
                rows,
                selected,
                next_number: 9,
                ..DeviceGroup::for_device(here)
            },
        );
        app
    }

    fn vault_with(
        here: &ThisDevice,
        rows: Vec<Row>,
        selected: Selection<VaultBackupChoice>,
    ) -> DeviceGroups<VaultBackupChoice> {
        let mut vault = DeviceGroups::default();
        vault.0.insert(
            here.id.clone().unwrap(),
            DeviceGroup {
                rows,
                selected,
                next_number: 9,
                ..DeviceGroup::for_device(here)
            },
        );
        vault
    }

    #[test]
    fn a_device_with_no_group_backs_up_into_the_data_folder() {
        let here = device(b"desk");
        let place = selected_place(
            &AppBackupFolders::default(),
            &DeviceGroups::default(),
            &here,
        );
        assert_eq!(place, BackupPlace::DataFolder);
    }

    #[test]
    fn the_folder_of_each_choice_holds_the_zips() {
        let vault_dir = Path::new("/data/.upriv/vaults/notes");
        assert_eq!(
            BackupPlace::DataFolder.dir(vault_dir, "notes"),
            PathBuf::from("/data/.upriv/vaults/notes/backups")
        );
        assert_eq!(
            BackupPlace::AppRow(row(1, "/mnt/b")).dir(vault_dir, "notes"),
            PathBuf::from("/mnt/b/upriv-backups/notes")
        );
        assert_eq!(
            BackupPlace::AppRow(row(1, "/mnt/b/upriv-backups")).dir(vault_dir, "notes"),
            PathBuf::from("/mnt/b/upriv-backups/notes")
        );
        assert_eq!(
            BackupPlace::VaultRow(row(1, "/mnt/b")).dir(vault_dir, "old-id"),
            PathBuf::from("/mnt/b/upriv-old-id-backups")
        );
        assert_eq!(
            BackupPlace::VaultRow(row(1, "/mnt/b/upriv-notes-backups")).dir(vault_dir, "notes"),
            PathBuf::from("/mnt/b/upriv-notes-backups")
        );
    }

    #[test]
    fn the_chain_ends_at_the_data_folder() {
        let here = device(b"desk");
        let app = app_with(
            &here,
            vec![row(1, "/mnt/a"), row(2, "/mnt/b")],
            Selection::Row(2),
        );
        let vault = vault_with(&here, vec![row(1, "/mnt/v")], Selection::Row(1));
        assert_eq!(
            chain(&app, &vault, &here),
            vec![
                BackupPlace::VaultRow(row(1, "/mnt/v")),
                BackupPlace::AppRow(row(2, "/mnt/b")),
                BackupPlace::AppRow(row(1, "/mnt/a")),
                BackupPlace::DataFolder,
            ]
        );
    }

    #[test]
    fn reaching_the_data_folder_through_the_app_moves_the_app() {
        let here = device(b"desk");
        let app = app_with(&here, vec![row(1, "/mnt/a")], Selection::Row(1));
        let vault = vault_with(&here, vec![row(1, "/mnt/v")], Selection::Row(1));
        let taking = selections_taking(&app, &vault, &here, &BackupPlace::DataFolder);
        assert_eq!(
            taking,
            BackupSelections {
                vault: Some(Selection::Fixed(VaultBackupChoice::Inherit)),
                app: Some(Selection::Fixed(AppBackupChoice::DataFolder)),
            }
        );
        let own = vault_with(
            &here,
            Vec::new(),
            Selection::Fixed(VaultBackupChoice::DataFolder),
        );
        assert_eq!(
            selections_taking(&app, &own, &here, &BackupPlace::DataFolder),
            BackupSelections::default()
        );
        let switched = switches(&app, &vault, &here, "notes", taking, FolderState::NoRoom);
        assert_eq!(switched.len(), 2);
    }

    #[test]
    fn the_lists_round_trip_and_refuse_nothing_selected() {
        let here = device(b"desk");
        let app = app_with(&here, vec![row(1, "/mnt/a")], Selection::Row(1));
        let text = toml::to_string(&app).unwrap();
        assert_eq!(toml::from_str::<AppBackupFolders>(&text).unwrap(), app);
        assert!(serde_json::from_str::<Selection<VaultBackupChoice>>("\"none\"").is_err());
        assert_eq!(
            serde_json::from_str::<Selection<VaultBackupChoice>>("\"data_folder\"").unwrap(),
            Selection::Fixed(VaultBackupChoice::DataFolder)
        );
    }
}
