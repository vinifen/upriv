//! What a crash, a kill, or a power cut leaves behind from a job, and the
//! cleanup at the next launch.
//!
//! A job that writes a file outside the vault (a vault export, a backup
//! export, the data-folder zip) records that file in `state.json` before its
//! first byte. A create, and an import that copies a store, records its new
//! vault before the vault's folder exists. A job that ends forgets its record.
//! [`sweep_unfinished`] clears what is still recorded: it removes each
//! unfinished file, overwriting a plain-text one first on a thread of its own,
//! and deletes each vault whose create or copy never finished, which holds
//! nothing to keep.
//!
//! An import that fills a whole new vault marks it `[importing]` in its own
//! `config.toml` instead, from the create on, and drops the mark once every
//! file is in. One a quit or a crash cut off keeps the mark and the files its
//! seals hold: that vault is in recovery until the person keeps it (an unlock)
//! or deletes it. Nothing removes it for them.

use std::path::Path;

use crate::config::{load_vault_config, save_vault_config};
use crate::error::Result;
use crate::host_fs::{is_tree_mounted, tree_uri_of};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::runtime_state::{
    add_unfinished_file, add_unfinished_import, remove_unfinished_file, remove_unfinished_import,
    unfinished_files_here, unfinished_imports, vault_is_live, UnfinishedFileRecord, UnfinishedWork,
};
use crate::session::{job_status, Job};

use super::backup::vault_id_log_field;
use super::export_folder::PART_SUFFIX;
use super::open_close::delete_failed_import;
use super::partial::{discard_partial, is_wiping, wipe_partial_behind, PartialWork};
use super::wipe::WipeOptions;

/// Record the unfinished file `partial` that `job` is about to write, so a
/// crash cannot leave it unknown. Without the record the job does not start.
pub(super) fn record_file(
    root: &VaultRoot,
    work: UnfinishedWork,
    vault_id: Option<&str>,
    partial: &Path,
    job: &Job,
) -> Result<()> {
    add_unfinished_file(
        root,
        UnfinishedFileRecord::written_here(
            work,
            vault_id.map(str::to_string),
            partial.to_string_lossy().into_owned(),
            tree_uri_of(partial),
            job.id().to_string(),
        ),
    )
}

/// The file is gone or complete. A record that stays only means a later launch
/// finds nothing at its path.
pub(super) fn forget_file(root: &VaultRoot, partial: &Path) {
    let _ = remove_unfinished_file(root, &partial.to_string_lossy());
}

/// Record the new vault `vault_id` before a create writes its folder: the
/// vault is not whole until the create, or a store copy, lands.
pub(super) fn record_import(root: &VaultRoot, vault_id: &str) -> Result<()> {
    add_unfinished_import(root, vault_id)
}

/// The vault is whole, or gone.
pub(super) fn forget_import(root: &VaultRoot, vault_id: &str) {
    let _ = remove_unfinished_import(root, vault_id);
}

/// Something holds the vault `vault_id` at `vault_dir` now: its session is
/// open in this process, a create, an unlock, or other work on it runs here
/// (an export, the data folder's copy), or another Upriv holds its lock. A
/// vault an import marked or recorded that none of these holds is one a quit
/// or a crash cut off; one that is held is never taken for cut off.
pub(crate) fn import_running(root: &VaultRoot, vault_id: &str, vault_dir: &Path) -> bool {
    vault_is_live(root, vault_id) || crate::session::is_vault_preparing_at(vault_dir)
}

/// The import of `vault_id` has every file in: drop the vault's
/// `[importing]` mark, once more when the write fails. A mark that stays
/// shows the vault in recovery, where an unlock keeps it.
pub(super) fn end_import_mark(root: &VaultRoot, vault_id: &str) {
    let Ok(vault_dir) = root.vault_dir(vault_id) else {
        return;
    };
    let dropped = (0..2).any(|_| {
        crate::session::with_vault_dir_lock(&vault_dir, || {
            let mut config = load_vault_config(&vault_dir)?;
            if config.importing.take().is_some() {
                save_vault_config(&vault_dir, &config)?;
            }
            Ok(())
        })
        .is_ok()
    });
    if !dropped {
        let fields: Vec<_> = vault_id_log_field(vault_id).into_iter().collect();
        log_event(LogLevel::Warn, "vault_import_mark_kept", &fields);
    }
}

