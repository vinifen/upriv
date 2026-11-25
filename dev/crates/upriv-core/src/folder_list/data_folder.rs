//! The data folder list: `.upriv-data-folder` in the app home.
//!
//! It holds only the list, one group per device, so a data folder carried
//! between machines finds each machine's own choice again. A device with no
//! group uses Default: the folder beside the app for a portable copy, the
//! per-user app folder for an installed one, Documents/Upriv on a phone. The
//! file exists only while it holds a group. Beside the groups it keeps the OS
//! name of each device that has one (`[os_names]`), written by that device.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::chain::ChoiceName;
use super::model::{DeviceGroups, FixedChoice, Row, Selection};
use super::path_rules::ListKind;
use crate::device::{this_device, ThisDevice};
use crate::error::{Result, UprivError};
use crate::os_name::{this_os_name, OsNames};

/// The file in the app home.
pub const DATA_FOLDER_LIST_FILE: &str = ".upriv-data-folder";

/// Held across a read, change, and write of the list, so two requests never
/// write over each other's change. Upriv runs one instance per machine, so
/// this process is the only writer.
static LIST_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn lock_data_folder_list() -> MutexGuard<'static, ()> {
    crate::session::lock_table(&LIST_LOCK)
}

const HEADER: &str = "# Upriv data folder list. Not a vault; holds no secrets.\n\n";

/// The list's fixed choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataFolderChoice {
    Default,
}

impl FixedChoice for DataFolderChoice {
    const LIST: ListKind = ListKind::DataFolder;
    const ALL: &'static [Self] = &[Self::Default];
    const DEFAULT: Selection<Self> = Selection::Fixed(Self::Default);
    /// A data folder that is lost stays selected: the next resolve searches.
    const ALLOWS_NOTHING: bool = false;

    fn as_str(self) -> &'static str {
        "default"
    }
}

/// The pointer file.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DataFolderList {
    #[serde(default, skip_serializing_if = "DeviceGroups::is_empty")]
    pub devices: DeviceGroups<DataFolderChoice>,
    /// The OS name of each device with a group here.
    #[serde(default, skip_serializing_if = "OsNames::is_empty")]
    pub os_names: OsNames,
}

impl DataFolderList {
    /// The names the file keeps: a line only for a device with a group, and
    /// this device's own as its OS gives it now (the one written before when
    /// it gives none).
    fn settle_os_names(&mut self, device: &ThisDevice, name: Option<&str>) {
        let groups = &self.devices;
        self.os_names
            .retain_devices(|id| groups.group(id).is_some());
        if groups.here(device).is_some() {
            self.os_names.note_here(device, name);
        }
    }
}

/// A choice of the list on this device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataFolderPlace {
    Default,
    Row(Row),
}

impl DataFolderPlace {
    /// The choice as the UI names it.
    pub fn choice_name(&self) -> ChoiceName {
        match self {
            Self::Default => ChoiceName::Fixed {
                choice: DataFolderChoice::Default.as_str(),
            },
            Self::Row(row) => ChoiceName::Row {
                number: row.number,
                name: row.name.clone(),
            },
        }
    }
}

/// What this device's selection names. A list read from its file always
/// names a row it holds or Default ([`DeviceGroups::check`]).
pub fn selected_place(list: &DataFolderList, device: &ThisDevice) -> DataFolderPlace {
    match list.devices.selection_here(device) {
        Selection::Row(number) => list
            .devices
            .row_here(device, number)
            .cloned()
            .map_or(DataFolderPlace::Default, DataFolderPlace::Row),
        Selection::Fixed(DataFolderChoice::Default) | Selection::Nothing => {
            DataFolderPlace::Default
        }
    }
}

/// The order a search tries: this device's rows, then Default.
pub fn chain(list: &DataFolderList, device: &ThisDevice) -> Vec<DataFolderPlace> {
    list.devices
        .rows_here(device)
        .iter()
        .cloned()
        .map(DataFolderPlace::Row)
        .chain(std::iter::once(DataFolderPlace::Default))
        .collect()
}

/// The selection taking `place` means.
pub fn selection_of(place: &DataFolderPlace) -> Selection<DataFolderChoice> {
    match place {
        DataFolderPlace::Default => Selection::Fixed(DataFolderChoice::Default),
        DataFolderPlace::Row(row) => Selection::Row(row.number),
    }
}

pub fn list_path(home: &Path) -> PathBuf {
    home.join(DATA_FOLDER_LIST_FILE)
}

/// Read the list. No file is the empty list; a file that cannot be read as
/// one is [`UprivError::DataFolderListInvalid`].
pub fn load_data_folder_list(home: &Path) -> Result<DataFolderList> {
    let path = list_path(home);
    let raw = match crate::host_fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DataFolderList::default())
        }
        Err(error) => return Err(error.into()),
    };
    let mut list: DataFolderList =
        toml::from_str(&raw).map_err(|error| UprivError::DataFolderListInvalid {
            detail: error.to_string(),
        })?;
    list.devices
        .check()
        .map_err(|detail| UprivError::DataFolderListInvalid { detail })?;
    Ok(list)
}

/// Write the list atomically, with the OS names settled; an empty list
/// removes the file. Upriv runs one instance per machine, so it is the only
/// writer.
pub fn save_data_folder_list(home: &Path, list: &DataFolderList) -> Result<()> {
    let path = list_path(home);
    let mut list = list.clone();
    list.settle_os_names(this_device(), this_os_name());
    if list.devices.is_empty() {
        return match crate::host_fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        };
    }
    let body =
        toml::to_string_pretty(&list).map_err(|error| UprivError::DataFolderListInvalid {
            detail: error.to_string(),
        })?;
    crate::paths::write_bytes_atomic(&path, format!("{HEADER}{body}").as_bytes())
}

