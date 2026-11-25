//! Rebuild a closed vault from what its blobs carry: the header from their
//! key copies, the tree from their recovery records and the vault's backup
//! zips. One job, `vault_rebuild`, offered from a failed unlock; it keeps the
//! password.
//!
//! | What is lost | What the unlock answers | What the rebuild does |
//! |---|---|---|
//! | Both index files | `vault_index_unreadable` | The tree is built from the records and the backups. |
//! | Both header files, or they are older than the blobs | `vault_header_unreadable` | The header is read back from the key copies; when an index opens with it, that is all. |
//! | Both | `vault_header_unreadable` | The header first, then the tree. |
//!
//! - A pending password change settles first, as at an open
//!   ([`settle_pending`]).
//! - A header and an index that open together leave nothing to rebuild
//!   ([`UprivError::VaultIndexReadable`]): a rebuild would lose what only
//!   that index holds.
//! - Before the tree step, a header older than one blob's key copy is not
//!   used: when the password opens that key copy, the header is read back
//!   from the key copies first; otherwise the password is an earlier one of
//!   this vault ([`UprivError::PasswordOutdated`]).
//! - The copy from before: after any header step and before the tree step, a
//!   save of `store/` as it is ([`copy_before_rebuild`]), kept until the
//!   person deletes it. When it does not fit, or fails, the rebuild goes on
//!   without it, and the result says why.
//! - The tree: each blob is named by the newer of its own record and the
//!   newest backup that names it, and the tree is sealed. No blob is moved,
//!   rewritten, or deleted. A blob nothing names, or whose path a newer file
//!   took, stays in `data/`, and the next open sets it aside in `held/`.
//!
//! A rebuilt file holds the data its record or backup names: the file as the
//! close of the last session that wrote it left it, or as the seal that made
//! it. A part that does not open marks the file on its first read.
//!
//! A job the person can stop until its seal, which refuses a stop
//! ([`Job::final_step`]). A stop leaves the store as the steps before it left
//! it: a header read back stays, and so does the copy.

use std::path::Path;

use serde::Serialize;

use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::{with_unlock_lock, Job, JobKind};
use crate::store::{
    flush_index_parts, key_copy_opens, newest_key_copy, open_index_under, restore_header,
    save_header, Kek, Keyring, RebuildSources, Unlock, VaultHeader, VaultStorage,
};

use super::backup::{copy_before_rebuild, BackupSkip, CopyBefore};
use super::closed_store::{lock_closed_vault, unlock_counted, ClosedStore};
use super::header_commit::{commit_header, next_generation, record_commit, CommitRecord};
use super::password_change::{settle_pending, SettledPending};
use super::persistence::record_store_rewritten;

/// What a rebuild put back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRebuild {
    /// The header was read back from the blobs' key copies.
    pub header_restored: bool,
    /// The tree was built again from the records and the backups. False when
    /// the header alone was lost and an index opened with it.
    pub tree_rebuilt: bool,
    /// Files placed in the tree.
    pub files: u64,
    /// Blobs left for the next open to set aside for review: one nothing
    /// names, or whose path a newer file took.
    pub set_aside: u64,
    /// The copy of `store/` written before the tree step, by its file name.
    pub copy: Option<String>,
    /// Why no copy was written before the tree step.
    pub copy_skipped: Option<BackupSkip>,
    /// The rebuilt tree holds the default storage value, and `config.toml`
    /// said another: plain text is off until the Storage change turns it on.
    pub storage_reset: bool,
}

/// Rebuild the closed vault `vault_id` from its blobs, as the job `job_id`.
pub fn rebuild_vault(
    root: &VaultRoot,
    vault_id: &str,
    password: &[u8],
    job_id: &str,
) -> Result<VaultRebuild> {
    Job::run(job_id, JobKind::Rebuild, Some(vault_id), |job| {
        lock_closed_vault(root, vault_id, |vault_dir| {
            let start = with_unlock_lock(|| {
                unlock_counted(vault_dir, password, |unlocked| {
                    start(vault_dir, vault_id, password, unlocked)
                })
            })?;
            match start {
                Start::Done(store) => finish_header_only(*store),
                Start::Tree(tree) => tree_step(root, vault_dir, vault_id, *tree, job),
            }
        })
    })
}

/// Where the rebuild goes once the password opened what it could.
enum Start {
    /// The header was read back from the key copies, and an index opened
    /// with it: written with that index, nothing else to do.
    Done(Box<ClosedStore>),
    /// The tree is lost: built again under these keys.
    Tree(Box<TreeStart>),
}

