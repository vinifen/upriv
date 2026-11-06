//! Blobs no file of the tree names.
//!
//! The unlock that starts a session, and the one before a password or
//! unlock-RAM change, walks `data/` once and matches it with the index:
//!
//! - a file whose blob is gone is marked [`FileProblem::Missing`], and loses
//!   the mark once the blob is back;
//! - a blob no file names moves to the vault's `held/` folder, beside
//!   `store/`, and the index records it ([`HeldBlob`]). It may hold the newest
//!   bytes of a file whose index never reached the disk, so only the person
//!   deletes it. A blob too short to hold one chunk holds nothing and is
//!   deleted, and so is a link or anything else named as a blob that is not
//!   a plain file;
//! - a blob the index lists as released ([`VaultIndex::released`]) stays in
//!   `data/`: an old version a seal let go of before its folder flushed, which
//!   the session's first seal that flushes deletes. When the other index file
//!   names it, it holds that tree's bytes and is held like any other;
//! - a held blob the tree names again goes back to `data/`.
//!
//! A newly held blob is matched with the indexes this vault still has: the
//! other index file when it holds another tree, then each backup zip, newest
//! first. The first file naming its id whose first chunk opens from it is the
//! file it holds. A blob that holds an internal file of the app is deleted.
//! Chunk AAD binds a version only an index records, so a blob no index names
//! cannot be read: it stays an unnamed piece until the person deletes it.
//! Backups and store zips copy `store/` only, so they leave `held/` out. The
//! folder is removed once nothing is in it ([`remove_empty_held`]).

#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::aead::{CONTENT_KEY_LEN, INDEX_KEY_LEN};
use super::chunk::{blob_path, first_chunk_opens, StagedBlobs, BLOB_FILE_SUFFIX, MIN_BLOB_LEN};
use super::header::{parse_header_bytes, VaultHeader, HEADER_DIR_NAME, HEADER_FILE_NAME};
use super::index::{
    open_sealed_index, FileProblem, HeldBlob, VaultIndex, VaultNode, DATA_DIR_NAME, INDEX_DIR_NAME,
    INDEX_FILE_NAME,
};
use super::tree::{
    child_logical_path, file_name, is_reserved_logical, mkdir_logical, parent_logical,
    unique_file_name,
};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::paths::{HELD_DIR_NAME, STORE_DIR_NAME};

/// Largest header a backup zip may hand the match.
const MAX_SOURCE_HEADER_BYTES: u64 = 64 * 1024;
/// Largest index a backup zip may hand the match.
const MAX_SOURCE_INDEX_BYTES: u64 = 256 * 1024 * 1024;

/// The vault's `held/` folder, beside `store_dir`.
pub(crate) fn held_dir(store_dir: &Path) -> PathBuf {
    store_dir.parent().unwrap_or(store_dir).join(HELD_DIR_NAME)
}

/// What an unlock can read to tell which file a held blob holds.
pub(crate) struct HeldSources<'a> {
    /// The tree in the index copy when that file holds another one.
    pub other_copy: Option<&'a VaultIndex>,
    /// This vault's backup zips, newest first. Listed and read only while a
    /// newly held blob is still unknown.
    pub backup_zips: &'a dyn Fn() -> Vec<PathBuf>,
}

/// Match `data/` and `held/` with `index`, as the module documentation says.
/// Every change lands in `index` (marks, held records, the released list).
/// True when the held records or the released list changed, so the caller
/// seals them at once. A folder that cannot be listed leaves what it holds as
/// it is: an absence it did not see proves nothing.
pub(crate) fn settle_held(
    store_dir: &Path,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index_key: &[u8; INDEX_KEY_LEN],
    index: &mut VaultIndex,
    sources: HeldSources<'_>,
) -> bool {
    // A released id the other index file names holds that tree's bytes (a
    // file emptied and written again keeps its id): it is set aside and named
    // like any blob that tree alone names, never deleted as an old version.
    let released = index.released.len();
    if let Some(copy) = sources.other_copy {
        let named: HashSet<&str> = copy
            .nodes()
            .iter()
            .filter_map(VaultNode::as_file)
            .filter(|(_, size, _)| *size > 0)
            .map(|(file_id, _, _)| file_id)
            .collect();
        index
            .released
            .retain(|file_id| !named.contains(file_id.as_str()));
    }
    let unreleased = index.released.len() != released;
    let held = held_dir(store_dir);
    let mut held_files = list_held(&held);
    let opens = |blob: &Path, node: &VaultNode| first_chunk_opens(blob, header, content_key, node);
    let moved = walk_data(store_dir, &held, index, held_files.as_mut(), &opens);
    let Some(held_files) = held_files else {
        return unreleased;
    };
    let recorded = index.held.len();
    index.held.retain(|entry| held_files.contains(&entry.name));
    let dropped = index.held.len() != recorded || unreleased;
    let mut unknown: Vec<&String> = held_files
        .iter()
        .filter(|name| !index.held.iter().any(|entry| &entry.name == *name))
        .collect();
    let changed = if unknown.is_empty() {
        dropped
    } else {
        unknown.sort();
        let unknown: Vec<String> = unknown.into_iter().cloned().collect();
        let (added, named) = name_held(
            &held,
            header,
            content_key,
            index_key,
            index,
            unknown,
            sources,
        );
        let id = vault_id_of(store_dir);
        let moved = moved.to_string();
        let named = named.to_string();
        log_event(
            LogLevel::Warn,
            "vault_blobs_held",
            &[
                ("id", id.as_str()),
                ("moved", moved.as_str()),
                ("named", named.as_str()),
            ],
        );
        dropped || added > 0
    };
    // Every blob may have gone back to `data/`, or been an app file deleted.
    remove_empty_held(store_dir);
    changed
}