/// Note this device's OS name in the list at `home`, under the list's lock,
/// when the list holds this device's group and its line says something else.
pub fn note_os_name_in_list(home: &Path) -> Result<()> {
    let _lock = lock_data_folder_list();
    let list = load_data_folder_list(home)?;
    let mut settled = list.clone();
    settled.settle_os_names(this_device(), this_os_name());
    if settled == list {
        return Ok(());
    }
    save_data_folder_list(home, &settled)
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

    #[test]
    fn a_device_with_no_group_uses_default() {
        let here = device(b"desk");
        let list = DataFolderList::default();
        assert_eq!(selected_place(&list, &here), DataFolderPlace::Default);
        assert_eq!(chain(&list, &here), vec![DataFolderPlace::Default]);
    }

    #[test]
    fn the_file_round_trips_and_goes_when_empty() {
        let home = tempfile::tempdir().unwrap();
        let here = device(b"desk");
        let mut list = DataFolderList::default();
        list.devices.0.insert(
            here.id.clone().unwrap(),
            DeviceGroup {
                rows: vec![row(1, "/media/usb")],
                selected: Selection::Row(1),
                next_number: 2,
                ..DeviceGroup::for_device(&here)
            },
        );
        save_data_folder_list(home.path(), &list).unwrap();
        let raw = std::fs::read_to_string(list_path(home.path())).unwrap();
        assert!(raw.starts_with("# Upriv data folder list."));
        assert_eq!(load_data_folder_list(home.path()).unwrap(), list);
        assert_eq!(
            selected_place(&list, &here),
            DataFolderPlace::Row(row(1, "/media/usb"))
        );

        save_data_folder_list(home.path(), &DataFolderList::default()).unwrap();
        assert!(!list_path(home.path()).exists());
        assert_eq!(
            load_data_folder_list(home.path()).unwrap(),
            DataFolderList::default()
        );
    }

    #[test]
    fn the_list_keeps_the_os_names_of_devices_with_a_group() {
        let home = tempfile::tempdir().unwrap();
        let laptop = device(b"laptop");
        let phone = device(b"phone");
        let mut list = DataFolderList::default();
        list.devices.0.insert(
            laptop.id.clone().unwrap(),
            DeviceGroup {
                rows: vec![row(1, "/media/usb")],
                selected: Selection::Row(1),
                next_number: 2,
                ..DeviceGroup::for_device(&laptop)
            },
        );
        list.os_names.note_here(&laptop, Some("Fedora Linux 41"));
        list.os_names.note_here(&phone, Some("Android 15 (Xiaomi)"));
        save_data_folder_list(home.path(), &list).unwrap();
        let saved = load_data_folder_list(home.path()).unwrap();
        assert_eq!(
            saved.os_names.get(laptop.id.as_ref().unwrap()),
            Some("Fedora Linux 41")
        );
        // A device with no group here is named nowhere in the list.
        assert_eq!(saved.os_names.get(phone.id.as_ref().unwrap()), None);

        // This device notes its name once the list holds its group.
        let here = this_device();
        let Some(id) = here.id.clone() else {
            return;
        };
        let mut with_here = saved.clone();
        with_here.devices.0.insert(
            id.clone(),
            DeviceGroup {
                rows: vec![row(1, "/mnt/data")],
                selected: Selection::Row(1),
                next_number: 2,
                ..DeviceGroup::for_device(here)
            },
        );
        std::fs::write(
            list_path(home.path()),
            toml::to_string_pretty(&with_here).unwrap(),
        )
        .unwrap();
        note_os_name_in_list(home.path()).unwrap();
        let noted = load_data_folder_list(home.path()).unwrap();
        assert_eq!(noted.os_names.get(&id), this_os_name());
        assert_eq!(
            noted.os_names.get(laptop.id.as_ref().unwrap()),
            Some("Fedora Linux 41")
        );
    }

    #[test]
    fn the_list_always_has_a_choice() {
        let home = tempfile::tempdir().unwrap();
        let here = device(b"desk");
        let id = here.id.clone().unwrap();
        std::fs::write(
            list_path(home.path()),
            format!(
                "[devices.{}]\nsystem = \"linux\"\nselected = \"none\"\n",
                id.as_str()
            ),
        )
        .unwrap();
        assert!(matches!(
            load_data_folder_list(home.path()),
            Err(UprivError::DataFolderListInvalid { .. })
        ));
    }

    #[test]
    fn a_place_names_itself_as_the_ui_shows_it() {
        assert_eq!(
            DataFolderPlace::Default.choice_name(),
            ChoiceName::Fixed { choice: "default" }
        );
        let mut usb = row(2, "/media/usb");
        usb.name = "USB".into();
        assert_eq!(
            DataFolderPlace::Row(usb).choice_name(),
            ChoiceName::Row {
                number: 2,
                name: "USB".into()
            }
        );
    }

    #[test]
    fn a_file_that_is_not_a_list_is_invalid() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(list_path(home.path()), "not a list").unwrap();
        assert!(matches!(
            load_data_folder_list(home.path()),
            Err(UprivError::DataFolderListInvalid { .. })
        ));
    }
}