impl Start {
    fn tree(header: VaultHeader, keys: Keyring, kek: Kek, from: HeaderFrom) -> Self {
        Self::Tree(Box::new(TreeStart {
            header,
            keys,
            _kek: kek,
            from,
        }))
    }
}

/// The header a tree step seals under.
struct TreeStart {
    header: VaultHeader,
    keys: Keyring,
    /// Kept in RAM with the keys until the job ends, then wiped.
    _kek: Kek,
    /// How the header came: unless it is the one on disk, its four writes
    /// come with the tree.
    from: HeaderFrom,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HeaderFrom {
    /// The header file that opened.
    Disk,
    /// Read back from the key copies.
    KeyCopies,
    /// A pending password change settled forward.
    SettledChange,
}

/// Decide the rebuild from what the password opened, by the table of the
/// module documentation.
fn start(
    vault_dir: &Path,
    vault_id: &str,
    password: &[u8],
    unlocked: Result<Unlock>,
) -> Result<Start> {
    let store_dir = vault_dir.join(crate::paths::STORE_DIR_NAME);
    match unlocked {
        Ok(Unlock::Steady(_)) => Err(UprivError::VaultIndexReadable),
        Ok(Unlock::Pending(pending)) => match settle_pending(vault_dir, vault_id, pending)? {
            SettledPending::Settled(_) => Err(UprivError::VaultIndexReadable),
            SettledPending::IndexLost(pending) => {
                let crate::store::OpenedHeader { header, keys, kek } = *pending;
                let generation = next_generation(&store_dir, &header)?;
                let keys = keys
                    .draft()
                    .seal(generation, keys.block().kdf.clone(), &kek)?;
                let header = VaultHeader {
                    change: None,
                    top: keys.block().clone(),
                    ..header
                };
                Ok(Start::tree(header, keys, kek, HeaderFrom::SettledChange))
            }
        },
        Ok(Unlock::IndexLost(lost)) => {
            let newest = newest_key_copy(&store_dir, lost.header.content_identity)?;
            match newest {
                Some((generation, path)) if generation > lost.header.newest_generation() => {
                    // The header is older than the files: a tree sealed under
                    // it would shut the newer files out.
                    if !key_copy_opens(&path, password)? {
                        return Err(UprivError::PasswordOutdated);
                    }
                    from_key_copies(vault_dir, vault_id, password)
                }
                _ => Ok(Start::tree(
                    lost.header,
                    lost.keys,
                    lost.kek,
                    HeaderFrom::Disk,
                )),
            }
        }
        Err(UprivError::VaultHeaderUnreadable) => from_key_copies(vault_dir, vault_id, password),
        Err(error) => Err(error),
    }
}

/// The header read back from the key copies; then the open is tried again
/// with it, since an index that is still there opens under its block.
fn from_key_copies(vault_dir: &Path, vault_id: &str, password: &[u8]) -> Result<Start> {
    let store_dir = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let restored = restore_header(&store_dir, password)?;
    log_event(
        LogLevel::Warn,
        "vault_header_restored_from_key_copies",
        &[("id", vault_id)],
    );
    match open_index_under(&store_dir, &restored.keys) {
        Ok(index) => Ok(Start::Done(Box::new(ClosedStore {
            vault_dir: vault_dir.to_path_buf(),
            vault_id: vault_id.to_string(),
            header: restored.header,
            keys: restored.keys,
            kek: restored.kek,
            index,
            settled: false,
        }))),
        Err(_) => Ok(Start::tree(
            restored.header,
            restored.keys,
            restored.kek,
            HeaderFrom::KeyCopies,
        )),
    }
}

/// The header read back, with the index that opened under it: the four
/// writes commit both, with the pass due.
fn finish_header_only(mut store: ClosedStore) -> Result<VaultRebuild> {
    commit_header(
        &store.vault_dir,
        &store.vault_id,
        &store.header,
        &store.keys,
        &mut store.index,
        CommitRecord::Rewritten,
    )?;
    log_event(
        LogLevel::Warn,
        "vault_rebuilt",
        &[("id", store.vault_id.as_str()), ("tree", "kept")],
    );
    Ok(VaultRebuild {
        header_restored: true,
        tree_rebuilt: false,
        files: store
            .index
            .nodes()
            .iter()
            .filter(|node| node.as_file().is_some())
            .count() as u64,
        set_aside: 0,
        copy: None,
        copy_skipped: None,
        storage_reset: false,
    })
}

/// The tree step: the header written first when it is not on disk, so the
/// copy from before reads it; the copy; the tree from the records and the
/// backups; then the seal, with the header's four writes when it was
/// rewritten.
fn tree_step(
    root: &VaultRoot,
    vault_dir: &Path,
    vault_id: &str,
    tree: TreeStart,
    job: &Job,
) -> Result<VaultRebuild> {
    let store_dir = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let rewritten = tree.from != HeaderFrom::Disk;
    if rewritten {
        save_header(&store_dir, &tree.header)?;
        record_commit(vault_dir, vault_id, CommitRecord::Hash);
        if tree.from == HeaderFrom::SettledChange {
            super::password_change::record_password_changed(vault_dir, vault_id, None);
        }
    }
    job.ensure_running()?;
    let (copy, copy_skipped) = match copy_before_rebuild(root, vault_id, job)? {
        CopyBefore::Written(zip) => (
            zip.file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string),
            None,
        ),
        CopyBefore::Skipped(reason) => (None, Some(reason)),
    };
    let backup_zips = || super::backup::every_backup_zip_newest_first(vault_dir);
    let sources = RebuildSources {
        keys: &tree.keys,
        backup_zips: &backup_zips,
    };
    let mut rebuilt =
        crate::store::rebuild_tree(&store_dir, &sources, &mut || job.ensure_running())?;
    // A file a backup named may sit on a key the header no longer holds:
    // such a chunk has none, and reads as damaged.
    rebuilt.index.drop_keys(|id| tree.keys.contains(id));
    job.final_step()?;
    if rewritten {
        commit_header(
            vault_dir,
            vault_id,
            &tree.header,
            &tree.keys,
            &mut rebuilt.index,
            CommitRecord::Hash,
        )?;
    } else {
        flush_index_parts(&store_dir, &tree.keys, &mut rebuilt.index)?;
    }
    record_rebuild(vault_dir, vault_id, super::files_bytes(&rebuilt.index));
    let storage_reset = reset_storage_copy(vault_dir, vault_id);
    let counts = [
        ("files", rebuilt.placed),
        ("from_backups", rebuilt.from_backups),
        ("left", rebuilt.left),
        ("unnamed", rebuilt.unnamed),
    ]
    .map(|(field, count)| (field, count.to_string()));
    let mut fields = vec![("id", vault_id)];
    fields.extend(counts.iter().map(|(field, count)| (*field, count.as_str())));
    if let Some(reason) = copy_skipped {
        fields.push(("copy_skipped", reason.as_str()));
    }
    log_event(LogLevel::Warn, "vault_rebuilt", &fields);
    Ok(VaultRebuild {
        header_restored: tree.from == HeaderFrom::KeyCopies,
        tree_rebuilt: true,
        files: rebuilt.placed as u64,
        set_aside: (rebuilt.left + rebuilt.unnamed) as u64,
        copy,
        copy_skipped,
        storage_reset,
    })
}

