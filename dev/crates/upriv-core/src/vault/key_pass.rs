//! The pass that makes every blob's key copy the header's
//! ([`crate::store::pass_one`]), where the keys are.
//!
//! A header write that changes the top block seals `key_copies_due` on: no
//! key copy is the new block's yet. The pass then walks the blobs of the tree
//! and of `held/`, writes the header's key copy over each one behind it,
//! flushes it, and seals `key_copies_due` off once it reaches the end.
//!
//! - Inside a change ([`pass_closed`]): the job that holds the keys of a
//!   closed vault runs it after its commit, on a local set of staged blobs.
//! - After an open ([`update_key_copies`], `vault_key_copies_update`): one
//!   blob at a time under the session's lock, through the session's staged
//!   blobs, so a read or a write waits at most for one 4 KiB write and its
//!   flush. A close stops it, and none starts once a close began. Core
//!   decides whether anything is due.
//!
//! A stop ends a pass where it is, and the job after the next open resumes
//! it: a stop here is never a cancel. A blob of the tree whose flush fails is
//! copied to a new blob by the store's rule for a failed flush; a held blob
//! whose flush fails keeps the pass due.

use std::sync::atomic::Ordering;

use serde::Serialize;

use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{is_vault_closing_at, with_open_session, Job, JobKind, JobStep};
use crate::store::{
    pack_blob_waste, pass_one, pass_targets, BlobPackMode, PassStep, PassTarget, Records,
    StagedBlobs, KEY_COPY_LEN,
};

use super::closed_store::ClosedStore;

/// Where the key copies stand once a pass ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyCopies {
    /// Every key copy is the header's.
    Done,
    /// Some wait: the job after the next open finishes them.
    Waiting,
}

/// Run the pass over a closed vault's store as part of `job`, which counts
/// its blobs from zero ([`Job::start_over`]). A stop ends it with
/// [`KeyCopies::Waiting`].
pub(crate) fn pass_closed(store: &mut ClosedStore, job: &Job) -> Result<KeyCopies> {
    if !store.index.key_copies_due {
        return Ok(KeyCopies::Done);
    }
    job.start_over();
    let dir = store.store_dir();
    let targets = pass_targets(&dir, &store.index);
    job.begin(
        JobStep::UpdatingKeyCopies,
        targets.len() as u64 * KEY_COPY_LEN,
    );
    let mut staged = StagedBlobs::default();
    let mut failed = Failed::default();
    for target in &targets {
        if job.is_stopped() {
            log_pass_left(&store.vault_id, "stopped");
            return Ok(KeyCopies::Waiting);
        }
        let flushed = match pass_one(target, &store.keys) {
            Ok(PassStep::Wrote) => staged.flush_key_copy(&target.path).is_ok(),
            Ok(PassStep::Good | PassStep::Skipped) => true,
            Err(_) => false,
        };
        if !flushed {
            failed.note(target);
        }
        job.advance(KEY_COPY_LEN);
    }
    let mut dropped = Vec::new();
    if !failed.tree.is_empty() {
        match copy_failed(store, &failed.tree) {
            Ok(superseded) => dropped = superseded,
            Err(_) => failed.held = true,
        }
    }
    store.index.key_copies_due = failed.held;
    store.seal(dropped)?;
    if failed.held {
        log_pass_left(&store.vault_id, "unflushed");
        return Ok(KeyCopies::Waiting);
    }
    Ok(KeyCopies::Done)
}

/// Blobs whose key copy did not reach the disk.
#[derive(Default)]
struct Failed {
    /// File ids of the tree's blobs: their files are copied.
    tree: Vec<String>,
    /// A held blob: the pass stays due for it.
    held: bool,
}

impl Failed {
    fn note(&mut self, target: &PassTarget) {
        if target.held {
            self.held = true;
        } else {
            self.tree.push(target.file_id.to_string());
        }
    }
}

/// Copy the files of the tree's blobs `file_ids`, whose flush failed, to new
/// blobs with the header's key copy, and flush the copies. Returns the old
/// blobs, for the seal that names the copies to release. A copy that does not
/// flush is undone, and the error returned.
fn copy_failed(store: &mut ClosedStore, file_ids: &[String]) -> Result<Vec<String>> {
    let dir = store.store_dir();
    let packed = pack_blob_waste(
        &dir,
        &store.keys,
        &mut store.index,
        BlobPackMode::Rewrite,
        Some(file_ids),
    )?;
    let records = Records {
        keys: &store.keys,
        index: &store.index,
    };
    if let Err(error) = packed.mutation.sync_before_index(&records) {
        packed.mutation.restore_packed_nodes(&mut store.index);
        packed.mutation.discard_created();
        return Err(error);
    }
    Ok(packed.mutation.superseded_ids())
}