/// Remove the `held/` folder of the store at `store_dir` once nothing is in
/// it: the last item went back or was deleted. A folder that still holds
/// anything, a blob or a file another app left, stays: removing a folder
/// refuses one that is not empty, on every system.
pub(crate) fn remove_empty_held(store_dir: &Path) {
    let _ = crate::host_fs::remove_dir(held_dir(store_dir));
}

/// The held blob names in `held/` ([`held_blob_id`]). Anything else there,
/// such as a file an OS file manager left, is not the vault's and is left
/// alone. An empty set when the folder is not there; `None` when it cannot
/// be listed in full.
fn list_held(held: &Path) -> Option<HashSet<String>> {
    let entries = match crate::host_fs::read_dir(held) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Some(HashSet::new());
        }
        Err(_) => return None,
    };
    let mut names = HashSet::new();
    for entry in entries {
        let entry = entry.ok()?;
        if let Some(name) = entry.file_name().to_str() {
            if held_blob_id(name).is_some() {
                names.insert(name.to_string());
            }
        }
    }
    Some(names)
}

/// Bytes the held blobs of the store at `store_dir` take on disk: the files
/// [`list_held`] names, so anything else left in `held/` is not counted.
/// Nothing when `held/` is not there.
pub(crate) fn held_disk_bytes(store_dir: &Path) -> Result<u64> {
    let entries = match crate::host_fs::read_dir(held_dir(store_dir)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };
    let mut total: u64 = 0;
    for entry in entries {
        let entry = entry?;
        let named = entry
            .file_name()
            .to_str()
            .is_some_and(|name| held_blob_id(name).is_some());
        let file_type = entry.file_type()?;
        if !named || file_type.is_symlink() || !file_type.host_is_file() {
            continue;
        }
        let len = match entry.known_len() {
            Some(len) => len,
            None => {
                // Length from lstat. A link swapped in after the type check is skipped.
                let meta = crate::host_fs::symlink_metadata(entry.path())?;
                if meta.file_type().is_symlink() || !meta.host_is_file() {
                    continue;
                }
                meta.len()
            }
        };
        total = total.saturating_add(len);
    }
    Ok(total)
}

/// The blob id a held file name carries: `<id>.blob`, or `<id>.<n>.blob` when
/// that name was taken.
fn held_blob_id(name: &str) -> Option<Uuid> {
    let stem = name.strip_suffix(BLOB_FILE_SUFFIX)?;
    let id = stem.split_once('.').map_or(stem, |(id, _)| id);
    Uuid::parse_str(id).ok()
}

/// The name a blob of `id` takes in `held/`. A record whose file is gone keeps
/// its name, so a blob that went back to `data/` before its seal landed comes
/// back to the record that still names it.
fn held_name_for(id: Uuid, held_files: &HashSet<String>, index: &VaultIndex) -> String {
    if let Some(entry) = index
        .held
        .iter()
        .find(|entry| held_blob_id(&entry.name) == Some(id) && !held_files.contains(&entry.name))
    {
        return entry.name.clone();
    }
    let first = format!("{id}{BLOB_FILE_SUFFIX}");
    if !held_files.contains(&first) {
        return first;
    }
    (2u32..)
        .map(|n| format!("{id}.{n}{BLOB_FILE_SUFFIX}"))
        .find(|name| !held_files.contains(name))
        .unwrap_or(first)
}

/// What one shard folder of `data/` holds.
#[derive(Default)]
struct DataWalk {
    /// Blobs the tree names.
    present: HashSet<Uuid>,
    /// Blobs no file names.
    unnamed: Vec<(Uuid, PathBuf)>,
    /// Anything else, deleted.
    stray: Vec<PathBuf>,
    /// Shards that could not be listed in full.
    unlisted: HashSet<String>,
}

