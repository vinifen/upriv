//! The new vault an import fills: created with its `[importing]` mark, filled
//! through an import session, and closed once the mark is dropped. The
//! person's stop keeps the vault with the files that got in, and deletes it
//! only when none did. A failure deletes it. A quit that stops it, or a
//! crash, leaves the mark with what the session sealed, and the vault is in
//! recovery for the person to keep or delete ([`super::unfinished`]).

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{take_session, with_open_session, Job};
use crate::store::{is_reserved_logical, KdfUnlockPreset};

use super::create::{create_vault_with_welcome, NewVault};
use super::fs::fs_seal_staged_imports;
use super::open_close::{
    abandon_failed_import, close_vault, open_vault_for_ingest, CloseVaultOutcome,
};
use super::unfinished::end_import_mark;

/// A new vault an import filled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedVault {
    pub id: String,
    /// Items left out because they could not be imported; `0` unless the
    /// import was asked to leave them out.
    pub left_out: usize,
    /// The person stopped the import: the vault holds the files that got in
    /// before the stop, and opens like any other.
    pub stopped: bool,
}

/// How the import that fills a new vault ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportEnd {
    /// Every file is in.
    Whole,
    /// The person stopped it; what got in stays.
    Stopped,
}

/// Create the vault `config` names, fill it with `fill` (given its id) while
/// `job` runs, and close it. Once `fill` has put every file in, a stop has
/// nothing left to stop, and the import ends whole.
pub(super) fn fill_new_vault(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    job: &Job,
    fill: impl FnOnce(&str) -> Result<()>,
) -> Result<ImportedVault> {
    let id = config.vault.id.trim().to_string();
    create_vault_with_welcome(
        root,
        config,
        new_password,
        preset,
        None,
        NewVault::ForImport,
    )?;
    let filled = (|| {
        job.ensure_running()?;
        open_vault_for_ingest(root, &id, new_password)?;
        fill(&id)
    })();
    // A read the stop cut short fails with its own error: it reads as the stop.
    if let Err(error) = job.settle(filled) {
        let ended = end_unfinished_fill(root, &id, error, crate::session::is_quitting());
        if ended.as_ref().is_ok_and(|imported| imported.stopped) {
            job.end_as_stopped();
        }
        return ended;
    }
    // From here a stop is refused; one that came after the last file is moot.
    let _ = job.final_step();
    close_filled_vault(root, &id, ImportEnd::Whole)?;
    Ok(ImportedVault {
        id,
        left_out: 0,
        stopped: false,
    })
}

/// An import of a new vault ended before every file was in. When Upriv is
/// `quitting`, the quit stopped it, and the vault stays with its mark: the
/// quit's close seals what the session holds, and the vault is in recovery at
/// the next launch. The person's stop keeps the files that got in, or deletes
/// the vault when none did. A failure deletes it.
fn end_unfinished_fill(
    root: &VaultRoot,
    vault_id: &str,
    error: UprivError,
    quitting: bool,
) -> Result<ImportedVault> {
    match error {
        UprivError::JobCancelled if quitting => {
            log_event(LogLevel::Info, "vault_import_cut_off", &[("id", vault_id)]);
            Err(UprivError::JobCancelled)
        }
        UprivError::JobCancelled if imported_files(root, vault_id) > 0 => {
            close_filled_vault(root, vault_id, ImportEnd::Stopped)?;
            Ok(ImportedVault {
                id: vault_id.to_string(),
                left_out: 0,
                stopped: true,
            })
        }
        error => Err(abandon_failed_import(root, vault_id, error)),
    }
}

/// The files the import put in the tree of `vault_id` so far, as the person
/// sees them (not the paths the vault keeps for itself, such as its seed);
/// `0` before its session opened.
fn imported_files(root: &VaultRoot, vault_id: &str) -> usize {
    let Ok(vault_dir) = root.vault_dir(vault_id) else {
        return 0;
    };
    with_open_session(&vault_dir, |session| {
        Ok(session
            .index
            .nodes()
            .iter()
            .filter(|node| node.as_file().is_some() && !is_reserved_logical(&node.path))
            .count())
    })
    .unwrap_or(0)
}

