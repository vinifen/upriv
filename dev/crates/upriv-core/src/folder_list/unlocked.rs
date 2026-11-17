//! The unlocked folder lists: the app's (`[unlocked_folders]` in
//! `settings.toml`) and each vault's (`[unlocked_folder]` in its
//! `config.toml`), the folder each vault gets on this device, and the
//! `upriv-unlocked` folder Upriv makes inside a row.
//!
//! A vault's unlocked folder is `{row}/upriv-unlocked/{vault name}`, or
//! `{data folder}/upriv-unlocked/{vault name}` for Beside the data folder.
//! Each `upriv-unlocked` holds a folder ID file, written the first time Upriv
//! uses it and never rewritten: it proves that a plain-text record's folder
//! is the same folder on the same drive.

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::chain::{ChoiceName, Level, ListName, Switch};
use super::model::{DeviceGroups, FixedChoice, Row, Selection};
use super::path_rules::{ListKind, UNLOCKED_CONTAINER};
use crate::device::ThisDevice;
use crate::error::{Result, UprivError};
use crate::folder_probe::FolderState;

/// The folder ID file inside each `upriv-unlocked`.
pub const UNLOCKED_ID_FILE: &str = ".upriv-unlocked-id";
/// Hex characters of a folder ID: 16 random bytes.
const UNLOCKED_ID_LEN: usize = 32;

/// The app list's fixed choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppUnlockedChoice {
    /// `{data folder}/upriv-unlocked`.
    Beside,
}

impl FixedChoice for AppUnlockedChoice {
    const LIST: ListKind = ListKind::Unlocked;
    const ALL: &'static [Self] = &[Self::Beside];
    const DEFAULT: Selection<Self> = Selection::Nothing;
    const ALLOWS_NOTHING: bool = true;

    fn as_str(self) -> &'static str {
        "beside"
    }
}

/// A vault list's fixed choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultUnlockedChoice {
    /// Use the app's.
    Inherit,
}

impl FixedChoice for VaultUnlockedChoice {
    const LIST: ListKind = ListKind::Unlocked;
    const ALL: &'static [Self] = &[Self::Inherit];
    const DEFAULT: Selection<Self> = Selection::Fixed(Self::Inherit);
    const ALLOWS_NOTHING: bool = false;

    fn as_str(self) -> &'static str {
        "inherit"
    }
}

/// `[unlocked_folder] encrypted`: whether this encrypted vault gets an
/// unlocked folder, on every device and whichever choice is in use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncryptedSwitch {
    /// Follow `[unlocked_folders] encrypted_vaults`.
    #[default]
    Inherit,
    On,
    Off,
}

/// `[unlocked_folders]` in `settings.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppUnlockedFolders {
    /// Encrypted vaults get an unlocked folder, on every device.
    #[serde(default)]
    pub encrypted_vaults: bool,
    #[serde(default, skip_serializing_if = "DeviceGroups::is_empty")]
    pub devices: DeviceGroups<AppUnlockedChoice>,
}

/// `[unlocked_folder]` in a vault's `config.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultUnlockedFolder {
    #[serde(default)]
    pub encrypted: EncryptedSwitch,
    #[serde(default, skip_serializing_if = "DeviceGroups::is_empty")]
    pub devices: DeviceGroups<VaultUnlockedChoice>,
}

/// Whether an encrypted vault gets an unlocked folder.
pub fn encrypted_folder_on(app: &AppUnlockedFolders, vault: &VaultUnlockedFolder) -> bool {
    match vault.encrypted {
        EncryptedSwitch::On => true,
        EncryptedSwitch::Off => false,
        EncryptedSwitch::Inherit => app.encrypted_vaults,
    }
}

/// Where a vault's unlocked folder is on this device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnlockedPlace {
    /// Beside the data folder.
    Beside,
    AppRow(Row),
    VaultRow(Row),
}

impl UnlockedPlace {
    /// `upriv-unlocked` in the place's folder, or the row itself when it
    /// already is one.
    pub fn container(&self, data_folder: &Path) -> PathBuf {
        let base = match self {
            Self::Beside => return data_folder.join(UNLOCKED_CONTAINER),
            Self::AppRow(row) | Self::VaultRow(row) => super::row_folder(&row.path),
        };
        if super::names_folder(&base, UNLOCKED_CONTAINER) {
            base
        } else {
            base.join(UNLOCKED_CONTAINER)
        }
    }