/// Walk `data/`: mark files whose blob is gone, take back held blobs the tree
/// names, and move blobs no file names to `held/`. `held_files` is `None`
/// when `held/` could not be listed: then nothing moves either way. `opens`
/// says whether a blob's first chunk opens as a file's ([`take_back`]).
/// Returns how many blobs moved to `held/`.
fn walk_data(
    store_dir: &Path,
    held: &Path,
    index: &mut VaultIndex,
    mut held_files: Option<&mut HashSet<String>>,
    opens: &dyn Fn(&Path, &VaultNode) -> bool,
) -> usize {
    // A released blob stays in `data/` for the session's first seal that
    // flushes, which deletes it: it is an old version, not data to review.
    let referenced: HashSet<Uuid> = index
        .nodes()
        .iter()
        .filter_map(|node| node.as_file())
        .map(|(file_id, _, _)| file_id)
        .chain(index.released.iter().map(String::as_str))
        .filter_map(|file_id| Uuid::parse_str(file_id).ok())
        .collect();
    let mut walk = DataWalk::default();
    match crate::host_fs::read_dir(store_dir.join(DATA_DIR_NAME)) {
        Ok(entries) => {
            for entry in entries {
                let Ok(entry) = entry else {
                    // An entry that cannot be read could be any shard.
                    return 0;
                };
                let Some(shard) = blob_shard_name(&entry) else {
                    continue;
                };
                if !list_shard(&entry.path(), &referenced, &mut walk) {
                    walk.unlisted.insert(shard);
                }
            }
        }
        // No `data/` at all: every blob is gone.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return 0,
    }
    for path in &walk.stray {
        let _ = crate::host_fs::remove_file(path);
    }
    // Every move is flushed before the seal that records it.
    let mut moves = StagedBlobs::default();
    let mut moved = 0;
    if let Some(held_files) = held_files.as_deref_mut() {
        moved = hold_unnamed(held, &walk.unnamed, held_files, index, &mut moves);
    }
    index.mark_files(|node| {
        // An empty file has no blob.
        let Some((file_id, size, _)) = node.as_file() else {
            return node.problem;
        };
        let Ok(id) = Uuid::parse_str(file_id) else {
            return node.problem;
        };
        if size == 0 || walk.unlisted.contains(&id.simple().to_string()[..2]) {
            return node.problem;
        }
        let present = walk.present.contains(&id)
            || held_files.as_deref_mut().is_some_and(|held_files| {
                take_back(store_dir, held, node, held_files, &mut moves, opens)
            });
        match node.problem {
            _ if !present => Some(FileProblem::Missing),
            Some(FileProblem::Missing) => None,
            kept => kept,
        }
    });
    // Not tried again: the next unlock walks both folders anew.
    if moves.sync().is_err() {
        log_event(
            LogLevel::Warn,
            "vault_held_unflushed",
            &[("id", vault_id_of(store_dir).as_str())],
        );
    }
    moved
}

/// The two hex digits of a shard folder under `data/`, lowercase.
fn blob_shard_name(entry: &crate::host_fs::DirEntry) -> Option<String> {
    let name = entry.file_name();
    let name = name.to_str()?;
    (name.len() == 2 && name.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| name.to_ascii_lowercase())
}

/// Sort what one shard folder holds into `walk`. False when the folder could
/// not be listed in full. Only a blob no file names is measured.
fn list_shard(shard: &Path, referenced: &HashSet<Uuid>, walk: &mut DataWalk) -> bool {
    let Ok(children) = crate::host_fs::read_dir(shard) else {
        return false;
    };
    let mut complete = true;
    for child in children {
        let Ok(child) = child else {
            complete = false;
            continue;
        };
        let file_name = child.file_name();
        let Some(id) = file_name
            .to_str()
            .and_then(|name| name.strip_suffix(BLOB_FILE_SUFFIX))
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            continue;
        };
        if referenced.contains(&id) {
            walk.present.insert(id);
            continue;
        }
        let path = child.path();
        // `remove_file` on a link removes the link, not its target.
        match crate::host_fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() && meta.len() >= MIN_BLOB_LEN => {
                walk.unnamed.push((id, path));
            }
            Ok(_) => walk.stray.push(path),
            Err(_) => complete = false,
        }
    }
    complete
}

/// Move each blob no file names into `held/`, and stage `held/` in `moves`.
/// One that cannot move stays in `data/` for the next unlock.
fn hold_unnamed(
    held: &Path,
    unnamed: &[(Uuid, PathBuf)],
    held_files: &mut HashSet<String>,
    index: &VaultIndex,
    moves: &mut StagedBlobs,
) -> usize {
    if unnamed.is_empty() || crate::host_fs::create_dir_all(held).is_err() {
        return 0;
    }
    let mut moved = 0;
    for (id, path) in unnamed {
        let name = held_name_for(*id, held_files, index);
        let target = held.join(&name);
        if crate::host_fs::rename_no_replace(path, &target).is_ok() {
            moves.add_moved(&target);
            held_files.insert(name);
            moved += 1;
        }
    }
    moved
}

/// Put a held blob of the file `node` back into `data/` when the tree names
/// it again, and stage its shard folder in `moves`. True when it is there now.
///
/// More than one held blob may carry its id (`<id>.blob`, `<id>.2.blob`, …):
/// a file emptied and written again keeps its id. Then the one whose first
/// chunk `opens` as this file's goes back, since that chunk binds a version
/// only this write had. When none opens, the first by number goes back, so
/// the file reads as damaged and its other chunks stay readable; the rest
/// stay held.
fn take_back(
    store_dir: &Path,
    held: &Path,
    node: &VaultNode,
    held_files: &mut HashSet<String>,
    moves: &mut StagedBlobs,
    opens: &dyn Fn(&Path, &VaultNode) -> bool,
) -> bool {
    let Some(id) = node
        .as_file()
        .and_then(|(file_id, _, _)| Uuid::parse_str(file_id).ok())
    else {
        return false;
    };
    let mut carriers: Vec<&String> = held_files
        .iter()
        .filter(|name| held_blob_id(name) == Some(id))
        .collect();
    carriers.sort_by_key(|name| held_number(name));
    let name = match carriers.as_slice() {
        [] => return false,
        [only] => (*only).clone(),
        [first, ..] => carriers
            .iter()
            .find(|name| opens(&held.join(name.as_str()), node))
            .unwrap_or(first)
            .to_string(),
    };
    let Ok(target) = blob_path(store_dir, &id.to_string()) else {
        return false;
    };
    let moved = target
        .parent()
        .is_some_and(|shard| crate::host_fs::create_dir_all(shard).is_ok())
        && crate::host_fs::rename_no_replace(held.join(&name), &target).is_ok();
    if moved {
        moves.add_moved(&target);
        held_files.remove(&name);
    }
    moved
}

