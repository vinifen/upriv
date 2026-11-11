//! Where a vault's backups go.
//!
//! `[backups.<os>]` in `settings.toml` is the app default. `[backup.<os>]` in a
//! vault's `config.toml` follows it, picks the data folder, or names a folder
//! of its own. Each desktop system keeps its own row, because both files travel
//! with the data folder. Phones have no row: their backups stay in the data
//! folder.
//!
//! A row keeps its `path` while `place` points elsewhere, so going back to
//! `custom` restores it. A `custom` row with an empty path is the data folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::workspace::{validate_workspace_global_path, WorkspaceSystem};
use crate::error::Result;

/// The folder Upriv makes inside an app-default backup folder. Each vault has
/// one folder in it.
pub const SHARED_BACKUPS_FOLDER: &str = "upriv-backups";

/// `[backups.<os>] place`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupPlace {
    #[default]
    DataFolder,
    Custom,
}

/// `[backup.<os>] place`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultBackupPlace {
    #[default]
    Inherit,
    DataFolder,
    Custom,
}

/// One system's app default.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupFolderRow {
    #[serde(default)]
    pub place: BackupPlace,
    #[serde(default)]
    pub path: String,
}

/// One system's choice for a vault.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultBackupFolderRow {
    #[serde(default)]
    pub place: VaultBackupPlace,
    #[serde(default)]
    pub path: String,
}

/// App `[backups]` table.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupFolderTable {
    #[serde(default)]
    pub linux: BackupFolderRow,
    #[serde(default)]
    pub windows: BackupFolderRow,
    #[serde(default)]
    pub macos: BackupFolderRow,
}

impl BackupFolderTable {
    /// This system's row. Phones have none.
    pub fn row(&self, system: WorkspaceSystem) -> Option<&BackupFolderRow> {
        match system {
            WorkspaceSystem::Linux => Some(&self.linux),
            WorkspaceSystem::Windows => Some(&self.windows),
            WorkspaceSystem::Macos => Some(&self.macos),
            WorkspaceSystem::Android | WorkspaceSystem::Ios => None,
        }
    }

    /// Check every `custom` row. A kept path on another `place` is not in use.
    pub fn validate(&self, vault_root: Option<&Path>) -> Result<()> {
        for row in [&self.linux, &self.windows, &self.macos] {
            if row.place == BackupPlace::Custom {
                validate_workspace_global_path(&row.path, vault_root)?;
            }
        }
        Ok(())
    }
}

/// A chosen backup folder, resolved for one vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChosenBackupFolder {
    /// The folder the person chose.
    pub chosen: PathBuf,
    /// Upriv's folder inside it, which holds the zips and `saves/`.
    pub dir: PathBuf,
}

/// The typed path without a trailing separator. Its components keep a root,
/// so a drive root such as `D:\` stays a root rather than turning into `D:`,
/// which names the current folder of that drive.
fn usable_path(path: &str) -> Option<PathBuf> {
    let path: PathBuf = Path::new(path.trim()).components().collect();
    (!path.as_os_str().is_empty()).then_some(path)
}

fn ends_with_folder(path: &Path, name: &str) -> bool {
    path.file_name()
        .is_some_and(|last| last.eq_ignore_ascii_case(name))
}

/// `{chosen}/upriv-backups`, or `chosen` when it already is that folder.
pub fn shared_backups_folder(chosen: &Path) -> PathBuf {
    if ends_with_folder(chosen, SHARED_BACKUPS_FOLDER) {
        chosen.to_path_buf()
    } else {
        chosen.join(SHARED_BACKUPS_FOLDER)
    }
}

/// `{chosen}/upriv-<folder id>-backups`, or `chosen` when it already is that folder.
pub fn own_backups_folder(chosen: &Path, folder_id: &str) -> PathBuf {
    let name = format!("upriv-{folder_id}-backups");
    if ends_with_folder(chosen, &name) {
        chosen.to_path_buf()
    } else {
        chosen.join(name)
    }
}