    /// The folder `container` sits in: it must exist, since a drive that is
    /// not there is never made.
    pub fn base(&self, data_folder: &Path) -> PathBuf {
        let container = self.container(data_folder);
        container
            .parent()
            .map_or_else(|| container.clone(), Path::to_path_buf)
    }

    /// `{container}/{vault name}`.
    pub fn vault_folder(&self, data_folder: &Path, display_name: &str) -> PathBuf {
        self.container(data_folder)
            .join(crate::paths::sanitize_display_leaf(display_name))
    }

    /// The row's path as its list stores it, for checking it against the rules.
    pub fn row_path(&self) -> Option<&str> {
        match self {
            Self::Beside => None,
            Self::AppRow(row) | Self::VaultRow(row) => Some(row.path.as_str()),
        }
    }

    pub fn in_data_folder(&self) -> bool {
        matches!(self, Self::Beside)
    }
}

fn app_selected(app: &AppUnlockedFolders, device: &ThisDevice) -> Option<UnlockedPlace> {
    match app.devices.selection_here(device) {
        Selection::Row(number) => app
            .devices
            .row_here(device, number)
            .cloned()
            .map(UnlockedPlace::AppRow),
        Selection::Fixed(AppUnlockedChoice::Beside) => Some(UnlockedPlace::Beside),
        Selection::Nothing => None,
    }
}

/// The unlocked folder this device's selection names for a vault, or `None`
/// when nothing is selected.
pub fn selected_place(
    app: &AppUnlockedFolders,
    vault: &VaultUnlockedFolder,
    device: &ThisDevice,
) -> Option<UnlockedPlace> {
    match vault.devices.selection_here(device) {
        Selection::Row(number) => vault
            .devices
            .row_here(device, number)
            .cloned()
            .map(UnlockedPlace::VaultRow),
        Selection::Fixed(VaultUnlockedChoice::Inherit) | Selection::Nothing => {
            app_selected(app, device)
        }
    }
}

/// The order failover tries for a vault: its own rows, then the app's
/// selection, then the app's rows. Beside the data folder is in it only as
/// the app's selection: failover never picks it for the app.
pub fn chain(
    app: &AppUnlockedFolders,
    vault: &VaultUnlockedFolder,
    device: &ThisDevice,
) -> Vec<UnlockedPlace> {
    let mut chain: Vec<UnlockedPlace> = vault
        .devices
        .rows_here(device)
        .iter()
        .cloned()
        .map(UnlockedPlace::VaultRow)
        .collect();
    chain.extend(app_selected(app, device));
    for row in app.devices.rows_here(device) {
        let place = UnlockedPlace::AppRow(row.clone());
        if !chain.contains(&place) {
            chain.push(place);
        }
    }
    chain
}

/// The selections that taking `place` changes on this device: the vault's
/// whenever it differs, and the app's when `place` is another app row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UnlockedSelections {
    pub vault: Option<Selection<VaultUnlockedChoice>>,
    pub app: Option<Selection<AppUnlockedChoice>>,
}

pub fn selections_taking(
    app: &AppUnlockedFolders,
    vault: &VaultUnlockedFolder,
    device: &ThisDevice,
    place: &UnlockedPlace,
) -> UnlockedSelections {
    let (vault_to, app_to) = match place {
        UnlockedPlace::VaultRow(row) => (Selection::Row(row.number), None),
        UnlockedPlace::AppRow(row) => (
            Selection::Fixed(VaultUnlockedChoice::Inherit),
            Some(Selection::Row(row.number)),
        ),
        UnlockedPlace::Beside => (Selection::Fixed(VaultUnlockedChoice::Inherit), None),
    };
    UnlockedSelections {
        vault: (vault.devices.selection_here(device) != vault_to).then_some(vault_to),
        app: app_to.filter(|to| app.devices.selection_here(device) != *to),
    }
}