/// Resume the pass of the open vault `vault_id` as the job `job_id`: the call
/// the UI makes after each open. Answers [`KeyCopies::Done`] at once when
/// nothing is due. Refused with [`UprivError::JobCancelled`] once a close
/// began, and with [`UprivError::VaultBusy`] while a pass already runs.
pub fn update_key_copies(root: &VaultRoot, vault_id: &str, job_id: &str) -> Result<KeyCopies> {
    let vault_dir = root.vault_dir(vault_id)?;
    Job::run(job_id, JobKind::KeyCopies, Some(vault_id), |job| {
        if is_vault_closing_at(&vault_dir) {
            return Err(UprivError::JobCancelled);
        }
        let targets = with_open_session(&vault_dir, |session| {
            if !session.index.key_copies_due {
                return Ok(None);
            }
            if session.key_copies.is_some() {
                return Err(UprivError::VaultBusy);
            }
            session.key_copies = Some(job.stop_flag());
            let dir = session.vault_dir.join(crate::paths::STORE_DIR_NAME);
            Ok(Some(pass_targets(&dir, &session.index)))
        })?;
        let Some(targets) = targets else {
            return Ok(KeyCopies::Done);
        };
        job.begin(
            JobStep::UpdatingKeyCopies,
            targets.len() as u64 * KEY_COPY_LEN,
        );
        let walked = walk_session(&vault_dir, &targets, job);
        // The session may be gone: a close took it, and the next open resumes.
        let ended = with_open_session(&vault_dir, |session| {
            session.key_copies = None;
            let Ok(held_failed) = walked else {
                return Ok(KeyCopies::Waiting);
            };
            if job.is_stopped() || held_failed || !session.index.key_copies_due {
                return Ok(KeyCopies::Waiting);
            }
            session.index.key_copies_due = false;
            match super::fs::commit(session) {
                Ok(_) => Ok(KeyCopies::Done),
                Err(error) => {
                    session.index.key_copies_due = true;
                    Err(error)
                }
            }
        });
        let ended = match ended {
            Err(UprivError::VaultNotOpen(_)) => KeyCopies::Waiting,
            other => other?,
        };
        if ended == KeyCopies::Waiting {
            log_pass_left(vault_id, "waiting");
        }
        Ok(ended)
    })
}

/// Visit `targets` one blob at a time under the session's lock, until the
/// end, a stop, or a close. Returns whether a held blob's key copy did not
/// reach the disk; a blob of the tree whose flush fails is marked failed in
/// the session, and its next seal copies it.
fn walk_session(vault_dir: &std::path::Path, targets: &[PassTarget], job: &Job) -> Result<bool> {
    let mut held_failed = false;
    for target in targets {
        if job.is_stopped() || is_vault_closing_at(vault_dir) {
            return Ok(held_failed);
        }
        let flushed = with_open_session(vault_dir, |session| {
            Ok(match pass_one(target, &session.keys) {
                Ok(PassStep::Wrote) => session.staged_blobs.flush_key_copy(&target.path).is_ok(),
                Ok(PassStep::Good | PassStep::Skipped) => true,
                Err(_) => false,
            })
        })?;
        if !flushed && target.held {
            held_failed = true;
        }
        job.advance(KEY_COPY_LEN);
    }
    Ok(held_failed)
}

/// Where an open vault's keys stand, for Info.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    /// Files with a chunk on a key below `since`: what Finish rewrites.
    pub files_waiting: u64,
    /// Some key copies are behind the header.
    pub key_copies_due: bool,
    /// The pass after the open runs now.
    pub key_copies_updating: bool,
}

/// Where the keys of the open vault `vault_id` stand; `None` while it has no
/// open session. Reads the session's tree in RAM and nothing on disk.
pub fn vault_key_status(root: &VaultRoot, vault_id: &str) -> Result<Option<KeyStatus>> {
    let vault_dir = root.vault_dir(vault_id)?;
    let status = with_open_session(&vault_dir, |session| {
        let since = session.keys.since();
        Ok(KeyStatus {
            files_waiting: session.index.files_on_keys(|key| key < since),
            key_copies_due: session.index.key_copies_due,
            key_copies_updating: session.key_copies.is_some(),
        })
    });
    match status {
        Ok(status) => Ok(Some(status)),
        Err(UprivError::VaultNotOpen(_)) => Ok(None),
        Err(error) => Err(error),
    }
}