/// Seal every file the import session of `vault_id` staged, drop its
/// `[importing]` mark, and close it: the vault is whole as it is, and opens
/// like any other. The mark goes only once the index names every file.
///
/// A seal that fails keeps the mark. A whole import leaves the session for
/// its caller, whose failure deletes the vault. A stopped one is never
/// deleted for the person: its session is let go as a crash would, so the
/// vault is in recovery, where an unlock sets aside, named, what the seal
/// missed.
pub(crate) fn close_filled_vault(
    root: &VaultRoot,
    vault_id: &str,
    end: ImportEnd,
) -> Result<CloseVaultOutcome> {
    if let Err(error) = fs_seal_staged_imports(root, vault_id) {
        if end == ImportEnd::Stopped {
            leave_for_recovery(root, vault_id);
        }
        return Err(error);
    }
    end_import_mark(root, vault_id);
    let closed = close_vault(root, vault_id)?;
    let event = match end {
        ImportEnd::Whole => "vault_imported",
        ImportEnd::Stopped => "vault_import_stopped",
    };
    log_event(LogLevel::Info, event, &[("id", vault_id)]);
    Ok(closed)
}

/// Let go of the session of `vault_id` without a seal: its keys are wiped
/// and its lock released, and the vault keeps its `[importing]` mark.
fn leave_for_recovery(root: &VaultRoot, vault_id: &str) {
    let released = root
        .vault_dir(vault_id)
        .and_then(|vault_dir| take_session(&vault_dir))
        .is_ok();
    let session = if released { "released" } else { "kept" };
    log_event(
        LogLevel::Warn,
        "vault_import_left_for_recovery",
        &[("id", vault_id), ("session", session)],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::test_support::{quiet_config, test_job_id, vault_root_with};
    use crate::vault::fs::{fs_read_file, fs_write_staged};

    /// A new vault an import began to fill, holding `files`.
    fn begun(root: &VaultRoot, files: &[&str]) {
        create_vault_with_welcome(
            root,
            quiet_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            None,
            NewVault::ForImport,
        )
        .unwrap();
        open_vault_for_ingest(root, "notes", b"pass-word-ok").unwrap();
        for file in files {
            fs_write_staged(root, "notes", &format!("/{file}"), &mut file.as_bytes()).unwrap();
        }
    }

    fn marked(root: &VaultRoot) -> bool {
        crate::config::load_vault_config(root.vault_dir("notes").unwrap())
            .unwrap()
            .importing
            .is_some()
    }

    fn row(root: &VaultRoot) -> crate::vault::VaultListItem {
        crate::vault::list_vaults(root).unwrap().remove(0)
    }

    #[test]
    fn the_quit_leaves_a_cut_off_import_for_the_person() {
        let (_tmp, root) = vault_root_with(&[]);
        begun(&root, &["a.txt"]);
        let ended = end_unfinished_fill(&root, "notes", UprivError::JobCancelled, true);
        assert!(matches!(ended, Err(UprivError::JobCancelled)));
        // The quit's close seals the session; the vault keeps its mark.
        close_vault(&root, "notes").unwrap();
        assert!(marked(&root));
        assert!(row(&root).import_unfinished);
    }

    #[test]
    fn the_person_s_stop_keeps_the_files_that_got_in_and_the_vault_opens() {
        let (_tmp, root) = vault_root_with(&[]);
        begun(&root, &["a.txt", "b.txt"]);
        let kept = end_unfinished_fill(&root, "notes", UprivError::JobCancelled, false).unwrap();
        assert_eq!(
            kept,
            ImportedVault {
                id: "notes".into(),
                left_out: 0,
                stopped: true,
            }
        );
        assert!(!marked(&root));
        let left = row(&root);
        assert_eq!(left.session, None, "closed, and not in recovery");
        assert!(!left.import_unfinished);

        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"a.txt");
        assert_eq!(fs_read_file(&root, "notes", "/b.txt").unwrap(), b"b.txt");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_stop_before_any_file_got_in_deletes_the_new_vault() {
        let (_tmp, root) = vault_root_with(&[]);
        begun(&root, &[]);
        let ended = end_unfinished_fill(&root, "notes", UprivError::JobCancelled, false);
        assert!(matches!(ended, Err(UprivError::JobCancelled)));
        assert!(!root.vault_dir("notes").unwrap().host_exists());
    }

    #[test]
    fn a_failure_deletes_the_new_vault() {
        for quitting in [false, true] {
            let (_tmp, root) = vault_root_with(&[]);
            begun(&root, &["a.txt"]);
            let ended = end_unfinished_fill(&root, "notes", UprivError::InsufficientRam, quitting);
            assert!(matches!(ended, Err(UprivError::InsufficientRam)));
            assert!(!root.vault_dir("notes").unwrap().host_exists());
        }
    }

    #[test]
    fn a_stop_that_cuts_a_file_short_still_keeps_what_got_in() {
        let (_tmp, root) = vault_root_with(&[]);
        let job_id = test_job_id();
        let job = Job::start(&job_id).unwrap();
        let kept = fill_new_vault(
            &root,
            quiet_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &job,
            |id| {
                fs_write_staged(&root, id, "/a.txt", &mut &b"alpha"[..])?;
                crate::session::cancel_job(&job_id)?;
                // What a read the stop cut short answers.
                Err(std::io::Error::other("job stopped").into())
            },
        )
        .unwrap();
        assert!(kept.stopped);
        assert!(job.ends_as_stopped(), "its end is logged as stopped");
        assert!(!marked(&root));
        crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"alpha");
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_stop_after_the_last_file_ends_the_import_whole() {
        let (_tmp, root) = vault_root_with(&[]);
        let job_id = test_job_id();
        let job = Job::start(&job_id).unwrap();
        let whole = fill_new_vault(
            &root,
            quiet_config("notes", "Notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            &job,
            |id| {
                fs_write_staged(&root, id, "/a.txt", &mut &b"alpha"[..])?;
                fs_seal_staged_imports(&root, id)?;
                crate::session::cancel_job(&job_id).map(|_| ())
            },
        )
        .unwrap();
        assert!(!whole.stopped);
        assert!(!job.ends_as_stopped(), "a whole import ends done");
        assert!(!marked(&root));
    }

    #[cfg(unix)]
    #[test]
    fn a_stop_whose_seal_fails_leaves_the_vault_in_recovery_and_nothing_lost() {
        use std::os::unix::fs::PermissionsExt;

        let (_tmp, root) = vault_root_with(&[]);
        begun(&root, &["a.txt"]);
        let index_dir = root
            .vault_store_dir("notes")
            .unwrap()
            .join(crate::store::INDEX_DIR_NAME);
        let restore = crate::host_fs::metadata(&index_dir).unwrap().permissions();
        let mut locked = restore.clone();
        locked.set_mode(0o555);
        crate::host_fs::set_permissions(&index_dir, locked).unwrap();
        let ended = end_unfinished_fill(&root, "notes", UprivError::JobCancelled, false);
        crate::host_fs::set_permissions(&index_dir, restore).unwrap();
        if ended.is_ok() {
            // Running as root: the lock did not apply.
            return;
        }
        assert!(root.vault_dir("notes").unwrap().host_is_dir());
        assert!(marked(&root));
        let left = row(&root);
        assert_eq!(left.session, Some("recovery"));
        assert!(left.import_unfinished);

        let opened = crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(opened.import_kept);
        let held = crate::vault::fs::fs_held_list(&root, "notes").unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].file.as_ref().unwrap().path, "/a.txt");
        crate::vault::fs::fs_held_restore(&root, "notes", &[held[0].name.clone()]).unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"a.txt");
        close_vault(&root, "notes").unwrap();
    }
}