/// The number a held blob name carries: 1 for `<id>.blob`, `n` for
/// `<id>.<n>.blob`, in the order [`held_name_for`] gives them.
fn held_number(name: &str) -> u32 {
    name.strip_suffix(BLOB_FILE_SUFFIX)
        .and_then(|stem| stem.split_once('.'))
        .and_then(|(_, number)| number.parse().ok())
        .unwrap_or(1)
}

/// Record each of the `unknown` held files in `index`, with the file it holds
/// when an index of this vault names it. Returns how many were recorded, and
/// how many of those hold a file.
fn name_held(
    held: &Path,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index_key: &[u8; INDEX_KEY_LEN],
    index: &mut VaultIndex,
    unknown: Vec<String>,
    sources: HeldSources<'_>,
) -> (usize, usize) {
    let mut open: Vec<(String, Option<Uuid>, Option<VaultNode>)> = unknown
        .into_iter()
        .map(|name| {
            let id = held_blob_id(&name);
            (name, id, None)
        })
        .collect();
    let mut match_with = |source: &VaultIndex| {
        let by_id: HashMap<Uuid, &VaultNode> = source
            .nodes()
            .iter()
            .filter_map(|node| {
                let (file_id, size, _) = node.as_file()?;
                (size > 0).then_some(())?;
                Some((Uuid::parse_str(file_id).ok()?, node))
            })
            .collect();
        for (name, id, file) in open.iter_mut().filter(|(_, _, file)| file.is_none()) {
            let Some(&node) = id.and_then(|id| by_id.get(&id)) else {
                continue;
            };
            if first_chunk_opens(&held.join(name.as_str()), header, content_key, node) {
                *file = Some(node.clone());
            }
        }
        open.iter()
            .all(|(_, id, file)| id.is_none() || file.is_some())
    };
    let done = sources.other_copy.is_some_and(&mut match_with);
    if !done {
        for zip in (sources.backup_zips)() {
            if let Some(source) = backup_index(&zip, header, index_key) {
                if match_with(&source) {
                    break;
                }
            }
        }
    }
    let now = crate::time::unix_millis();
    let recorded = index.held.len();
    let mut named = 0;
    for (name, _, file) in open {
        let path = held.join(&name);
        if file
            .as_ref()
            .is_some_and(|file| is_reserved_logical(&file.path))
        {
            // The app's own file, such as the file-manager layout.
            let _ = crate::host_fs::remove_file(&path);
            continue;
        }
        // A folder or a link in `held/` is not a held blob.
        let Ok(meta) = crate::host_fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let file = file.map(|mut file| {
            file.problem = None;
            file
        });
        named += usize::from(file.is_some());
        index.held.push(HeldBlob {
            name,
            size: meta.len(),
            held_at: now,
            file,
        });
    }
    (index.held.len() - recorded, named)
}

/// The index of the backup zip at `zip`, when it is a copy of this vault.
fn backup_index(
    zip: &Path,
    header: &VaultHeader,
    index_key: &[u8; INDEX_KEY_LEN],
) -> Option<VaultIndex> {
    let file = crate::paths::open_nofollow(zip, crate::paths::NofollowMode::Read).ok()?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).ok()?;
    let header_name = format!("{STORE_DIR_NAME}/{HEADER_DIR_NAME}/{HEADER_FILE_NAME}");
    let index_name = format!("{STORE_DIR_NAME}/{INDEX_DIR_NAME}/{INDEX_FILE_NAME}");
    let backup_header = parse_header_bytes(&zip_entry(
        &mut archive,
        &header_name,
        MAX_SOURCE_HEADER_BYTES,
    )?)
    .ok()?;
    if backup_header.content_identity != header.content_identity {
        return None;
    }
    let sealed = zip_entry(&mut archive, &index_name, MAX_SOURCE_INDEX_BYTES)?;
    open_sealed_index(&backup_header, index_key, &sealed).ok()
}

