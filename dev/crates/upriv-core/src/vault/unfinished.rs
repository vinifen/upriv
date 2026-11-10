//! What a crash, a kill, or a power cut leaves behind from a job, and the
//! cleanup at the next launch.
//!
//! A job that writes a file outside the vault (a vault export, a backup
//! export, the data-folder zip) records that file in `state.json` before its
//! first byte. An import records its new vault before the vault's folder
//! exists. A job that ends forgets its record. [`sweep_unfinished`] clears what
//! is still recorded: it removes each unfinished file, overwriting a plain-text
//! one first on a thread of its own, and deletes each vault an import never
//! finished.

use std::path::Path;

use crate::error::Result;
use crate::host_fs::{export_tree_uri, SAF_EXPORT_ROOT};
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
        UnfinishedFileRecord {
            work,
            vault_id: vault_id.map(str::to_string),
            host: String::new(),
            path: partial.to_string_lossy().into_owned(),
            tree: export_tree_uri(partial),
            job: job.id().to_string(),
        },
    )
}

/// The file is gone or complete. A record that stays only means a later launch
/// finds nothing at its path.
pub(super) fn forget_file(root: &VaultRoot, partial: &Path) {
    let _ = remove_unfinished_file(root, &partial.to_string_lossy());
}

/// Record the new vault `vault_id` before an import writes its folder.
pub(super) fn record_import(root: &VaultRoot, vault_id: &str) -> Result<()> {
    add_unfinished_import(root, vault_id)
}

/// The import finished, or its vault is gone.
pub(super) fn forget_import(root: &VaultRoot, vault_id: &str) {
    let _ = remove_unfinished_import(root, vault_id);
}

/// How the log names the removal of an unfinished file of `work`.
pub(super) fn partial_work(work: UnfinishedWork) -> PartialWork {
    match work {
        UnfinishedWork::VaultExport | UnfinishedWork::PlainExport => PartialWork::VaultExport,
        UnfinishedWork::BackupExport => PartialWork::BackupExport,
        UnfinishedWork::DataFolderExport => PartialWork::DataFolderExport,
    }
}

/// Clear what a crash left: delete each vault an import never finished, then
/// remove each unfinished file this computer recorded. Returns the
/// storage-access folders that hold such a file and are not mounted: mount
/// each as the export folder and sweep again. Whatever cannot be removed keeps
/// its record for the next launch.
pub fn sweep_unfinished(root: &VaultRoot) -> Result<Vec<String>> {
    sweep_imports(root)?;
    sweep_files(root)
}

fn sweep_imports(root: &VaultRoot) -> Result<()> {
    for vault_id in unfinished_imports(root)? {
        // An import running in this process, or in another Upriv on the same
        // data folder, is not a leftover.
        if vault_is_live(root, &vault_id) {
            continue;
        }
        let fields: Vec<_> = vault_id_log_field(&vault_id).into_iter().collect();
        // A deleted vault forgets its record.
        match delete_failed_import(root, &vault_id) {
            Ok(()) => log_event(LogLevel::Info, "vault_import_unfinished_removed", &fields),
            Err(_) => log_event(
                LogLevel::Warn,
                "vault_import_unfinished_remove_failed",
                &fields,
            ),
        }
    }
    Ok(())
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
            let mounted = export_tree_uri(Path::new(SAF_EXPORT_ROOT));
            if mounted.as_deref() != Some(tree.as_str()) {
                folders.push(tree.clone());
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
        UnfinishedFileRecord {
            work,
            vault_id: Some("notes".into()),
            host: String::new(),
            path: path.to_string_lossy().into_owned(),
            tree: tree.map(str::to_string),
            job: job.into(),
        }
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

        assert!(sweep_unfinished(&root).unwrap().is_empty());
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
        let first = Path::new(SAF_EXPORT_ROOT).join("A.zip.upriv-part");
        let second = Path::new(SAF_EXPORT_ROOT).join("B.zip.upriv-part");
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

        assert_eq!(sweep_unfinished(&root).unwrap(), vec![tree.to_string()]);
        assert_eq!(load_runtime_state(&root).unwrap().unfinished_files.len(), 2);
    }

    #[test]
    fn a_record_from_another_computer_waits_for_that_computer() {
        let (tmp, root) = vault_root_with(&[]);
        let partial = tmp.path().join("Notes.zip.upriv-part");
        crate::host_fs::write(&partial, b"readable").unwrap();
        let mut state = load_runtime_state(&root).unwrap();
        state.unfinished_files.push(UnfinishedFileRecord {
            host: "another-computer".into(),
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

        sweep_unfinished(&root).unwrap();
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

        sweep_unfinished(&root).unwrap();
        assert!(root.vault_dir("notes").unwrap().host_is_dir());
        assert_eq!(
            load_runtime_state(&root).unwrap().unfinished_imports,
            vec!["notes"]
        );
        crate::vault::abort_import_vault(&root, "notes").unwrap();
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