/// How the log names the removal of an unfinished file of `work`.
pub(super) fn partial_work(work: UnfinishedWork) -> PartialWork {
    match work {
        UnfinishedWork::VaultExport | UnfinishedWork::PlainExport => PartialWork::VaultExport,
        UnfinishedWork::BackupExport => PartialWork::BackupExport,
        UnfinishedWork::DataFolderExport => PartialWork::DataFolderExport,
    }
}

/// What [`sweep_unfinished`] did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SweepOutcome {
    /// The storage-access trees that hold an unfinished file and are not
    /// mounted: mount each and sweep again.
    pub folders: Vec<String>,
    /// The vaults whose create or store copy never finished that it deleted,
    /// by id.
    pub removed_vaults: Vec<String>,
}

/// Clear what a crash left: delete each vault whose create or store copy
/// never finished, then remove each unfinished file this computer recorded.
/// Whatever cannot be removed keeps its record for the next launch.
pub fn sweep_unfinished(root: &VaultRoot) -> Result<SweepOutcome> {
    let removed_vaults = sweep_unfinished_vaults(root)?;
    Ok(SweepOutcome {
        folders: sweep_files(root)?,
        removed_vaults,
    })
}

/// Each vault whose create or store copy a crash cut off holds nothing to
/// keep: it is removed. A vault an import was filling has its own
/// `[importing]` mark instead and stays, in recovery, for the person.
fn sweep_unfinished_vaults(root: &VaultRoot) -> Result<Vec<String>> {
    let mut removed = Vec::new();
    for vault_id in unfinished_imports(root)? {
        // A create running in this process, or in another Upriv on the same
        // data folder, is not a leftover.
        if import_running(root, &vault_id, &root.vault_dir(&vault_id)?) {
            continue;
        }
        let fields: Vec<_> = vault_id_log_field(&vault_id).into_iter().collect();
        // A deleted vault forgets its record.
        match delete_failed_import(root, &vault_id) {
            Ok(()) => {
                log_event(LogLevel::Info, "vault_import_unfinished_removed", &fields);
                removed.push(vault_id);
            }
            Err(_) => log_event(
                LogLevel::Warn,
                "vault_import_unfinished_remove_failed",
                &fields,
            ),
        }
    }
    Ok(removed)
}