fn zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
    max: u64,
) -> Option<Vec<u8>> {
    let entry = archive.by_name(name).ok()?;
    if entry.size() > max {
        return None;
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.take(max).read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn vault_id_of(store_dir: &Path) -> String {
    store_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_string()
}

/// A held blob put back into the tree, so a seal that fails can undo it.
#[derive(Debug)]
pub(crate) struct RestoredHeld {
    /// Its logical path in the tree.
    pub path: String,
    held_path: PathBuf,
    blob: PathBuf,
}

impl RestoredHeld {
    /// Move the blob back into `held/` after the seal that would name it in
    /// `data/` failed. The record is back with the index the caller restores.
    pub(crate) fn undo(&self) {
        let _ = crate::host_fs::rename_no_replace(&self.blob, &self.held_path);
    }
}

/// Put the held files `names` back into the tree: each blob moves into
/// `data/`, and its file comes back at its own path, or at a free name beside
/// it when that path is taken. A folder it was in that is gone is made again;
/// one that is a file now leaves it at the top of the vault. The moves are
/// flushed before this returns, so the caller's seal names blobs that are on
/// disk.
///
/// An error undoes the moves of this call; the caller restores `index`.
pub(crate) fn restore_held(
    store_dir: &Path,
    index: &mut VaultIndex,
    names: &[String],
) -> Result<Vec<RestoredHeld>> {
    let mut restored: Vec<RestoredHeld> = Vec::new();
    let moved = names.iter().try_for_each(|name| {
        restored.push(restore_one(store_dir, index, name)?);
        Ok(())
    });
    if let Err(error) = moved.and_then(|()| flush_shards(&restored)) {
        for one in &restored {
            one.undo();
        }
        return Err(error);
    }
    Ok(restored)
}

/// Flush the folders that name the restored blobs.
fn flush_shards(restored: &[RestoredHeld]) -> Result<()> {
    let mut staged = StagedBlobs::default();
    for one in restored {
        staged.add_moved(&one.blob);
    }
    staged.sync()
}

fn restore_one(store_dir: &Path, index: &mut VaultIndex, name: &str) -> Result<RestoredHeld> {
    let not_held = || UprivError::VaultHeldNotFound(name.to_string());
    let at = index
        .held
        .iter()
        .position(|entry| entry.name == name)
        .ok_or_else(not_held)?;
    let mut node = index.held[at].file.clone().ok_or_else(not_held)?;
    let (file_id, _, _) = node.as_file().ok_or_else(not_held)?;
    let blob = blob_path(store_dir, file_id)?;
    let held_path = held_dir(store_dir).join(name);
    let parent = restore_parent(index, &node.path)?;
    let base = file_name(&node.path).to_string();
    let free = unique_file_name(index, &parent, &base);
    node.path = child_logical_path(&parent, &free)?;
    if let Some(shard) = blob.parent() {
        crate::host_fs::create_dir_all(shard)?;
    }
    crate::host_fs::rename_no_replace(&held_path, &blob).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            not_held()
        } else {
            error.into()
        }
    })?;
    let path = node.path.clone();
    index.push(node);
    index.held.remove(at);
    Ok(RestoredHeld {
        path,
        held_path,
        blob,
    })
}

/// The folder a held file goes back into: the one it was in, made again where
/// it is gone, or the top of the vault when a file now stands in its way.
fn restore_parent(index: &mut VaultIndex, path: &str) -> Result<String> {
    let Some(parent) = parent_logical(path) else {
        return Ok(String::new());
    };
    let mut missing: Vec<String> = Vec::new();
    let mut prefix = String::new();
    for part in parent.split('/') {
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(part);
        match index.find(&prefix) {
            Some(node) if node.is_dir() => {}
            Some(_) => return Ok(String::new()),
            None => missing.push(prefix.clone()),
        }
    }
    for folder in missing {
        mkdir_logical(index, &folder)?;
    }
    Ok(parent.to_string())
}

