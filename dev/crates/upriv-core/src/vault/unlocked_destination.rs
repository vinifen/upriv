//! `vault_unlocked_destination`: where an unlock would put a vault's files on
//! this device, found before the password.
//!
//! It walks the unlocked folder chain the way the open walks it for plain
//! text, or the attach for an encrypted vault's mount, checks each place the
//! same way with nothing made, and saves nothing. The folder lists live in
//! files no vault key protects, so the folder is shown, not sealed: the
//! unlock window and the Storage screen name it before the password.

use serde::Serialize;

use crate::config::load_vault_config;
use crate::error::Result;
use crate::folder_list::Switch;
use crate::folder_probe::FolderState;
use crate::paths::VaultRoot;
use crate::store::VaultStorageMode;

use super::plain::PlainFolderClass;

/// Where an unlock would put the files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum UnlockedDestination {
    /// No folder is wanted: an encrypted vault whose unlocked folder is off,
    /// or a device that mounts none.
    Off,
    /// A folder is wanted and none is chosen on this device.
    Unset,
    /// The folder the walk lands on. `class` says where it physically is,
    /// for plain text, whose files are written there.
    Folder {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        class: Option<PlainFolderClass>,
        /// The selections the unlock would switch because the selected folder fails.
        switches: Vec<Switch>,
    },
    /// No choice of the chain answers. `path` and `reason` are the selected
    /// folder's.
    Unavailable { path: String, reason: FolderState },
}

/// Where an unlock of `vault_id` in `mode` would put its files. A leftover
/// plain-text folder, an unknown device for plain text, and a vault error are
/// the errors the open would answer.
pub fn unlocked_destination(
    root: &VaultRoot,
    vault_id: &str,
    mode: VaultStorageMode,
) -> Result<UnlockedDestination> {
    let config = load_vault_config(root.vault_dir(vault_id)?)?;
    match mode {
        VaultStorageMode::UprivPlain => super::plain::plain_destination(root, vault_id, &config),
        VaultStorageMode::EncryptedDir => {
            super::unlocked_folder::mount_destination(root, vault_id, &config)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder_list::unlocked::EncryptedSwitch;
    use crate::folder_list::UNLOCKED_CONTAINER;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::{quiet_config, unlocked_rows, vault_root_with};
    use crate::vault::create_vault;

    /// A closed vault `notes` whose unlocked folder row on this device is
    /// `<tmp>/places`, made with `edit` applied to its config.
    fn notes(
        edit: impl FnOnce(&mut crate::config::VaultConfig),
    ) -> (tempfile::TempDir, VaultRoot, std::path::PathBuf) {
        let (tmp, root) = vault_root_with(&[]);
        let places = tmp.path().join("places");
        crate::host_fs::create_dir_all(&places).unwrap();
        let mut config = quiet_config("notes", "Notes");
        unlocked_rows(&mut config, &[&places]);
        edit(&mut config);
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        (tmp, root, places)
    }

    fn folder_of(answer: UnlockedDestination) -> (String, Option<PlainFolderClass>) {
        match answer {
            UnlockedDestination::Folder { path, class, .. } => (path, class),
            other => panic!("a folder, not {other:?}"),
        }
    }

    #[test]
    fn the_plain_text_answer_is_the_folder_the_open_fills_and_nothing_is_made() {
        let (_tmp, root, places) = notes(|_| {});
        let (path, class) =
            folder_of(unlocked_destination(&root, "notes", VaultStorageMode::UprivPlain).unwrap());
        let folder = places.join(UNLOCKED_CONTAINER).join("Notes");
        assert_eq!(path, folder.display().to_string());
        assert!(class.is_some());
        assert!(!places.join(UNLOCKED_CONTAINER).exists());
    }

    #[test]
    fn an_encrypted_vault_with_its_folder_off_wants_none() {
        let (_tmp, root, _places) = notes(|config| {
            config.unlocked_folder.encrypted = EncryptedSwitch::Off;
        });
        assert_eq!(
            unlocked_destination(&root, "notes", VaultStorageMode::EncryptedDir).unwrap(),
            UnlockedDestination::Off
        );
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn an_encrypted_vault_with_its_folder_on_names_the_mount_point_and_makes_nothing() {
        let (_tmp, root, places) = notes(|config| {
            config.unlocked_folder.encrypted = EncryptedSwitch::On;
        });
        let (path, class) = folder_of(
            unlocked_destination(&root, "notes", VaultStorageMode::EncryptedDir).unwrap(),
        );
        let mount_point = places.join(UNLOCKED_CONTAINER).join("Notes");
        assert_eq!(path, mount_point.display().to_string());
        assert_eq!(class, None);
        assert!(!places.join(UNLOCKED_CONTAINER).exists());
    }

    #[cfg(any(target_os = "linux", windows))]
    #[test]
    fn a_folder_wanted_and_none_chosen_is_unset() {
        let (_tmp, root, _places) = notes(|config| {
            config.unlocked_folder = crate::folder_list::unlocked::VaultUnlockedFolder {
                encrypted: EncryptedSwitch::On,
                devices: Default::default(),
            };
        });
        assert_eq!(
            unlocked_destination(&root, "notes", VaultStorageMode::EncryptedDir).unwrap(),
            UnlockedDestination::Unset
        );
        assert_eq!(
            unlocked_destination(&root, "notes", VaultStorageMode::UprivPlain).unwrap(),
            UnlockedDestination::Unset
        );
    }

    #[test]
    fn a_chain_where_no_folder_answers_is_unavailable() {
        let (_tmp, root, places) = notes(|_| {});
        crate::host_fs::remove_dir_all(&places).unwrap();
        assert!(matches!(
            unlocked_destination(&root, "notes", VaultStorageMode::UprivPlain).unwrap(),
            UnlockedDestination::Unavailable { .. }
        ));
    }
}