/// Where this vault's backups go on a system with these rows. `None` is the
/// data folder. `folder_id` names the vault's folder there.
pub fn resolve_chosen_backup_folder(
    app: Option<&BackupFolderRow>,
    vault: Option<&VaultBackupFolderRow>,
    folder_id: &str,
) -> Option<ChosenBackupFolder> {
    let vault = vault?;
    match vault.place {
        VaultBackupPlace::DataFolder => None,
        VaultBackupPlace::Custom => {
            let chosen = usable_path(&vault.path)?;
            let dir = own_backups_folder(&chosen, folder_id);
            Some(ChosenBackupFolder { chosen, dir })
        }
        VaultBackupPlace::Inherit => {
            let app = app.filter(|app| app.place == BackupPlace::Custom)?;
            let chosen = usable_path(&app.path)?;
            let dir = shared_backups_folder(&chosen).join(folder_id);
            Some(ChosenBackupFolder { chosen, dir })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(place: BackupPlace, path: &str) -> BackupFolderRow {
        BackupFolderRow {
            place,
            path: path.into(),
        }
    }

    fn vault(place: VaultBackupPlace, path: &str) -> VaultBackupFolderRow {
        VaultBackupFolderRow {
            place,
            path: path.into(),
        }
    }

    fn resolved(
        app_row: &BackupFolderRow,
        vault_row: &VaultBackupFolderRow,
    ) -> Option<ChosenBackupFolder> {
        resolve_chosen_backup_folder(Some(app_row), Some(vault_row), "notes")
    }

    #[test]
    fn a_vault_folder_of_its_own_wins_over_the_app_default() {
        let found = resolved(
            &app(BackupPlace::Custom, "/mnt/app"),
            &vault(VaultBackupPlace::Custom, "/mnt/own"),
        )
        .unwrap();
        assert_eq!(found.chosen, PathBuf::from("/mnt/own"));
        assert_eq!(found.dir, PathBuf::from("/mnt/own/upriv-notes-backups"));
    }

    #[test]
    fn a_vault_that_inherits_follows_a_custom_app_default() {
        let found = resolved(
            &app(BackupPlace::Custom, "/mnt/app/"),
            &vault(VaultBackupPlace::Inherit, ""),
        )
        .unwrap();
        assert_eq!(found.chosen, PathBuf::from("/mnt/app"));
        assert_eq!(found.dir, PathBuf::from("/mnt/app/upriv-backups/notes"));
    }

    #[test]
    fn a_root_stays_a_root() {
        let found = resolved(
            &app(BackupPlace::DataFolder, ""),
            &vault(VaultBackupPlace::Custom, "/"),
        )
        .unwrap();
        assert_eq!(found.chosen, PathBuf::from("/"));
        assert_eq!(found.dir, PathBuf::from("/upriv-notes-backups"));
    }

    #[test]
    fn the_data_folder_is_no_chosen_folder() {
        let custom = app(BackupPlace::Custom, "/mnt/app");
        let data = app(BackupPlace::DataFolder, "/mnt/kept");
        assert!(resolved(&data, &vault(VaultBackupPlace::Inherit, "")).is_none());
        assert!(resolved(&custom, &vault(VaultBackupPlace::DataFolder, "/mnt/kept")).is_none());
    }

    #[test]
    fn custom_with_an_empty_path_is_the_data_folder() {
        let custom = app(BackupPlace::Custom, "  ");
        assert!(resolved(&custom, &vault(VaultBackupPlace::Inherit, "")).is_none());
        assert!(resolved(&custom, &vault(VaultBackupPlace::Custom, " ")).is_none());
    }

    #[test]
    fn a_path_that_already_is_the_folder_is_not_nested() {
        let found = resolved(
            &app(BackupPlace::Custom, "/mnt/app/upriv-backups"),
            &vault(VaultBackupPlace::Inherit, ""),
        )
        .unwrap();
        assert_eq!(found.dir, PathBuf::from("/mnt/app/upriv-backups/notes"));

        let own = resolved(
            &app(BackupPlace::DataFolder, ""),
            &vault(VaultBackupPlace::Custom, "/mnt/upriv-notes-backups"),
        )
        .unwrap();
        assert_eq!(own.dir, PathBuf::from("/mnt/upriv-notes-backups"));
    }

    #[test]
    fn phones_have_no_row() {
        let table = BackupFolderTable::default();
        assert!(table.row(WorkspaceSystem::Android).is_none());
        assert!(table.row(WorkspaceSystem::Ios).is_none());
        assert!(table.row(WorkspaceSystem::Linux).is_some());
        assert!(resolve_chosen_backup_folder(None, None, "notes").is_none());
    }

    #[test]
    fn only_a_custom_row_is_validated() {
        let mut table = BackupFolderTable::default();
        table.linux.path = "relative/kept".into();
        table.validate(None).unwrap();
        table.linux.place = BackupPlace::Custom;
        assert!(table.validate(None).is_err());
        table.linux.path = "/home/me/.upriv/backups".into();
        assert!(table.validate(None).is_err());
        table.linux.path = "/mnt/drive".into();
        table.validate(None).unwrap();
    }

    #[test]
    fn a_missing_table_reads_as_the_data_folder() {
        let table: BackupFolderTable = toml::from_str("").unwrap();
        assert_eq!(table.linux.place, BackupPlace::DataFolder);
        assert!(toml::from_str::<BackupFolderTable>("[linux]\nplaces = \"custom\"\n").is_err());
    }
}