/// Take the held files `names` out of `index` and delete them from `held/`.
/// A name that is not held is skipped. A file that cannot be deleted keeps its
/// record. Nothing needs a seal: a record whose file is gone is dropped by the
/// next unlock.
pub(crate) fn delete_held(
    store_dir: &Path,
    index: &mut VaultIndex,
    names: &[String],
) -> Result<()> {
    let held = held_dir(store_dir);
    let mut failed: Option<std::io::Error> = None;
    for name in names {
        let Some(at) = index.held.iter().position(|entry| &entry.name == name) else {
            continue;
        };
        match crate::host_fs::remove_file(held.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                failed.get_or_insert(error);
                continue;
            }
        }
        index.held.remove(at);
    }
    remove_empty_held(store_dir);
    match failed {
        Some(error) => Err(error.into()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::chunk::{read_logical_file, write_logical_file, write_logical_range};
    use crate::store::index::{index_copy_path, index_path};
    use crate::store::tree::INTERNAL_WORKSPACE_FILE;
    use crate::store::{create_empty_store, flush_index, open_store, KdfUnlockPreset, OpenedStore};

    const PW: &[u8] = b"held-blobs-ok";

    struct Store {
        _tmp: tempfile::TempDir,
        dir: PathBuf,
    }

    impl Store {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let dir = tmp.path().join("vault").join(STORE_DIR_NAME);
            create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
            Self { _tmp: tmp, dir }
        }

        fn open(&self) -> OpenedStore {
            open_store(&self.dir, PW).unwrap()
        }

        fn write(&self, opened: &mut OpenedStore, path: &str, body: &[u8]) {
            write_logical_file(
                &self.dir,
                &opened.header,
                &opened.content_key,
                &mut opened.index,
                path,
                body,
            )
            .unwrap();
            flush_index(&self.dir, opened).unwrap();
        }

        fn read(&self, opened: &OpenedStore, path: &str) -> Vec<u8> {
            read_logical_file(
                &self.dir,
                &opened.header,
                &opened.content_key,
                &opened.index,
                path,
            )
            .unwrap()
        }

        /// Open and settle, with `zips` as the backups.
        fn settle(&self, zips: Vec<PathBuf>) -> OpenedStore {
            let mut opened = self.open();
            let backups = move || zips.clone();
            settle_held(
                &self.dir,
                &opened.header,
                &opened.content_key,
                &opened.index_key,
                &mut opened.index,
                HeldSources {
                    other_copy: opened.other_copy.as_ref(),
                    backup_zips: &backups,
                },
            );
            opened
        }

        fn held(&self) -> PathBuf {
            held_dir(&self.dir)
        }

        fn blob_of(&self, opened: &OpenedStore, path: &str) -> PathBuf {
            let (file_id, _, _) = opened.index.find(path).unwrap().as_file().unwrap();
            blob_path(&self.dir, file_id).unwrap()
        }

        /// `a.txt` sealed, then `docs/b.txt` written by a seal whose primary
        /// index never landed: only the index copy names it. Returns its blob.
        fn seal_cut_after_copy(&self) -> PathBuf {
            let mut opened = self.open();
            self.write(&mut opened, "a.txt", b"first");
            let previous = crate::host_fs::read(index_path(&self.dir)).unwrap();
            mkdir_logical(&mut opened.index, "docs").unwrap();
            self.write(&mut opened, "docs/b.txt", b"second");
            crate::host_fs::write(index_path(&self.dir), previous).unwrap();
            self.blob_of(&opened, "docs/b.txt")
        }
    }

    #[test]
    fn open_store_leaves_data_as_it_is() {
        let store = Store::new();
        let blob = store.seal_cut_after_copy();
        let opened = store.open();
        assert!(opened.other_copy.is_some());
        assert!(blob.host_exists());
        assert!(!store.held().host_exists());
    }

    #[test]
    fn a_blob_only_the_other_index_file_names_is_held_and_named() {
        let store = Store::new();
        let blob = store.seal_cut_after_copy();

        let mut opened = store.settle(Vec::new());
        assert!(!blob.host_exists());
        assert_eq!(opened.index.held.len(), 1);
        let held = opened.index.held[0].clone();
        let held_path = store.held().join(&held.name);
        assert_eq!(held.file.as_ref().unwrap().path, "docs/b.txt");
        assert_eq!(
            held.size,
            crate::host_fs::metadata(&held_path).unwrap().len()
        );

        // Put back where it was: its folder, gone with the newer tree, is
        // made again.
        assert!(opened.index.find("docs").is_none());
        let restored = restore_held(
            &store.dir,
            &mut opened.index,
            std::slice::from_ref(&held.name),
        )
        .unwrap();
        assert_eq!(restored[0].path, "docs/b.txt");
        assert!(opened.index.held.is_empty());
        assert!(opened.index.find("docs").unwrap().is_dir());
        assert_eq!(store.read(&opened, "docs/b.txt"), b"second");
        assert!(!held_path.host_exists());
    }

    #[test]
    fn a_held_file_whose_path_is_taken_comes_back_beside_it() {
        let store = Store::new();
        store.seal_cut_after_copy();
        let mut opened = store.settle(Vec::new());
        let name = opened.index.held[0].name.clone();
        mkdir_logical(&mut opened.index, "docs").unwrap();
        store.write(&mut opened, "docs/b.txt", b"newer");

        let restored = restore_held(&store.dir, &mut opened.index, &[name]).unwrap();
        assert_eq!(restored[0].path, "docs/b-2.txt");
        assert_eq!(store.read(&opened, "docs/b.txt"), b"newer");
        assert_eq!(store.read(&opened, "docs/b-2.txt"), b"second");
    }

    #[test]
    fn a_held_file_whose_folder_is_a_file_now_comes_back_at_the_top() {
        let store = Store::new();
        store.seal_cut_after_copy();
        let mut opened = store.settle(Vec::new());
        let name = opened.index.held[0].name.clone();
        store.write(&mut opened, "docs", b"a file");

        let restored = restore_held(&store.dir, &mut opened.index, &[name]).unwrap();
        assert_eq!(restored[0].path, "b.txt");
        assert_eq!(store.read(&opened, "b.txt"), b"second");
    }

    #[test]
    fn an_undone_restore_puts_the_blob_back_in_held() {
        let store = Store::new();
        store.seal_cut_after_copy();
        let mut opened = store.settle(Vec::new());
        let name = opened.index.held[0].name.clone();
        let restored =
            restore_held(&store.dir, &mut opened.index, std::slice::from_ref(&name)).unwrap();
        restored[0].undo();
        assert!(store.held().join(&name).host_exists());

        // A name that is not held refuses the whole call and moves nothing.
        let mut opened = store.settle(Vec::new());
        let err = restore_held(
            &store.dir,
            &mut opened.index,
            &[name.clone(), "missing.blob".into()],
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultHeldNotFound(_)), "{err:?}");
        assert!(store.held().join(&name).host_exists());
    }

    #[test]
    fn a_backup_zip_names_a_held_blob_when_no_index_file_does() {
        let store = Store::new();
        let blob = store.seal_cut_after_copy();
        // A backup made while both index files named `docs/b.txt`.
        let zip = store.dir.parent().unwrap().join("backup.zip");
        let header = crate::host_fs::read(VaultHeader::path(&store.dir)).unwrap();
        let named = crate::host_fs::read(index_copy_path(&store.dir)).unwrap();
        write_zip(&zip, &header, &named);
        // Then the copy went back too.
        let primary = crate::host_fs::read(index_path(&store.dir)).unwrap();
        crate::host_fs::write(index_copy_path(&store.dir), &primary).unwrap();

        let opened = store.settle(vec![zip]);
        assert!(!blob.host_exists());
        assert_eq!(opened.index.held.len(), 1);
        assert_eq!(
            opened.index.held[0].file.as_ref().unwrap().path,
            "docs/b.txt"
        );
    }

    fn write_zip(path: &Path, header: &[u8], index: &[u8]) {
        use std::io::Write;
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("store/header/vault.header", options)
            .unwrap();
        zip.write_all(header).unwrap();
        zip.start_file("store/index/root.idx.enc", options).unwrap();
        zip.write_all(index).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn a_blob_no_index_names_is_kept_as_a_piece_and_a_short_one_is_deleted() {
        let store = Store::new();
        let piece = blob_path(&store.dir, "00000000-0000-4000-8000-000000000099").unwrap();
        let short = blob_path(&store.dir, "00000000-0000-4000-8000-000000000098").unwrap();
        crate::host_fs::create_dir_all(piece.parent().unwrap()).unwrap();
        crate::host_fs::write(&piece, vec![7u8; MIN_BLOB_LEN as usize]).unwrap();
        crate::host_fs::write(&short, vec![7u8; MIN_BLOB_LEN as usize - 1]).unwrap();

        let mut opened = store.settle(Vec::new());
        assert!(!piece.host_exists());
        assert!(!short.host_exists());
        assert_eq!(opened.index.held.len(), 1);
        let held = opened.index.held[0].clone();
        assert_eq!(held.name, "00000000-0000-4000-8000-000000000099.blob");
        assert!(held.file.is_none());
        assert_eq!(held.size, MIN_BLOB_LEN);

        // A piece cannot be put back; deleting it removes it for good.
        let names = std::slice::from_ref(&held.name);
        let err = restore_held(&store.dir, &mut opened.index, names).unwrap_err();
        assert!(matches!(err, UprivError::VaultHeldNotFound(_)), "{err:?}");
        delete_held(&store.dir, &mut opened.index, names).unwrap();
        assert!(opened.index.held.is_empty());
        assert!(!store.held().join(&held.name).host_exists());
    }

    #[test]
    fn a_file_in_held_that_is_not_a_blob_is_left_alone() {
        let store = Store::new();
        crate::host_fs::create_dir_all(store.held()).unwrap();
        crate::host_fs::write(store.held().join(".DS_Store"), vec![7u8; 64]).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let odd = std::ffi::OsStr::from_bytes(b"odd-\xff");
            std::fs::write(store.held().join(odd), b"x").unwrap();
        }
        let piece = blob_path(&store.dir, "00000000-0000-4000-8000-000000000099").unwrap();
        crate::host_fs::create_dir_all(piece.parent().unwrap()).unwrap();
        crate::host_fs::write(&piece, vec![7u8; 64]).unwrap();

        let opened = store.settle(Vec::new());
        let names: Vec<&str> = opened.index.held.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, ["00000000-0000-4000-8000-000000000099.blob"]);
        assert!(store.held().join(".DS_Store").host_exists());
    }

    #[test]
    fn a_held_blob_the_tree_names_again_goes_back_to_data() {
        let store = Store::new();
        let mut opened = store.open();
        store.write(&mut opened, "a.txt", b"first");
        let blob = store.blob_of(&opened, "a.txt");
        crate::host_fs::create_dir_all(store.held()).unwrap();
        crate::host_fs::rename(&blob, store.held().join(blob.file_name().unwrap())).unwrap();

        let opened = store.settle(Vec::new());
        assert!(blob.host_exists());
        assert!(opened.index.held.is_empty());
        assert_eq!(opened.index.find("a.txt").unwrap().problem, None);
        assert_eq!(store.read(&opened, "a.txt"), b"first");
        assert!(!store.held().host_exists(), "an emptied folder goes");
    }

    /// The unlock removes an empty `held/`, and leaves one that holds a file
    /// another app put there.
    #[test]
    fn an_unlock_removes_an_empty_held_folder_and_keeps_one_with_a_stray_file() {
        let store = Store::new();
        crate::host_fs::create_dir_all(store.held()).unwrap();
        store.settle(Vec::new());
        assert!(!store.held().host_exists());

        crate::host_fs::create_dir_all(store.held()).unwrap();
        let stray = store.held().join(".DS_Store");
        crate::host_fs::write(&stray, b"finder").unwrap();
        let opened = store.settle(Vec::new());
        assert!(opened.index.held.is_empty());
        assert!(stray.host_exists());
    }

    /// A blob the index lists as released is an old version a seal let go of:
    /// the unlock leaves it in `data/` for the session to delete, and records
    /// nothing to review.
    #[test]
    fn a_released_blob_stays_in_data_and_is_not_held() {
        let store = Store::new();
        let mut opened = store.open();
        store.write(&mut opened, "a.txt", b"first");
        let old = store.blob_of(&opened, "a.txt");
        store.write(&mut opened, "a.txt", b"second");
        assert!(old.host_exists(), "a store-level write leaves the old blob");
        let old_id = old.file_stem().unwrap().to_str().unwrap().to_string();
        opened.index.released.push(old_id.clone());
        flush_index(&store.dir, &mut opened).unwrap();

        let opened = store.settle(Vec::new());
        assert!(old.host_exists());
        assert!(opened.index.held.is_empty());
        assert_eq!(opened.index.released, [old_id]);
        assert!(!store.held().host_exists());
    }

    /// The other index file names a blob the primary lists as released (an
    /// emptied file written again keeps its id): it holds that tree's bytes,
    /// so it is set aside and named, never left to be deleted.
    #[test]
    fn a_released_blob_the_index_copy_names_is_held_and_named() {
        let store = Store::new();
        let blob = store.seal_cut_after_copy();
        let id = blob.file_stem().unwrap().to_str().unwrap().to_string();
        let mut primary = store.open();
        primary.index.released.push(id);
        let sealed =
            crate::store::sealed_index_bytes(&primary.header, &primary.index_key, &primary.index)
                .unwrap();
        crate::host_fs::write(index_path(&store.dir), sealed).unwrap();

        let opened = store.settle(Vec::new());
        assert!(opened.index.released.is_empty());
        assert!(!blob.host_exists());
        assert_eq!(opened.index.held.len(), 1);
        let file = opened.index.held[0].file.as_ref().expect("named");
        assert_eq!(file.path, "docs/b.txt");
    }

    /// Two held blobs carry the file's id: the one whose first chunk opens as
    /// the file's goes back, though its number comes later.
    #[test]
    fn the_held_blob_that_opens_as_the_file_goes_back_when_two_carry_its_id() {
        let store = Store::new();
        let mut opened = store.open();
        store.write(&mut opened, "a.txt", b"first");
        let blob = store.blob_of(&opened, "a.txt");
        let older = crate::host_fs::read(&blob).unwrap();
        // Same id, a new version of its first chunk.
        write_logical_range(
            &store.dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "a.txt",
            0,
            b"FIRST",
        )
        .unwrap();
        flush_index(&store.dir, &mut opened).unwrap();
        let first = blob.file_name().unwrap().to_str().unwrap().to_string();
        let id = first.strip_suffix(BLOB_FILE_SUFFIX).unwrap();
        let second = format!("{id}.2{BLOB_FILE_SUFFIX}");
        crate::host_fs::create_dir_all(store.held()).unwrap();
        crate::host_fs::write(store.held().join(&first), &older).unwrap();
        crate::host_fs::rename(&blob, store.held().join(&second)).unwrap();
        assert_eq!((held_number(&first), held_number(&second)), (1, 2));

        let opened = store.settle(Vec::new());
        assert_eq!(store.read(&opened, "a.txt"), b"FIRST");
        assert_eq!(opened.index.find("a.txt").unwrap().problem, None);
        assert!(!store.held().join(&second).host_exists());
        assert!(
            store.held().join(&first).host_exists(),
            "the older copy stays held"
        );
    }

    #[test]
    fn a_record_keeps_its_name_when_its_blob_came_back_to_data() {
        let store = Store::new();
        let blob = store.seal_cut_after_copy();
        let id = blob.file_stem().unwrap().to_str().unwrap().to_string();
        // Another file already used the first name, so the blob is held as
        // `<id>.2.blob`.
        let first = format!("{id}{BLOB_FILE_SUFFIX}");
        crate::host_fs::create_dir_all(store.held()).unwrap();
        crate::host_fs::write(store.held().join(&first), vec![7u8; 64]).unwrap();
        let mut opened = store.settle(Vec::new());
        let held = opened
            .index
            .held
            .iter()
            .find(|entry| entry.file.is_some())
            .unwrap()
            .clone();
        assert_eq!(held.name, format!("{id}.2{BLOB_FILE_SUFFIX}"));
        delete_held(&store.dir, &mut opened.index, &[first]).unwrap();
        flush_index(&store.dir, &mut opened).unwrap();
        // A restore moved it into `data/`, and its seal never came.
        let mut restoring = opened.index.clone();
        restore_held(&store.dir, &mut restoring, std::slice::from_ref(&held.name)).unwrap();
        assert!(blob.host_exists());

        let opened = store.settle(Vec::new());
        assert!(!blob.host_exists());
        assert_eq!(opened.index.held, vec![held.clone()]);
        assert!(store.held().join(&held.name).host_exists());
    }

    #[test]
    fn a_held_blob_of_an_internal_file_is_deleted() {
        let store = Store::new();
        let mut opened = store.open();
        store.write(&mut opened, "a.txt", b"first");
        let previous = crate::host_fs::read(index_path(&store.dir)).unwrap();
        store.write(&mut opened, INTERNAL_WORKSPACE_FILE, b"{}");
        let layout = store.blob_of(&opened, INTERNAL_WORKSPACE_FILE);
        crate::host_fs::write(index_path(&store.dir), previous).unwrap();

        let opened = store.settle(Vec::new());
        assert!(!layout.host_exists());
        assert!(opened.index.held.is_empty());
        assert!(list_held(&store.held()).unwrap().is_empty());
    }

    #[test]
    fn a_record_whose_file_is_gone_is_dropped() {
        let store = Store::new();
        let piece = blob_path(&store.dir, "00000000-0000-4000-8000-000000000099").unwrap();
        crate::host_fs::create_dir_all(piece.parent().unwrap()).unwrap();
        crate::host_fs::write(&piece, vec![7u8; 64]).unwrap();
        let mut opened = store.settle(Vec::new());
        flush_index(&store.dir, &mut opened).unwrap();
        let name = opened.index.held[0].name.clone();
        crate::host_fs::remove_file(store.held().join(name)).unwrap();

        let opened = store.settle(Vec::new());
        assert!(opened.index.held.is_empty());
    }
}