fn sweep_files(root: &VaultRoot) -> Result<Vec<String>> {
    let mut folders = Vec::new();
    for record in unfinished_files_here(root)? {
        if job_status(&record.job).is_some() || is_wiping(Path::new(&record.path)) {
            continue;
        }
        // `state.json` is only trusted to name a file this app wrote.
        if !record.path.ends_with(PART_SUFFIX) {
            remove_unfinished_file(root, &record.path)?;
            continue;
        }
        if let Some(tree) = &record.tree {
            if !is_tree_mounted(tree) {
                if !folders.contains(tree) {
                    folders.push(tree.clone());
                }
                continue;
            }
        }
        let path = Path::new(&record.path);
        let work = partial_work(record.work);
        if record.work == UnfinishedWork::PlainExport {
            // A vault deleted since then wipes with the default passes. The
            // wipe forgets the record once the file is gone.
            let vault_dir = match record.vault_id.as_deref() {
                Some(id) => root.vault_dir(id)?,
                None => std::path::PathBuf::new(),
            };
            wipe_partial_behind(root, path, work, WipeOptions::for_vault_dir(&vault_dir));
            continue;
        }
        if discard_partial(path, work) {
            remove_unfinished_file(root, &record.path)?;
        }
    }
    folders.sort();
    folders.dedup();
    Ok(folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::runtime_state::{load_runtime_state, save_runtime_state};
    use crate::store::KdfUnlockPreset;
    use crate::test_support::{test_job_id, vault_root_with};

    fn record(
        path: &Path,
        work: UnfinishedWork,
        tree: Option<&str>,
        job: &str,
    ) -> UnfinishedFileRecord {
        UnfinishedFileRecord::written_here(
            work,
            Some("notes".into()),
            path.to_string_lossy().into_owned(),
            tree.map(str::to_string),
            job.into(),
        )
    }

    #[test]
    fn a_sweep_wipes_a_plain_text_leftover_and_forgets_it() {
        let (tmp, root) = vault_root_with(&[]);
        let partial = tmp.path().join("Notes.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable").unwrap();
        add_unfinished_file(
            &root,
            record(&partial, UnfinishedWork::PlainExport, None, "ended-job"),
        )
        .unwrap();

        assert_eq!(sweep_unfinished(&root).unwrap(), SweepOutcome::default());
        // The sweep answers at once; the wipe forgets the record when done.
        crate::vault::wait_for_partial_wipes();
        assert!(!partial.host_exists());
        assert!(load_runtime_state(&root)
            .unwrap()
            .unfinished_files
            .is_empty());
    }

    #[test]
    fn a_sweep_removes_every_kind_of_unfinished_file() {
        let (tmp, root) = vault_root_with(&[]);
        let works = [
            UnfinishedWork::VaultExport,
            UnfinishedWork::BackupExport,
            UnfinishedWork::DataFolderExport,
        ];
        let partials: Vec<_> = works
            .iter()
            .enumerate()
            .map(|(at, work)| {
                let partial = tmp.path().join(format!("file {at}.zip.upriv-part"));
                crate::host_fs::write(&partial, b"ciphertext").unwrap();
                add_unfinished_file(&root, record(&partial, *work, None, "ended-job")).unwrap();
                partial
            })
            .collect();

        sweep_unfinished(&root).unwrap();
        assert!(partials.iter().all(|partial| !partial.host_exists()));
        assert!(load_runtime_state(&root)
            .unwrap()
            .unfinished_files
            .is_empty());
    }

    #[test]
    fn a_sweep_leaves_a_job_still_running() {
        let (tmp, root) = vault_root_with(&[]);
        let partial = tmp.path().join("Notes.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable").unwrap();
        let id = test_job_id();
        let _job = Job::start(&id).unwrap();
        add_unfinished_file(
            &root,
            record(&partial, UnfinishedWork::PlainExport, None, &id),
        )
        .unwrap();

        sweep_unfinished(&root).unwrap();
        assert!(partial.host_exists());
        assert_eq!(load_runtime_state(&root).unwrap().unfinished_files.len(), 1);
    }

    #[test]
    fn a_record_only_ever_names_an_unfinished_file() {
        let (tmp, root) = vault_root_with(&[]);
        let someone_elses = tmp.path().join("Notes.zip");
        crate::host_fs::write(&someone_elses, b"finished").unwrap();
        add_unfinished_file(
            &root,
            record(
                &someone_elses,
                UnfinishedWork::VaultExport,
                None,
                "ended-job",
            ),
        )
        .unwrap();

        sweep_unfinished(&root).unwrap();
        assert_eq!(crate::host_fs::read(&someone_elses).unwrap(), b"finished");
        assert!(load_runtime_state(&root)
            .unwrap()
            .unfinished_files
            .is_empty());
    }

    #[test]
    fn a_folder_that_is_not_mounted_is_named_once_and_keeps_its_records() {
        let (_tmp, root) = vault_root_with(&[]);
        let tree = "content://tree/primary%3ADownload";
        let first = crate::host_fs::tree_root(tree).join("A.zip.upriv-part");
        let second = crate::host_fs::tree_root(tree).join("B.zip.upriv-part");
        add_unfinished_file(
            &root,
            record(&first, UnfinishedWork::PlainExport, Some(tree), "ended-a"),
        )
        .unwrap();
        add_unfinished_file(
            &root,
            record(&second, UnfinishedWork::VaultExport, Some(tree), "ended-b"),
        )
        .unwrap();

        assert_eq!(
            sweep_unfinished(&root).unwrap().folders,
            vec![tree.to_string()]
        );
        assert_eq!(load_runtime_state(&root).unwrap().unfinished_files.len(), 2);
    }

    #[test]
    fn a_record_from_another_device_waits_for_that_device() {
        let (tmp, root) = vault_root_with(&[]);
        let partial = tmp.path().join("Notes.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable").unwrap();
        let mut state = load_runtime_state(&root).unwrap();
        state.unfinished_files.push(UnfinishedFileRecord {
            device: "3e301fc022fc5185e12822bc2a251f64".into(),
            ..record(&partial, UnfinishedWork::PlainExport, None, "ended-job")
        });
        save_runtime_state(&root, &state).unwrap();

        sweep_unfinished(&root).unwrap();
        assert!(partial.host_exists());
    }

    fn sample_config(id: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "Notes"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    fn create_notes(root: &VaultRoot) {
        crate::vault::create_vault(
            root,
            sample_config("notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
        )
        .unwrap();
    }

    #[test]
    fn a_sweep_deletes_the_vault_a_crash_cut_off_mid_import() {
        let (_tmp, root) = vault_root_with(&[]);
        create_notes(&root);
        record_import(&root, "notes").unwrap();
        assert!(root.vault_dir("notes").unwrap().host_is_dir());

        assert_eq!(
            sweep_unfinished(&root).unwrap().removed_vaults,
            vec!["notes"]
        );
        assert!(!root.vault_dir("notes").unwrap().host_exists());
        assert!(load_runtime_state(&root)
            .unwrap()
            .unfinished_imports
            .is_empty());
    }

    #[test]
    fn a_sweep_leaves_an_import_still_running_here() {
        let (_tmp, root) = vault_root_with(&[]);
        create_notes(&root);
        record_import(&root, "notes").unwrap();
        crate::vault::open_import_session(&root, "notes", b"pass-word-ok").unwrap();

        assert!(sweep_unfinished(&root).unwrap().removed_vaults.is_empty());
        assert!(root.vault_dir("notes").unwrap().host_is_dir());
        assert_eq!(
            load_runtime_state(&root).unwrap().unfinished_imports,
            vec!["notes"]
        );
        crate::vault::abort_import_vault(&root, "notes").unwrap();
    }

    fn row(root: &VaultRoot) -> crate::vault::VaultListItem {
        crate::vault::list_vaults(root).unwrap().remove(0)
    }

    /// An unlock while the folder's lock is held: a refusal that came after
    /// the lock would wait instead.
    fn unlock_behind_the_lock(root: &VaultRoot) -> Result<crate::vault::VaultOpened> {
        let dir = root.vault_dir("notes").unwrap();
        crate::session::with_vault_dir_lock(&dir, || {
            Ok(crate::open_vault(root, "notes", b"pass-word-ok"))
        })
        .unwrap()
    }

    /// A vault an import was filling when a quit or a crash cut it off: the
    /// session's close sealed what got in, and the mark stays.
    fn cut_off_import(root: &VaultRoot) {
        crate::create_vault_as_job(
            root,
            sample_config("notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            None,
            true,
            &test_job_id(),
        )
        .unwrap();
        crate::vault::open_import_session(root, "notes", b"pass-word-ok").unwrap();
        crate::vault::ingest_import_reader(
            root,
            "notes",
            "a.txt",
            &mut &b"alpha"[..],
            &test_job_id(),
        )
        .unwrap();
        crate::close_vault(root, "notes").unwrap();
    }

    #[test]
    fn a_cut_off_create_is_removed_and_never_opens() {
        let (_tmp, root) = vault_root_with(&[]);
        create_notes(&root);
        record_import(&root, "notes").unwrap();

        crate::vault::open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        assert_eq!(row(&root).session, Some("importing"));
        crate::close_vault(&root, "notes").unwrap();

        let left = row(&root);
        assert_eq!(left.session, Some("deleting"));
        assert!(!left.delete_unfinished);
        assert!(!left.import_unfinished);
        assert!(matches!(
            unlock_behind_the_lock(&root),
            Err(crate::error::UprivError::VaultImportUnfinished)
        ));
    }

    #[test]
    fn an_import_still_running_is_importing_and_refuses_an_unlock() {
        let (_tmp, root) = vault_root_with(&[]);
        crate::create_vault_as_job(
            &root,
            sample_config("notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            None,
            true,
            &test_job_id(),
        )
        .unwrap();
        crate::vault::open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        let running = row(&root);
        assert_eq!(running.session, Some("importing"));
        assert!(!running.import_unfinished);
        assert!(matches!(
            unlock_behind_the_lock(&root),
            Err(crate::error::UprivError::VaultImportUnfinished)
        ));
        crate::vault::abort_import_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_cut_off_import_is_in_recovery_until_an_unlock_keeps_it() {
        let (_tmp, root) = vault_root_with(&[]);
        cut_off_import(&root);
        let left = row(&root);
        assert_eq!(left.session, Some("recovery"));
        assert!(left.import_unfinished);
        // Nothing removes it for the person.
        assert!(sweep_unfinished(&root).unwrap().removed_vaults.is_empty());
        assert!(root.vault_dir("notes").unwrap().host_is_dir());

        let opened = crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(opened.import_kept);
        assert_eq!(row(&root).session, Some("open"));
        assert!(crate::vault::fs::fs_read_file(&root, "notes", "/a.txt").is_ok());
        crate::close_vault(&root, "notes").unwrap();

        let kept = row(&root);
        assert_eq!(kept.session, None);
        assert!(!kept.import_unfinished);
        let config = load_vault_config(root.vault_dir("notes").unwrap()).unwrap();
        assert_eq!(config.importing, None);
    }

    #[test]
    fn a_wrong_password_keeps_a_cut_off_import_in_recovery() {
        let (_tmp, root) = vault_root_with(&[]);
        cut_off_import(&root);
        assert!(crate::open_vault(&root, "notes", b"not-the-password").is_err());
        assert!(row(&root).import_unfinished);
    }

    #[test]
    fn a_finished_import_is_a_vault_like_any_other() {
        let (_tmp, root) = vault_root_with(&[]);
        crate::create_vault_as_job(
            &root,
            sample_config("notes"),
            b"pass-word-ok",
            KdfUnlockPreset::M32,
            None,
            true,
            &test_job_id(),
        )
        .unwrap();
        crate::vault::open_import_session(&root, "notes", b"pass-word-ok").unwrap();
        crate::vault::finish_import_session(&root, "notes", crate::vault::ImportEnd::Whole)
            .unwrap();
        let done = row(&root);
        assert_eq!(done.session, None);
        assert!(!done.import_unfinished);
        let opened = crate::open_vault(&root, "notes", b"pass-word-ok").unwrap();
        assert!(!opened.import_kept);
        crate::close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_complete_create_leaves_no_record() {
        let (_tmp, root) = vault_root_with(&[]);
        create_notes(&root);
        assert!(load_runtime_state(&root)
            .unwrap()
            .unfinished_imports
            .is_empty());
    }

    #[test]
    fn a_finished_import_leaves_no_record_to_sweep() {
        let (_tmp, root) = vault_root_with(&[]);
        record_import(&root, "notes").unwrap();
        forget_import(&root, "notes");
        assert!(load_runtime_state(&root)
            .unwrap()
            .unfinished_imports
            .is_empty());
    }
}