/// The switches `taking` records, named from the lists as they were.
pub fn switches(
    app: &AppUnlockedFolders,
    vault: &VaultUnlockedFolder,
    device: &ThisDevice,
    vault_id: &str,
    taking: UnlockedSelections,
    reason: FolderState,
) -> Vec<Switch> {
    let mut out = Vec::new();
    if let Some(to) = taking.vault {
        out.push(Switch {
            list: ListName::UnlockedFolder,
            level: Level::Vault,
            vault: Some(vault_id.to_string()),
            from: vault
                .devices
                .choice_name(device, vault.devices.selection_here(device)),
            to: vault.devices.choice_name(device, to),
            reason,
            saved: false,
        });
    }
    if let Some(to) = taking.app {
        out.push(Switch {
            list: ListName::UnlockedFolder,
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

/// What a vault's own unlocked folder settings name as its folder on this
/// device, for the Info window: `Inherit` follows the app's.
pub fn vault_choice_name(vault: &VaultUnlockedFolder, device: &ThisDevice) -> ChoiceName {
    vault
        .devices
        .choice_name(device, vault.devices.selection_here(device))
}

/// The folders a fixed choice of the app list names here: a row may not
/// repeat Beside the data folder.
pub fn app_fixed_folders(data_folder: &Path) -> Vec<String> {
    [
        data_folder.to_path_buf(),
        data_folder.join(UNLOCKED_CONTAINER),
    ]
    .iter()
    .map(|path| path.to_string_lossy().into_owned())
    .collect()
}

/// Make `container` when it is missing, with its folder ID file, and return
/// that ID. The folder that holds it must exist: a drive that is not there
/// is never made. An ID already there is never rewritten. A file that holds
/// no ID (a crash between its creation and its write) is replaced: no record
/// can name it, so a new ID breaks no proof.
pub fn ensure_container(container: &Path) -> Result<String> {
    let Some(base) = container.parent() else {
        return Err(UprivError::UnlockedFolderUnavailable(
            container.to_path_buf(),
        ));
    };
    if !base.host_is_dir() {
        return Err(
            std::io::Error::new(ErrorKind::NotFound, "the folder of the row is not there").into(),
        );
    }
    match crate::host_fs::create_dir(container) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::AlreadyExists && container.host_is_dir() => {}
        Err(error) => return Err(error.into()),
    }
    match container_id(container) {
        Ok(Some(id)) => return Ok(id),
        Ok(None) => {}
        Err(UprivError::Io(error)) if error.kind() == ErrorKind::InvalidData => {
            crate::host_fs::remove_file(container.join(UNLOCKED_ID_FILE))?;
        }
        Err(error) => return Err(error),
    }
    let id = format!("{:032x}", rand::random::<u128>());
    match write_new(&container.join(UNLOCKED_ID_FILE), id.as_bytes()) {
        Ok(()) => Ok(id),
        // Another writer made it first: that ID stands.
        Err(error) if error.kind() == ErrorKind::AlreadyExists => container_id(container)?
            .ok_or_else(|| std::io::Error::from(ErrorKind::InvalidData).into()),
        Err(error) => Err(error.into()),
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = crate::host_fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    match file.sync_all() {
        Err(error) if !crate::folder_probe::flush_is_unsupported(&error) => Err(error),
        _ => Ok(()),
    }
}

/// The ID in `container`'s folder ID file: `Ok(None)` when the folder
/// answers and holds none. An ID file Upriv did not write is an error, so it
/// never proves anything.
pub fn container_id(container: &Path) -> Result<Option<String>> {
    let mut file = match crate::host_fs::File::open(container.join(UNLOCKED_ID_FILE)) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound && container.host_is_dir() => {
            return Ok(None)
        }
        Err(error) => return Err(error.into()),
    };
    let mut text = String::new();
    Read::by_ref(&mut file)
        .take(UNLOCKED_ID_LEN as u64 + 2)
        .read_to_string(&mut text)?;
    let id = text.trim();
    let valid = id.len() == UNLOCKED_ID_LEN
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if !valid {
        return Err(
            std::io::Error::new(ErrorKind::InvalidData, "folder ID file is not Upriv's").into(),
        );
    }
    Ok(Some(id.to_string()))
}

/// Remove `container` when it holds nothing but its folder ID file. True
/// when it is gone afterwards. When something came in meanwhile and the
/// folder stays, its ID goes back, so the records naming it still prove.
pub fn remove_container_if_empty(container: &Path) -> bool {
    let Ok(entries) = crate::host_fs::read_dir(container) else {
        return !container.host_exists();
    };
    let mut only_id = true;
    for entry in entries {
        match entry {
            Ok(entry) if entry.file_name() == UNLOCKED_ID_FILE => {}
            _ => {
                only_id = false;
                break;
            }
        }
    }
    if !only_id {
        return false;
    }
    let id = container_id(container).ok().flatten();
    let _ = crate::host_fs::remove_file(container.join(UNLOCKED_ID_FILE));
    if crate::host_fs::remove_dir(container).is_ok() {
        return true;
    }
    if let Some(id) = id {
        let _ = write_new(&container.join(UNLOCKED_ID_FILE), id.as_bytes());
    }
    false
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
        selected: Selection<AppUnlockedChoice>,
    ) -> AppUnlockedFolders {
        let mut app = AppUnlockedFolders::default();
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
        selected: Selection<VaultUnlockedChoice>,
    ) -> VaultUnlockedFolder {
        let mut vault = VaultUnlockedFolder::default();
        vault.devices.0.insert(
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
    fn a_device_with_no_group_has_nothing_selected() {
        let here = device(b"desk");
        let app = AppUnlockedFolders::default();
        let vault = VaultUnlockedFolder::default();
        assert_eq!(selected_place(&app, &vault, &here), None);
        assert!(chain(&app, &vault, &here).is_empty());
    }

    #[test]
    fn a_vault_that_uses_the_apps_follows_the_app_selection() {
        let here = device(b"desk");
        let app = app_with(
            &here,
            vec![row(1, "/mnt/a")],
            Selection::Fixed(AppUnlockedChoice::Beside),
        );
        let vault = VaultUnlockedFolder::default();
        assert_eq!(
            selected_place(&app, &vault, &here),
            Some(UnlockedPlace::Beside)
        );
        let app = app_with(&here, vec![row(1, "/mnt/a")], Selection::Row(1));
        assert_eq!(
            selected_place(&app, &vault, &here),
            Some(UnlockedPlace::AppRow(row(1, "/mnt/a")))
        );
    }

    #[test]
    fn the_chain_is_vault_rows_then_the_app_selection_then_app_rows() {
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
                UnlockedPlace::VaultRow(row(1, "/mnt/v")),
                UnlockedPlace::AppRow(row(2, "/mnt/b")),
                UnlockedPlace::AppRow(row(1, "/mnt/a")),
            ]
        );
    }

    #[test]
    fn failover_never_picks_beside_for_the_app() {
        let here = device(b"desk");
        let app = app_with(&here, vec![row(1, "/mnt/a")], Selection::Row(1));
        let vault = VaultUnlockedFolder::default();
        assert!(!chain(&app, &vault, &here).contains(&UnlockedPlace::Beside));
    }

    #[test]
    fn taking_an_app_row_sets_the_vault_to_the_apps_and_moves_the_app() {
        let here = device(b"desk");
        let app = app_with(
            &here,
            vec![row(1, "/mnt/a"), row(2, "/mnt/b")],
            Selection::Row(1),
        );
        let vault = vault_with(&here, vec![row(1, "/mnt/v")], Selection::Row(1));
        let taking = selections_taking(
            &app,
            &vault,
            &here,
            &UnlockedPlace::AppRow(row(2, "/mnt/b")),
        );
        assert_eq!(
            taking,
            UnlockedSelections {
                vault: Some(Selection::Fixed(VaultUnlockedChoice::Inherit)),
                app: Some(Selection::Row(2)),
            }
        );
        let switched = switches(&app, &vault, &here, "notes", taking, FolderState::Missing);
        assert_eq!(switched.len(), 2);
        assert_eq!(switched[0].level, Level::Vault);
        assert_eq!(
            switched[1].to,
            ChoiceName::Row {
                number: 2,
                name: String::new()
            }
        );

        let same = selections_taking(
            &app,
            &vault,
            &here,
            &UnlockedPlace::VaultRow(row(1, "/mnt/v")),
        );
        assert_eq!(same, UnlockedSelections::default());
    }

    #[test]
    fn the_encrypted_switch_follows_the_app_unless_the_vault_sets_it() {
        let mut app = AppUnlockedFolders::default();
        let mut vault = VaultUnlockedFolder::default();
        assert!(!encrypted_folder_on(&app, &vault));
        app.encrypted_vaults = true;
        assert!(encrypted_folder_on(&app, &vault));
        vault.encrypted = EncryptedSwitch::Off;
        assert!(!encrypted_folder_on(&app, &vault));
        app.encrypted_vaults = false;
        vault.encrypted = EncryptedSwitch::On;
        assert!(encrypted_folder_on(&app, &vault));
    }

    #[test]
    fn the_folder_of_a_vault_is_inside_upriv_unlocked() {
        let data = Path::new("/data");
        assert_eq!(
            UnlockedPlace::Beside.vault_folder(data, "My Notes"),
            PathBuf::from("/data/upriv-unlocked/My Notes")
        );
        assert_eq!(
            UnlockedPlace::AppRow(row(1, "/mnt/ssd")).vault_folder(data, "Notes"),
            PathBuf::from("/mnt/ssd/upriv-unlocked/Notes")
        );
        assert_eq!(
            UnlockedPlace::VaultRow(row(1, "/mnt/ssd/upriv-unlocked")).vault_folder(data, "Notes"),
            PathBuf::from("/mnt/ssd/upriv-unlocked/Notes")
        );
        assert_eq!(
            UnlockedPlace::AppRow(row(1, "/mnt/ssd")).base(data),
            PathBuf::from("/mnt/ssd")
        );
    }

    #[test]
    fn the_lists_round_trip_and_leave_defaults_out() {
        let here = device(b"desk");
        let app = app_with(&here, vec![row(1, "/mnt/a")], Selection::Row(1));
        let text = toml::to_string(&app).unwrap();
        let back: AppUnlockedFolders = toml::from_str(&text).unwrap();
        assert_eq!(back, app);
        let empty = toml::to_string(&VaultUnlockedFolder::default()).unwrap();
        assert_eq!(empty.trim(), "encrypted = \"inherit\"");
        assert!(
            toml::from_str::<VaultUnlockedFolder>("encrypted = \"inherit\"\nshortcut = true")
                .is_err()
        );
    }

    #[test]
    fn a_container_is_made_once_with_an_id_that_is_never_rewritten() {
        let tmp = tempfile::tempdir().unwrap();
        let container = tmp.path().join(UNLOCKED_CONTAINER);
        let id = ensure_container(&container).unwrap();
        assert_eq!(id.len(), UNLOCKED_ID_LEN);
        assert_eq!(ensure_container(&container).unwrap(), id);
        assert_eq!(container_id(&container).unwrap(), Some(id));

        let unplugged = tmp.path().join("gone").join(UNLOCKED_CONTAINER);
        assert!(ensure_container(&unplugged).is_err());
        assert!(!tmp.path().join("gone").exists());
    }

    #[test]
    fn a_container_goes_only_when_it_holds_nothing_but_its_id() {
        let tmp = tempfile::tempdir().unwrap();
        let container = tmp.path().join(UNLOCKED_CONTAINER);
        ensure_container(&container).unwrap();
        std::fs::create_dir(container.join("Notes")).unwrap();
        assert!(!remove_container_if_empty(&container));
        assert!(container.join(UNLOCKED_ID_FILE).exists());
        std::fs::remove_dir(container.join("Notes")).unwrap();
        assert!(remove_container_if_empty(&container));
        assert!(!container.exists());
        assert!(tmp.path().exists());
    }

    #[test]
    fn a_file_that_holds_no_id_is_replaced_by_a_new_id() {
        let tmp = tempfile::tempdir().unwrap();
        let container = tmp.path().join(UNLOCKED_CONTAINER);
        std::fs::create_dir(&container).unwrap();
        // A crash between the file's creation and its write.
        std::fs::write(container.join(UNLOCKED_ID_FILE), b"").unwrap();
        let id = ensure_container(&container).unwrap();
        assert_eq!(id.len(), UNLOCKED_ID_LEN);
        assert_eq!(container_id(&container).unwrap(), Some(id.clone()));
        assert_eq!(ensure_container(&container).unwrap(), id);
    }

    #[cfg(unix)]
    #[test]
    fn a_container_that_cannot_go_keeps_its_id() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join("row");
        std::fs::create_dir(&base).unwrap();
        let container = base.join(UNLOCKED_CONTAINER);
        let id = ensure_container(&container).unwrap();
        // The row folder takes no change: the container's own entry stays.
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o555)).unwrap();
        let removed = remove_container_if_empty(&container);
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o755)).unwrap();
        if removed {
            // Permissions do not bind this user (root): nothing to show here.
            return;
        }
        assert_eq!(container_id(&container).unwrap(), Some(id));
    }

    #[test]
    fn an_id_file_upriv_did_not_write_proves_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let container = tmp.path().join(UNLOCKED_CONTAINER);
        std::fs::create_dir(&container).unwrap();
        assert_eq!(container_id(&container).unwrap(), None);
        std::fs::write(container.join(UNLOCKED_ID_FILE), b"not an id").unwrap();
        assert!(container_id(&container).is_err());
        assert!(container_id(&tmp.path().join("gone")).is_err());
    }
}