/// A close stops the pass running on the session of `vault_dir`.
pub(crate) fn stop_key_copies(vault_dir: &std::path::Path) {
    let _ = with_open_session(vault_dir, |session| {
        if let Some(stop) = &session.key_copies {
            stop.store(true, Ordering::Relaxed);
        }
        Ok(())
    });
}

fn log_pass_left(vault_id: &str, reason: &'static str) {
    log_event(
        LogLevel::Info,
        "vault_key_copies_waiting",
        &[("id", vault_id), ("reason", reason)],
    );
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::store::{open_store, read_prefix, KdfUnlockPreset, VaultHeader, KEY_COPY_LEN};
    use crate::test_support::{quiet_config, test_job_id, vault_root_with};
    use crate::vault::{
        change_vault_password, close_vault, create_vault, fs_held_list, fs_read_file,
        fs_write_file, open_vault,
    };

    const PW: &[u8] = b"pass-word-ok";
    const NEXT: &[u8] = b"next-pass-ok";

    fn notes() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            quiet_config("notes", "Notes"),
            PW,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"first").unwrap();
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    fn store(root: &VaultRoot) -> PathBuf {
        root.vault_store_dir("notes").unwrap()
    }

    /// Every blob of `data/` and `held/`.
    fn blobs(root: &VaultRoot) -> Vec<PathBuf> {
        let store = store(root);
        let mut found: Vec<PathBuf> = crate::store::list_blobs(&store)
            .unwrap()
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        found.extend(crate::store::held_blob_paths(&store));
        found
    }

    /// Put each blob's first `KEY_COPY_LEN` bytes back as `earlier` held them,
    /// and seal the pass due, as a pass that reached none of them leaves it.
    fn put_back_key_copies(root: &VaultRoot, password: &[u8], earlier: &[(PathBuf, Vec<u8>)]) {
        for (blob, copy) in earlier {
            let mut bytes = crate::host_fs::read(blob).unwrap();
            bytes[..copy.len()].copy_from_slice(copy);
            crate::host_fs::write(blob, &bytes).unwrap();
        }
        let mut opened = open_store(store(root), password).unwrap();
        opened.index.key_copies_due = true;
        crate::store::flush_index_parts(store(root), &opened.keys, &mut opened.index).unwrap();
    }

    fn key_copies(root: &VaultRoot) -> Vec<(PathBuf, Vec<u8>)> {
        blobs(root)
            .into_iter()
            .map(|blob| {
                let bytes = crate::host_fs::read(&blob).unwrap();
                (blob, bytes[..KEY_COPY_LEN as usize].to_vec())
            })
            .collect()
    }

    /// The blobs a header write put behind it: the keys of a new generation.
    fn behind(root: &VaultRoot) {
        let earlier = key_copies(root);
        crate::vault::change_vault_kdf(root, "notes", PW, KdfUnlockPreset::M64, &test_job_id())
            .unwrap();
        put_back_key_copies(root, PW, &earlier);
    }

    #[test]
    fn with_nothing_due_the_job_answers_at_once() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        let before = crate::test_support::dir_bytes(&store(&root));
        assert_eq!(
            update_key_copies(&root, "notes", &test_job_id()).unwrap(),
            KeyCopies::Done
        );
        assert_eq!(crate::test_support::dir_bytes(&store(&root)), before);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn the_key_status_reads_the_open_session_and_nothing_of_a_closed_vault() {
        let (_tmp, root) = notes();
        assert_eq!(vault_key_status(&root, "notes").unwrap(), None);
        behind(&root);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            vault_key_status(&root, "notes").unwrap(),
            Some(KeyStatus {
                files_waiting: 0,
                key_copies_due: true,
                key_copies_updating: false,
            })
        );
        update_key_copies(&root, "notes", &test_job_id()).unwrap();
        let after = vault_key_status(&root, "notes").unwrap().unwrap();
        assert!(!after.key_copies_due);
        close_vault(&root, "notes").unwrap();
        assert_eq!(vault_key_status(&root, "notes").unwrap(), None);
    }

    #[test]
    fn a_closed_vault_runs_no_pass() {
        let (_tmp, root) = notes();
        assert!(matches!(
            update_key_copies(&root, "notes", &test_job_id()),
            Err(UprivError::VaultNotOpen(_))
        ));
    }

    /// A blob whose key copy does not reach the disk in a session's pass is
    /// marked failed there, and the seal that ends the pass copies it.
    #[test]
    fn a_session_pass_whose_flush_fails_copies_the_blob_at_its_seal() {
        let (_tmp, root) = notes();
        behind(&root);
        let before = blobs(&root);
        open_vault(&root, "notes", PW).unwrap();
        crate::paths::fail_file_flushes(1);
        let done = update_key_copies(&root, "notes", &test_job_id());
        crate::paths::fail_file_flushes(0);
        assert_eq!(done.unwrap(), KeyCopies::Done);
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"first");
        close_vault(&root, "notes").unwrap();
        let after = blobs(&root);
        assert!(
            after.iter().any(|blob| !before.contains(blob)),
            "a copy was made"
        );
        let header = open_store(store(&root), PW).unwrap().header;
        for blob in &after {
            assert_eq!(read_prefix(blob).unwrap().generation, header.top.generation);
        }
    }

    /// A blob put back from an older copy of the vault is set aside by the
    /// open, turns the pass on, and carries the header's key copy once the
    /// pass ends: it keeps neither the earlier key nor the earlier cost.
    #[test]
    fn a_blob_from_an_older_copy_gets_the_headers_key_copy() {
        let (_tmp, root) = notes();
        let earlier = blobs(&root);
        let earlier_bytes: Vec<Vec<u8>> = earlier
            .iter()
            .map(|blob| crate::host_fs::read(blob).unwrap())
            .collect();
        change_vault_password(&root, "notes", PW, NEXT, false, "", &test_job_id()).unwrap();
        for (blob, bytes) in earlier.iter().zip(&earlier_bytes) {
            crate::host_fs::write(blob, bytes).unwrap();
        }
        open_vault(&root, "notes", NEXT).unwrap();
        assert!(!fs_held_list(&root, "notes").unwrap().is_empty());
        assert_eq!(
            update_key_copies(&root, "notes", &test_job_id()).unwrap(),
            KeyCopies::Done
        );
        close_vault(&root, "notes").unwrap();
        let header: VaultHeader = open_store(store(&root), NEXT).unwrap().header;
        let held = crate::store::held_blob_paths(&store(&root));
        assert!(!held.is_empty());
        for blob in held {
            let prefix = read_prefix(&blob).unwrap();
            assert_eq!(prefix.generation, header.top.generation);
            assert!(prefix.kdf.same_lock(&header.top.kdf));
        }
    }

    /// Times the pass over 10,000 blobs, with nothing due and with every key
    /// copy behind. Run with `cargo test -p upriv-core pass_cost_report --
    /// --ignored --nocapture`.
    #[test]
    #[ignore]
    fn pass_cost_report() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_dir = tmp.path().join("notes");
        let dir = vault_dir.join(crate::paths::STORE_DIR_NAME);
        crate::store::create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        for at in 0..10_000 {
            let path = format!("{at}.txt");
            let (_, made) = crate::store::write_logical_file(
                &dir,
                &opened.keys,
                &mut opened.index,
                &path,
                b"x",
            )
            .unwrap();
            made.sync_before_index(&crate::store::Records {
                keys: &opened.keys,
                index: &opened.index,
            })
            .unwrap();
        }
        crate::store::flush_index(&dir, &mut opened).unwrap();
        let kek = opened.header.top.kdf.derive_kek(PW).unwrap();
        let mut closed = ClosedStore {
            vault_dir: vault_dir.clone(),
            vault_id: "notes".into(),
            header: opened.header.clone(),
            keys: opened.keys.clone(),
            kek: kek.clone(),
            index: opened.index.clone(),
            settled: true,
        };
        let timed = |label: &str, closed: &mut ClosedStore| {
            closed.index.key_copies_due = true;
            let started = std::time::Instant::now();
            let ended = pass_closed(closed, &Job::untracked()).unwrap();
            eprintln!("{label}: {:?} ({ended:?})", started.elapsed());
        };
        timed("nothing due", &mut closed);
        let next = closed
            .keys
            .draft()
            .seal(
                closed.header.top.generation + 1,
                closed.keys.block().kdf.clone(),
                &kek,
            )
            .unwrap();
        closed.keys = next;
        timed("every key copy behind", &mut closed);
    }
}
