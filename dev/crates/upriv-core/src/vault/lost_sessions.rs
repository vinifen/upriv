//! Open vaults of a data folder Upriv lost: the one in use stopped answering
//! (unplugged, deleted, its grant gone) while they were open.
//!
//! Core keeps the data folder in use. Once a resolve finds it lost, every
//! vault still open there ends, as after a crash, before anything takes the
//! next data folder (on a phone, before its root serves another tree). The
//! names of those vaults stay until a data folder is in use again, so the
//! screen that follows names them whichever call ended them.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{abandon_session, busy_vault_dirs, lock_table, open_session_names};

/// The data folder in use, as its sessions name it.
struct InUse {
    vaults: PathBuf,
    /// Set once a resolve found it lost: the vaults that ended with it.
    lost: Option<Vec<String>>,
}

static IN_USE: Mutex<Option<InUse>> = Mutex::new(None);

/// The data folder at `root` is in use: the vaults that open from now on
/// belong to it. A lost data folder before it is left behind.
pub fn data_folder_entered(root: &Path) {
    *lock_table(&IN_USE) = Some(InUse {
        vaults: VaultRoot::new(root).vaults_dir(),
        lost: None,
    });
}

/// The resolve after the data folder in use found it lost: every vault still
/// open in it ends ([`end_lost_sessions`]). Nothing happens when no data
/// folder was in use.
///
/// Returns the names of every vault that ended with it so far.
pub fn leave_lost_data_folder() -> Vec<String> {
    {
        let mut in_use = lock_table(&IN_USE);
        if let Some(in_use) = in_use.as_mut() {
            in_use.lost.get_or_insert_with(Vec::new);
        }
    }
    end_lost_sessions()
}

/// End every session still open in the lost data folder (an open that ended
/// after the resolve leaves one), as after a crash: its attach and its
/// plain-text sync stop, and it leaves the table, which wipes its keys and
/// releases its mount once the work still holding it ends.
///
/// Nothing is written: that data folder's `state.json` still names each
/// session, and a plain-text folder stays as it is with its record there,
/// so each vault recovers once that data folder is back. The plain-text
/// folder is never wiped here: with the store out of reach, it may hold the
/// only copy of the vault's newest files.
///
/// Returns the names of every vault that ended with that data folder so
/// far; nothing while the data folder in use is not lost.
pub fn end_lost_sessions() -> Vec<String> {
    let mut in_use = lock_table(&IN_USE);
    let Some(InUse {
        vaults,
        lost: Some(ended),
    }) = in_use.as_mut()
    else {
        return Vec::new();
    };
    for session in open_session_names() {
        if !session.vault_dir.starts_with(&*vaults) {
            continue;
        }
        super::unlocked_folder::stop_attach(&session.vault_dir);
        super::plain::stop_sync(&session.vault_dir);
        if abandon_session(&session.vault_dir) {
            log_event(
                LogLevel::Warn,
                "vault_session_lost",
                &[("id", session.vault_id.as_str())],
            );
            ended.push(session.display_name);
        }
    }
    ended.clone()
}

/// A close or an open of a vault of the lost data folder still runs. Each
/// fails or ends on its own; a switch away waits for it.
pub(crate) fn lost_work_runs() -> bool {
    let lost = match lock_table(&IN_USE).as_ref() {
        Some(InUse {
            vaults,
            lost: Some(_),
        }) => vaults.clone(),
        _ => return false,
    };
    busy_vault_dirs().iter().any(|dir| dir.starts_with(&lost))
}

/// No data folder is in use, as when the process starts.
#[cfg(test)]
pub(crate) fn forget_data_folder_in_use() {
    *lock_table(&IN_USE) = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::is_vault_open_at;
    use crate::store::KdfUnlockPreset;
    use crate::test_support::vault_root_with;
    use crate::vault::{create_vault, open_vault};

    /// A data folder holding the vault `id`, open: the data folder's root
    /// and the vault's folder.
    fn open_in_own_data_folder(
        id: &str,
        name: &str,
    ) -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let (tmp, root) = vault_root_with(&[]);
        let config = toml::from_str(&format!(
            "[vault]\nid = \"{id}\"\ndisplay_name = \"{name}\"\norder = 1\n\
             [storage]\nmode = \"encrypted_dir\"\n"
        ))
        .unwrap();
        create_vault(&root, config, b"pass-word-ok", KdfUnlockPreset::M32).unwrap();
        open_vault(&root, id, b"pass-word-ok").unwrap();
        let vault_dir = root.vault_dir(id).unwrap();
        (tmp, root.root().to_path_buf(), vault_dir)
    }

    /// The data folder in use is process-wide, as the data folder tests'
    /// environment is: they take turns.
    fn one_data_folder_at_a_time() -> std::sync::MutexGuard<'static, ()> {
        let turn = crate::paths::ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        forget_data_folder_in_use();
        turn
    }

    #[test]
    fn a_lost_data_folder_ends_its_vaults_and_keeps_their_names() {
        let _turn = one_data_folder_at_a_time();
        let (_lost_folder, lost_root, lost) = open_in_own_data_folder("lost-notes", "Lost notes");
        let (_other_folder, _, other) = open_in_own_data_folder("other-notes", "Other notes");
        data_folder_entered(&lost_root);

        // In use and not lost: nothing ends, even through the apply's call.
        assert!(end_lost_sessions().is_empty());
        assert!(is_vault_open_at(&lost));

        let ended = leave_lost_data_folder();
        assert_eq!(ended, vec!["Lost notes".to_string()]);
        assert!(!is_vault_open_at(&lost));
        // A vault of another data folder is not this one's to end.
        assert!(is_vault_open_at(&other));
        // The names stay for the calls that follow, until a data folder is in use again.
        assert_eq!(end_lost_sessions(), vec!["Lost notes".to_string()]);
        assert!(!lost_work_runs());

        data_folder_entered(&lost_root);
        assert!(end_lost_sessions().is_empty());
        drop(crate::session::take_session(&other).unwrap());
        forget_data_folder_in_use();
    }

    #[test]
    fn nothing_ends_while_no_data_folder_was_in_use() {
        let _turn = one_data_folder_at_a_time();
        let (_folder, _, vault_dir) = open_in_own_data_folder("first-notes", "First notes");
        assert!(leave_lost_data_folder().is_empty());
        assert!(is_vault_open_at(&vault_dir));
        drop(crate::session::take_session(&vault_dir).unwrap());
    }
}