/// A rebuilt tree holds the default storage value, so the copy in
/// `config.toml` follows before the open that comes after: a plain-text
/// vault opens encrypted until the Storage change turns plain text on again.
/// True when the copy was not the default. A copy that cannot be written
/// disagrees with the tree, and that open resets it.
fn reset_storage_copy(vault_dir: &Path, vault_id: &str) -> bool {
    let Ok(mut config) = crate::config::load_vault_config(vault_dir) else {
        return false;
    };
    if config.storage.is_default() {
        return false;
    }
    config.storage = VaultStorage::default();
    if crate::config::save_vault_config(vault_dir, &config).is_err() {
        log_event(
            LogLevel::Warn,
            "vault_storage_copy_kept",
            &[("id", vault_id)],
        );
    }
    true
}

/// The store's new hash, so the list does not read the rebuild as a crash,
/// every device's last backup dropped, and what the rebuilt tree holds. The
/// tree is sealed by then, so a failure here is logged, not returned.
fn record_rebuild(vault_dir: &Path, vault_id: &str, files_bytes: u64) {
    let store = vault_dir.join(crate::paths::STORE_DIR_NAME);
    let recorded = crate::config::load_vault_config(vault_dir).and_then(|config| {
        let hash = crate::store::content_hash_hex(&store)?;
        record_store_rewritten(
            vault_dir,
            vault_id,
            &config.vault.display_name,
            &hash,
            Some(files_bytes),
        )
    });
    if recorded.is_err() {
        log_event(
            LogLevel::Warn,
            "vault_rebuild_unrecorded",
            &[("id", vault_id)],
        );
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    #[allow(unused_imports)]
    use crate::host_fs::HostFsQuery;
    use crate::session::cancel_job;
    use crate::store::{
        open_store, KdfUnlockPreset, VaultHeader, CHUNK_SIZE, DATA_DIR_NAME, INDEX_COPY_FILE_NAME,
        INDEX_DIR_NAME, INDEX_FILE_NAME, KEY_COPY_LEN,
    };
    use crate::test_support::{backup_rows, test_job_id, vault_root_with};
    use crate::vault::{
        change_vault_kdf, change_vault_password, close_vault, create_vault, fs_delete,
        fs_held_list, fs_held_restore, fs_list_tree, fs_mkdir, fs_read_file, fs_write_file,
        list_backups, open_vault,
    };

    const PW: &[u8] = b"pass-word-ok";
    const NEXT: &[u8] = b"next-pass-ok";

    fn sample_config(id: &str, name: &str) -> crate::config::VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    fn notes() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        create_vault(
            &root,
            sample_config("notes", "Notes"),
            PW,
            KdfUnlockPreset::M32,
        )
        .unwrap();
        (tmp, root)
    }

    /// `notes` holding `a.txt`, closed.
    fn notes_with_a_file() -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"kept").unwrap();
        close_vault(&root, "notes").unwrap();
        (tmp, root)
    }

    fn store(root: &VaultRoot) -> PathBuf {
        root.vault_dir("notes")
            .unwrap()
            .join(crate::paths::STORE_DIR_NAME)
    }

    /// Both index files replaced by bytes that do not open.
    fn lose_index(root: &VaultRoot) {
        let index = store(root).join(INDEX_DIR_NAME);
        crate::host_fs::write(index.join(INDEX_FILE_NAME), b"torn primary").unwrap();
        crate::host_fs::write(index.join(INDEX_COPY_FILE_NAME), b"torn copy").unwrap();
    }

    /// Both header files gone.
    fn lose_header(root: &VaultRoot) {
        crate::host_fs::remove_file(VaultHeader::path(store(root))).unwrap();
        crate::host_fs::remove_file(VaultHeader::copy_path(store(root))).unwrap();
    }

    /// The bytes of both header files.
    fn header_files(root: &VaultRoot) -> [Vec<u8>; 2] {
        [
            crate::host_fs::read(VaultHeader::path(store(root))).unwrap(),
            crate::host_fs::read(VaultHeader::copy_path(store(root))).unwrap(),
        ]
    }

    fn blob_of(root: &VaultRoot, path: &str) -> PathBuf {
        let opened = open_store(store(root), PW).unwrap();
        let (file_id, _, _) = opened.index.find(path).unwrap().as_file().unwrap();
        crate::store::blob_path(store(root), file_id).unwrap()
    }

    fn rebuild_now(root: &VaultRoot, password: &[u8]) -> Result<VaultRebuild> {
        rebuild_vault(root, "notes", password, &test_job_id())
    }

    fn saves(root: &VaultRoot) -> usize {
        list_backups(root, "notes")
            .unwrap()
            .iter()
            .filter(|backup| backup.saved)
            .count()
    }

    fn reads(root: &VaultRoot, password: &[u8], path: &str, body: &[u8]) {
        open_vault(root, "notes", password).unwrap();
        assert_eq!(fs_read_file(root, "notes", path).unwrap(), body);
        close_vault(root, "notes").unwrap();
    }

    #[test]
    fn a_lost_index_is_rebuilt_from_the_records_of_its_blobs() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/docs").unwrap();
        fs_mkdir(&root, "notes", "/docs/deep").unwrap();
        fs_mkdir(&root, "notes", "/empty").unwrap();
        let big: Vec<u8> = (0..CHUNK_SIZE as usize * 2 + 7).map(|n| n as u8).collect();
        fs_write_file(&root, "notes", "/docs/a.txt", b"first").unwrap();
        fs_write_file(&root, "notes", "/docs/deep/big.bin", &big).unwrap();
        fs_write_file(&root, "notes", "/b.txt", b"second").unwrap();
        close_vault(&root, "notes").unwrap();
        let saves_before = saves(&root);
        lose_index(&root);

        assert!(matches!(
            open_vault(&root, "notes", PW),
            Err(UprivError::VaultIndexUnreadable { .. })
        ));
        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert!(rebuilt.tree_rebuilt);
        assert!(!rebuilt.header_restored);
        assert_eq!(rebuilt.set_aside, 0);
        assert!(rebuilt.files >= 3);
        assert!(rebuilt.copy.is_some());
        assert_eq!(
            saves(&root),
            saves_before + 1,
            "the copy from before is a save"
        );

        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/docs/a.txt").unwrap(),
            b"first"
        );
        assert_eq!(
            fs_read_file(&root, "notes", "/docs/deep/big.bin").unwrap(),
            big
        );
        assert_eq!(fs_read_file(&root, "notes", "/b.txt").unwrap(), b"second");
        // An empty folder has no blob, so no record.
        let tree = fs_list_tree(&root, "notes").unwrap();
        let top = tree.children.unwrap_or_default();
        assert!(top.iter().any(|child| child.name == "docs"));
        assert!(!top.iter().any(|child| child.name == "empty"));
        assert!(fs_held_list(&root, "notes").unwrap().is_empty());
        close_vault(&root, "notes").unwrap();
    }

    /// The rebuilt tree is encrypted; the copy follows it, so the open after
    /// the rebuild agrees and writes no plain text.
    #[test]
    fn a_rebuilt_tree_of_a_plain_text_vault_is_encrypted_and_its_copy_follows() {
        use crate::store::{VaultPlainFiles, VaultStorageMode};
        let (_tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        config.storage = VaultStorage {
            mode: VaultStorageMode::UprivPlain,
            plain_files: VaultPlainFiles::Whole,
        };
        create_vault(&root, config, PW, KdfUnlockPreset::M32).unwrap();
        lose_index(&root);

        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert!(rebuilt.tree_rebuilt);
        assert!(rebuilt.storage_reset);
        assert_eq!(
            open_store(store(&root), PW).unwrap().index.storage,
            VaultStorage::default()
        );
        let dir = root.vault_dir("notes").unwrap();
        let copy = crate::config::load_vault_config(&dir).unwrap().storage;
        assert_eq!(copy, VaultStorage::default());
        let opened = open_vault(&root, "notes", PW).unwrap();
        assert_eq!(opened.storage_reset, None);
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_rebuilt_tree_of_an_encrypted_vault_resets_nothing() {
        let (_tmp, root) = notes_with_a_file();
        lose_index(&root);
        assert!(!rebuild_now(&root, PW).unwrap().storage_reset);
    }

    #[test]
    fn a_lost_index_lists_as_recovery_until_it_is_rebuilt() {
        let session = |root: &VaultRoot| {
            crate::vault::list_vaults(root)
                .unwrap()
                .into_iter()
                .find(|item| item.id == "notes")
                .unwrap()
                .session
        };
        // Both index files torn.
        let (_tmp, root) = notes();
        lose_index(&root);
        assert_eq!(session(&root), Some("recovery"));
        rebuild_now(&root, PW).unwrap();
        assert_eq!(session(&root), None);

        // Both index files gone.
        let (_tmp, root) = notes();
        let index = store(&root).join(INDEX_DIR_NAME);
        crate::host_fs::remove_file(index.join(INDEX_FILE_NAME)).unwrap();
        crate::host_fs::remove_file(index.join(INDEX_COPY_FILE_NAME)).unwrap();
        assert_eq!(session(&root), Some("recovery"));
        rebuild_now(&root, PW).unwrap();
        assert_eq!(session(&root), None);
    }

    #[test]
    fn a_header_and_index_that_open_leave_nothing_to_rebuild() {
        let (_tmp, root) = notes();
        let before = saves(&root);
        assert!(matches!(
            rebuild_now(&root, PW),
            Err(UprivError::VaultIndexReadable)
        ));
        assert_eq!(saves(&root), before);
    }

    #[test]
    fn a_wrong_password_or_a_stop_changes_nothing() {
        let (_tmp, root) = notes();
        lose_index(&root);
        let primary = store(&root).join(INDEX_DIR_NAME).join(INDEX_FILE_NAME);
        let before = saves(&root);
        assert!(matches!(
            rebuild_now(&root, b"wrong-password"),
            Err(UprivError::WrongPassword)
        ));
        let id = test_job_id();
        cancel_job(&id).unwrap();
        assert!(matches!(
            rebuild_vault(&root, "notes", PW, &id),
            Err(UprivError::JobCancelled)
        ));
        assert_eq!(saves(&root), before);
        assert_eq!(crate::host_fs::read(&primary).unwrap(), b"torn primary");
    }

    #[test]
    fn the_newer_record_takes_a_path_and_the_older_blob_is_set_aside() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"older").unwrap();
        close_vault(&root, "notes").unwrap();
        let older = blob_of(&root, "a.txt");
        let older_bytes = crate::host_fs::read(&older).unwrap();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"newer").unwrap();
        close_vault(&root, "notes").unwrap();
        // The older version's blob, as a seal that never flushed would leave it.
        assert!(!older.host_exists());
        crate::host_fs::write(&older, &older_bytes).unwrap();
        lose_index(&root);

        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert_eq!(rebuilt.set_aside, 1);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(fs_read_file(&root, "notes", "/a.txt").unwrap(), b"newer");
        // The next open set the older one aside, named by its own record.
        let held = fs_held_list(&root, "notes").unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].file.as_ref().unwrap().path, "/a.txt");
        let (restored, _) =
            fs_held_restore(&root, "notes", std::slice::from_ref(&held[0].name)).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", &restored[0]).unwrap(),
            b"older"
        );
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_file_where_a_newer_file_stands_on_its_folder_is_set_aside() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/x").unwrap();
        fs_write_file(&root, "notes", "/x/y.txt", b"under a folder").unwrap();
        close_vault(&root, "notes").unwrap();
        let under = blob_of(&root, "x/y.txt");
        let under_bytes = crate::host_fs::read(&under).unwrap();
        open_vault(&root, "notes", PW).unwrap();
        fs_delete(&root, "notes", "/x").unwrap();
        fs_write_file(&root, "notes", "/x", b"a file now").unwrap();
        close_vault(&root, "notes").unwrap();
        crate::host_fs::write(&under, &under_bytes).unwrap();
        lose_index(&root);

        assert_eq!(rebuild_now(&root, PW).unwrap().set_aside, 1);
        reads(&root, PW, "/x", b"a file now");
    }

    /// Cut the records off the blob of the one-chunk file `path`, as a blob
    /// no record was ever written for.
    fn strip_records(root: &VaultRoot, path: &str) {
        let opened = open_store(store(root), PW).unwrap();
        let node = opened.index.find(path).unwrap();
        let (file_id, size, _) = node.as_file().unwrap();
        // Its one chunk: the 24-byte nonce, the bytes, and the 16-byte tag.
        let chunk_end = node.chunk_offsets().unwrap()[0] + 24 + size + 16;
        let blob = crate::store::blob_path(store(root), file_id).unwrap();
        let bytes = crate::host_fs::read(&blob).unwrap();
        assert!(bytes.len() as u64 > chunk_end, "the blob carries a record");
        crate::host_fs::write(&blob, &bytes[..chunk_end as usize]).unwrap();
    }

    #[test]
    fn a_blob_with_no_record_comes_back_from_the_newest_backup() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/docs").unwrap();
        fs_write_file(&root, "notes", "/docs/a.txt", b"named by a backup").unwrap();
        close_vault(&root, "notes").unwrap();
        strip_records(&root, "docs/a.txt");
        lose_index(&root);

        assert_eq!(rebuild_now(&root, PW).unwrap().set_aside, 0);
        reads(&root, PW, "/docs/a.txt", b"named by a backup");
    }

    #[test]
    fn a_file_renamed_since_its_record_takes_its_name_from_the_backup() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/before.txt", b"one body, two names").unwrap();
        close_vault(&root, "notes").unwrap();
        // A rename writes no record; the close's backup names it anew.
        open_vault(&root, "notes", PW).unwrap();
        crate::vault::fs_rename(&root, "notes", "/before.txt", "after.txt").unwrap();
        close_vault(&root, "notes").unwrap();
        lose_index(&root);

        rebuild_now(&root, PW).unwrap();
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/after.txt").unwrap(),
            b"one body, two names"
        );
        assert!(fs_read_file(&root, "notes", "/before.txt").is_err());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn a_blob_with_no_record_or_a_cut_tail_still_comes_through() {
        let (_tmp, root) = notes();
        open_vault(&root, "notes", PW).unwrap();
        fs_write_file(&root, "notes", "/a.txt", b"its record is behind a cut").unwrap();
        close_vault(&root, "notes").unwrap();
        // An append a crash cut short.
        let blob = blob_of(&root, "a.txt");
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        bytes.extend_from_slice(&[0x5a; 300]);
        crate::host_fs::write(&blob, &bytes).unwrap();
        // A blob nothing names: no record opens.
        let stray = store(&root)
            .join(DATA_DIR_NAME)
            .join("ab")
            .join("ab000000-0000-4000-8000-000000000001.blob");
        crate::host_fs::create_dir_all(stray.parent().unwrap()).unwrap();
        crate::host_fs::write(&stray, [7u8; 200]).unwrap();
        lose_index(&root);

        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert_eq!(rebuilt.set_aside, 1);
        open_vault(&root, "notes", PW).unwrap();
        assert_eq!(
            fs_read_file(&root, "notes", "/a.txt").unwrap(),
            b"its record is behind a cut"
        );
        let held = fs_held_list(&root, "notes").unwrap();
        assert_eq!(held.len(), 1);
        assert!(held[0].file.is_none());
        close_vault(&root, "notes").unwrap();
    }

    #[test]
    fn records_survive_a_password_change() {
        let (_tmp, root) = notes_with_a_file();
        change_vault_password(&root, "notes", PW, NEXT, false, "", &test_job_id()).unwrap();
        lose_index(&root);

        rebuild_now(&root, NEXT).unwrap();
        reads(&root, NEXT, "/a.txt", b"kept");
    }

    #[test]
    fn the_save_count_goes_on_past_every_record() {
        let (_tmp, root) = notes_with_a_file();
        let blob = blob_of(&root, "a.txt");
        lose_index(&root);
        rebuild_now(&root, PW).unwrap();

        let opened = open_store(store(&root), PW).unwrap();
        let (file_id, _, _) = opened.index.find("a.txt").unwrap().as_file().unwrap();
        let record = crate::store::read_record(&blob, file_id, &opened.keys, false).unwrap();
        // Records written from now on are newer than any the rebuild read.
        assert!(opened.index.saves > record.save);
    }

    #[test]
    fn a_drive_with_no_room_for_the_copy_still_rebuilds_and_says_why() {
        let (_tmp, root) = notes_with_a_file();
        lose_index(&root);
        let saves_dir = root.vault_dir("notes").unwrap().join("backups");
        let Some(available) = crate::host_fs::free_bytes(&saves_dir) else {
            return;
        };
        // A sparse file the copy would have to hold whole.
        let filler = store(&root).join("filler.bin");
        let file = std::fs::File::create(&filler).unwrap();
        if file.set_len(available.saturating_add(1 << 30)).is_err() {
            return;
        }
        drop(file);
        let before = saves(&root);
        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert_eq!(rebuilt.copy, None);
        assert_eq!(rebuilt.copy_skipped, Some(BackupSkip::NoRoom));
        assert!(rebuilt.tree_rebuilt);
        assert_eq!(saves(&root), before);
        crate::host_fs::remove_file(&filler).unwrap();
        reads(&root, PW, "/a.txt", b"kept");
    }

    /// A vault `notes` whose backups go to its own row in `drive`.
    fn notes_backing_up_to(drive: &std::path::Path) -> (tempfile::TempDir, VaultRoot) {
        let (tmp, root) = vault_root_with(&[]);
        let mut config = sample_config("notes", "Notes");
        backup_rows(&mut config, &[drive]);
        create_vault(&root, config, PW, KdfUnlockPreset::M32).unwrap();
        (tmp, root)
    }

    #[test]
    fn a_blob_with_no_record_comes_back_from_a_backup_in_a_row() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = notes_backing_up_to(drive.path());
        open_vault(&root, "notes", PW).unwrap();
        fs_mkdir(&root, "notes", "/docs").unwrap();
        fs_write_file(&root, "notes", "/docs/a.txt", b"named on the drive").unwrap();
        close_vault(&root, "notes").unwrap();
        strip_records(&root, "docs/a.txt");
        lose_index(&root);

        assert_eq!(rebuild_now(&root, PW).unwrap().set_aside, 0);
        reads(&root, PW, "/docs/a.txt", b"named on the drive");
    }

    #[test]
    fn the_copy_before_a_rebuild_stays_in_the_data_folder_as_a_save() {
        let drive = tempfile::tempdir().unwrap();
        let (_tmp, root) = notes_backing_up_to(drive.path());
        lose_index(&root);

        rebuild_now(&root, PW).unwrap();

        let copies: Vec<_> = list_backups(&root, "notes")
            .unwrap()
            .into_iter()
            .filter(|backup| backup.saved)
            .collect();
        assert_eq!(copies.len(), 1);
        assert!(copies[0].key.starts_with("data/"));
        assert!(copies[0].path.host_is_file());
    }

    #[test]
    fn a_lost_header_comes_back_from_the_key_copies() {
        let (_tmp, root) = notes_with_a_file();
        let generation = open_store(store(&root), PW).unwrap().header.top.generation;
        lose_header(&root);
        assert!(matches!(
            open_vault(&root, "notes", PW),
            Err(UprivError::VaultHeaderUnreadable)
        ));
        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert!(rebuilt.header_restored);
        assert!(!rebuilt.tree_rebuilt, "the index opens under it");
        assert!(!rebuilt.storage_reset);
        let opened = open_store(store(&root), PW).unwrap();
        assert!(opened.header.top.generation > generation);
        assert!(opened.index.key_copies_due);
        drop(opened);
        reads(&root, PW, "/a.txt", b"kept");
    }

    #[test]
    fn a_lost_header_and_index_come_back_header_first() {
        let (_tmp, root) = notes_with_a_file();
        lose_header(&root);
        lose_index(&root);
        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert!(rebuilt.header_restored);
        assert!(rebuilt.tree_rebuilt);
        // The copy from before holds the header read back, so it opens.
        assert!(rebuilt.copy.is_some());
        reads(&root, PW, "/a.txt", b"kept");
    }

    #[test]
    fn no_key_copy_the_password_opens_is_a_wrong_password() {
        let (_tmp, root) = notes_with_a_file();
        lose_header(&root);
        assert!(matches!(
            rebuild_now(&root, b"wrong-password"),
            Err(UprivError::WrongPassword)
        ));
        assert!(!VaultHeader::path(store(&root)).host_exists());
    }

    #[test]
    fn the_header_comes_back_with_the_unlock_ram_chosen_last() {
        let (_tmp, root) = notes_with_a_file();
        let blob = blob_of(&root, "a.txt");
        let earlier = crate::host_fs::read(&blob).unwrap()[..KEY_COPY_LEN as usize].to_vec();
        change_vault_kdf(&root, "notes", PW, KdfUnlockPreset::M64, &test_job_id()).unwrap();
        // A pass that did not reach this blob: its key copy is the earlier cost.
        let mut bytes = crate::host_fs::read(&blob).unwrap();
        bytes[..KEY_COPY_LEN as usize].copy_from_slice(&earlier);
        crate::host_fs::write(&blob, &bytes).unwrap();
        lose_header(&root);

        rebuild_now(&root, PW).unwrap();
        assert_eq!(
            crate::store::probe_unlock_preset(store(&root)),
            Some(KdfUnlockPreset::M64)
        );
        reads(&root, PW, "/a.txt", b"kept");
    }

    #[test]
    fn a_header_from_before_an_unlock_ram_change_is_read_back_from_the_files() {
        let (_tmp, root) = notes_with_a_file();
        let [earlier, _] = header_files(&root);
        change_vault_kdf(&root, "notes", PW, KdfUnlockPreset::M64, &test_job_id()).unwrap();
        crate::host_fs::write(VaultHeader::path(store(&root)), &earlier).unwrap();
        crate::host_fs::remove_file(VaultHeader::copy_path(store(&root))).unwrap();

        assert!(matches!(
            open_vault(&root, "notes", PW),
            Err(UprivError::VaultHeaderUnreadable)
        ));
        let rebuilt = rebuild_now(&root, PW).unwrap();
        assert!(rebuilt.header_restored);
        assert_eq!(
            crate::store::probe_unlock_preset(store(&root)),
            Some(KdfUnlockPreset::M64)
        );
        reads(&root, PW, "/a.txt", b"kept");
    }

    #[test]
    fn a_header_from_before_a_password_change_is_an_earlier_password() {
        let (_tmp, root) = notes_with_a_file();
        let [earlier, earlier_copy] = header_files(&root);
        change_vault_password(&root, "notes", PW, NEXT, false, "", &test_job_id()).unwrap();

        // One file put back: the old password is an earlier one, and the
        // current one repairs it.
        crate::host_fs::write(VaultHeader::path(store(&root)), &earlier).unwrap();
        let written = crate::test_support::dir_bytes(&store(&root));
        assert!(matches!(
            open_vault(&root, "notes", PW),
            Err(UprivError::PasswordOutdated)
        ));
        assert_eq!(crate::test_support::dir_bytes(&store(&root)), written);
        reads(&root, NEXT, "/a.txt", b"kept");
        assert_ne!(
            crate::host_fs::read(VaultHeader::path(store(&root))).unwrap(),
            earlier
        );

        // Both put back: the current password reads the header back from the
        // files; the old one is refused and seals nothing.
        crate::host_fs::write(VaultHeader::path(store(&root)), &earlier).unwrap();
        crate::host_fs::write(VaultHeader::copy_path(store(&root)), &earlier_copy).unwrap();
        lose_index(&root);
        let written = crate::test_support::dir_bytes(&store(&root));
        assert!(matches!(
            rebuild_now(&root, PW),
            Err(UprivError::PasswordOutdated)
        ));
        assert_eq!(crate::test_support::dir_bytes(&store(&root)), written);
        assert!(matches!(
            open_vault(&root, "notes", NEXT),
            Err(UprivError::VaultHeaderUnreadable)
        ));
        let rebuilt = rebuild_now(&root, NEXT).unwrap();
        assert!(rebuilt.header_restored);
        reads(&root, NEXT, "/a.txt", b"kept");
    }
}
