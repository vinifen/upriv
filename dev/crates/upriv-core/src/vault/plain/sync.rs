//! One pass between the store and the plaintext folder.
//!
//! The store is the vault; the folder is a working copy other apps edit. A
//! pass compares both sides with what they looked like after the last pass
//! (the snapshot) and carries each change across: a store change is written
//! to the folder, a folder change is saved into the store. When both sides
//! changed one file, the folder copy is saved under a conflict name and the
//! store copy is written back, so neither edit is lost.
//!
//! The scan runs without the session lock. Each step checks again, when it
//! runs, that both sides still look the way the plan saw them. Anything that
//! moved in between is left for the next pass instead of being overwritten.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use super::disk::{self, DiskStamp, Scan, Seen};
use super::marker;
use super::names::NameRules;
use super::sweep;
use super::{PlainSession, PlainSyncReport};
use crate::error::{Result, UprivError};
use crate::logging::{log_event, LogLevel};
use crate::session::{with_open_session, OpenSession};
use crate::store::{
    child_logical_path, is_reserved_logical, parent_logical, RetiredFileChunks, VaultIndex,
    LOGICAL_NAME_MAX,
};
use crate::vault::fs::{
    read_store_range, seal_reader, seal_staged_sync, stage_delete, stage_mkdir, stage_move,
    stage_remove_empty_dir, stage_sealed,
};
#[cfg(unix)]
use crate::vault::wipe::overwrite_contents;
use crate::vault::wipe::WipeOptions;

/// Plaintext copied per session-lock hold while a file is written out.
const EXPORT_PIECE: u64 = 4 * 1024 * 1024;
/// Files saved into the store before the index is sealed once for all of them.
const IMPORT_WAVE: usize = 32;
/// A file whose content changed this recently is probably still being
/// written. It waits for the next pass, except on close.
const SETTLE_NANOS: i128 = 2_000_000_000;
/// Largest pair a pass compares byte for byte before calling it a conflict.
const SAME_CONTENT_MAX: u64 = 64 * 1024 * 1024;
/// A burst of changes at least this large, and more than half the vault, is
/// a mass change: deletions wait for the user, and close pins the backup.
const MASS_CHANGE_MIN: usize = 5;

/// True when `changed` files out of `tracked` look like a deleted or
/// unplugged folder, a cleaner, or ransomware rather than normal editing.
pub(super) fn is_mass_change(changed: usize, tracked: usize) -> bool {
    changed >= MASS_CHANGE_MIN && changed * 2 > tracked
}

/// Identity of one store version of a file. Any write gives a new one; a
/// rename keeps it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct NodeStamp([u8; 32]);

impl NodeStamp {
    fn of(file_id: &str, size: u64, versions: &[String]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(file_id.as_bytes());
        hasher.update([0]);
        hasher.update(size.to_le_bytes());
        for version in versions {
            hasher.update(version.as_bytes());
            hasher.update([0]);
        }
        Self(hasher.finalize().into())
    }
}

/// What a path looked like on both sides after the pass that last synced it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Synced {
    File { node: NodeStamp, disk: DiskStamp },
    Dir,
}

/// One store path as a pass sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    File { node: NodeStamp, size: u64 },
    Dir,
}

/// Every store path the folder mirrors, folders implied by files included.
fn store_view(index: &VaultIndex) -> HashMap<String, Side> {
    let mut view = HashMap::with_capacity(index.nodes.len());
    for node in &index.nodes {
        if is_reserved_logical(&node.path) {
            continue;
        }
        let side = match node.as_file() {
            Some((file_id, size, versions)) => Side::File {
                node: NodeStamp::of(file_id, size, versions),
                size,
            },
            None => Side::Dir,
        };
        view.insert(node.path.clone(), side);
        let mut parent = parent_logical(&node.path);
        while let Some(dir) = parent {
            view.entry(dir.to_string()).or_insert(Side::Dir);
            parent = parent_logical(dir);
        }
    }
    view
}

fn node_stamp_at(index: &VaultIndex, path: &str) -> Option<NodeStamp> {
    index.find(path).and_then(|node| {
        node.as_file()
            .map(|(file_id, size, versions)| NodeStamp::of(file_id, size, versions))
    })
}

/// True when no folder above `path` is a file in the store.
fn parents_are_dirs(index: &VaultIndex, path: &str) -> bool {
    let mut current = parent_logical(path);
    while let Some(dir) = current {
        if index.find(dir).is_some_and(|node| !node.is_dir()) {
            return false;
        }
        current = parent_logical(dir);
    }
    true
}

#[derive(Debug, Clone)]
struct Conflict {
    path: String,
    disk: DiskStamp,
    node: NodeStamp,
    size: u64,
}

#[derive(Debug, Clone)]
struct Import {
    path: String,
    scanned: DiskStamp,
    /// The store version the plan saw. `None`: the store had no file there.
    expect: Option<NodeStamp>,
}

#[derive(Debug, Clone)]
struct Export {
    path: String,
    node: NodeStamp,
    size: u64,
    /// The folder copy this write replaces. `None`: the name must be free.
    replace: Option<DiskStamp>,
}

#[derive(Debug, Clone)]
struct Move {
    from: String,
    to: String,
    node: NodeStamp,
    /// Store moves: the stamp at `to`. Folder moves: the stamp at `from`.
    disk: DiskStamp,
}

#[derive(Debug, Default)]
struct Plan {
    conflicts: Vec<Conflict>,
    store_dirs: Vec<String>,
    store_moves: Vec<Move>,
    imports: Vec<Import>,
    folder_dirs: Vec<String>,
    folder_moves: Vec<Move>,
    exports: Vec<Export>,
    store_deletes: Vec<(String, NodeStamp)>,
    store_dir_deletes: Vec<String>,
    folder_deletes: Vec<(String, DiskStamp)>,
    folder_dir_deletes: Vec<String>,
    adopt: Vec<String>,
    forget: Vec<String>,
    hold: Vec<String>,
    unhold: Vec<String>,
    unwritable: u32,
    retry: u32,
    mismatched: u32,
}

fn depth(path: &str) -> usize {
    path.bytes().filter(|byte| *byte == b'/').count()
}

fn tracked_files(synced: &HashMap<String, Synced>) -> usize {
    synced
        .values()
        .filter(|entry| matches!(entry, Synced::File { .. }))
        .count()
}

/// Decide what this pass does. `closing` saves folder changes only. `now` is
/// in nanoseconds since the Unix epoch, like [`DiskStamp::modified`].
fn plan(
    view: &HashMap<String, Side>,
    session: &PlainSession,
    scan: &Scan,
    closing: bool,
    now: i128,
) -> Plan {
    let mut plan = Plan::default();
    let synced = &session.synced;
    let mut paths: BTreeSet<&str> = BTreeSet::new();
    paths.extend(view.keys().map(String::as_str));
    paths.extend(scan.entries.keys().map(String::as_str));
    paths.extend(synced.keys().map(String::as_str));
    // A file sent to the folder keeps its place there when the app renames it.
    let renamed: HashSet<NodeStamp> = synced
        .iter()
        .filter(|(path, _)| !view.contains_key(path.as_str()))
        .filter_map(|(_, entry)| match entry {
            Synced::File { node, .. } => Some(*node),
            Synced::Dir => None,
        })
        .collect();

    let mut gone_from_folder: Vec<(String, NodeStamp, DiskStamp)> = Vec::new();
    let mut gone_from_store: Vec<(String, DiskStamp, NodeStamp)> = Vec::new();
    let mut folder_dir_gone: Vec<String> = Vec::new();
    let mut store_dir_gone: Vec<String> = Vec::new();

    for path in paths {
        let store = view.get(path).copied();
        let folder = scan.entries.get(path).copied();
        let last = synced.get(path).copied();
        match (store, folder) {
            (Some(Side::File { node, size }), Some(Seen::File(disk))) => {
                let conflict = Conflict {
                    path: path.to_string(),
                    disk,
                    node,
                    size,
                };
                let Some(Synced::File {
                    node: last_node,
                    disk: last_disk,
                }) = last
                else {
                    plan.conflicts.push(conflict);
                    continue;
                };
                match (node != last_node, disk != last_disk) {
                    (false, false) => {}
                    (true, false) if !closing => plan.exports.push(Export {
                        path: path.to_string(),
                        node,
                        size,
                        replace: Some(disk),
                    }),
                    (true, false) => {}
                    (false, true) => plan.imports.push(Import {
                        path: path.to_string(),
                        scanned: disk,
                        expect: Some(node),
                    }),
                    (true, true) => plan.conflicts.push(conflict),
                }
            }
            (Some(Side::File { node, size }), None) => {
                if scan.unknown(path) {
                    continue;
                }
                match last {
                    Some(Synced::File {
                        node: last_node,
                        disk: last_disk,
                    }) if node == last_node => {
                        gone_from_folder.push((path.to_string(), node, last_disk));
                    }
                    _ if !closing
                        && (last.is_some() || session.wants(path) || renamed.contains(&node)) =>
                    {
                        plan.exports.push(Export {
                            path: path.to_string(),
                            node,
                            size,
                            replace: None,
                        });
                    }
                    _ => {}
                }
            }
            (None, Some(Seen::File(disk))) => match last {
                Some(Synced::File {
                    node: last_node,
                    disk: last_disk,
                }) if disk == last_disk => {
                    gone_from_store.push((path.to_string(), disk, last_node));
                }
                _ => plan.imports.push(Import {
                    path: path.to_string(),
                    scanned: disk,
                    expect: None,
                }),
            },
            (Some(Side::Dir), Some(Seen::Dir)) => {
                if last != Some(Synced::Dir) {
                    plan.adopt.push(path.to_string());
                }
            }
            (Some(Side::Dir), None) => {
                if scan.unknown(path) {
                    continue;
                }
                if last == Some(Synced::Dir) {
                    folder_dir_gone.push(path.to_string());
                } else if !closing && session.wants(path) {
                    plan.folder_dirs.push(path.to_string());
                }
            }
            (None, Some(Seen::Dir)) => {
                if last == Some(Synced::Dir) {
                    store_dir_gone.push(path.to_string());
                } else {
                    plan.store_dirs.push(path.to_string());
                }
            }
            (None, None) => {
                if last.is_some() {
                    plan.forget.push(path.to_string());
                }
            }
            // A file on one side and a folder on the other is left alone.
            (Some(Side::File { .. }), Some(Seen::Dir)) | (Some(Side::Dir), Some(Seen::File(_))) => {
                plan.mismatched += 1;
            }
        }
    }

    match_folder_moves(&mut plan, &mut gone_from_folder, view);
    match_store_moves(&mut plan, &mut gone_from_store, scan);

    // A held deletion stays held while the folder copy is still gone and the
    // store copy is unchanged. Anything else resolved it some other way.
    let still_gone: HashSet<&str> = gone_from_folder
        .iter()
        .map(|(path, ..)| path.as_str())
        .collect();
    plan.unhold = session
        .held
        .iter()
        .filter(|path| !still_gone.contains(path.as_str()))
        .cloned()
        .collect();
    let deletions: Vec<(String, NodeStamp)> = gone_from_folder
        .into_iter()
        .filter(|(path, ..)| !session.held.contains(path))
        .map(|(path, node, _)| (path, node))
        .collect();
    if is_mass_change(deletions.len(), tracked_files(synced)) {
        plan.hold = deletions.into_iter().map(|(path, _)| path).collect();
    } else {
        plan.store_deletes = deletions;
    }
    plan.folder_deletes = gone_from_store
        .into_iter()
        .map(|(path, disk, _)| (path, disk))
        .collect();

    resolve_store_dir_deletes(&mut plan, folder_dir_gone, view, session, closing);
    resolve_folder_dir_deletes(&mut plan, store_dir_gone, scan);

    if !closing {
        let before = plan.imports.len();
        plan.imports
            .retain(|import| !written_recently(&import.scanned, now));
        plan.retry += (before - plan.imports.len()) as u32;
    }
    drop_unwritable(&mut plan, scan, &session.rules);

    let shallow_first = |a: &String, b: &String| depth(a).cmp(&depth(b)).then_with(|| a.cmp(b));
    plan.store_dirs.sort_by(shallow_first);
    plan.store_dirs.dedup();
    plan.folder_dirs.sort_by(shallow_first);
    plan.folder_dirs.dedup();
    plan.store_dir_deletes.sort_by(|a, b| shallow_first(b, a));
    plan.folder_dir_deletes.sort_by(|a, b| shallow_first(b, a));
    plan
}

/// The content or the attributes changed within the settle window, by
/// either clock. A time in the future is not "recent": it never settles.
fn written_recently(stamp: &DiskStamp, now: i128) -> bool {
    let last = stamp.modified.max(stamp.changed);
    (now - last).abs() < SETTLE_NANOS
}

fn unix_nanos_now() -> i128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos() as i128)
}

/// Positions of the entries whose key no other entry shares.
fn unique_keys<K: Eq + std::hash::Hash>(
    keys: impl Iterator<Item = Option<K>>,
) -> HashMap<K, usize> {
    let mut seen: HashMap<K, Option<usize>> = HashMap::new();
    for (index, key) in keys.enumerate() {
        if let Some(key) = key {
            seen.entry(key)
                .and_modify(|slot| *slot = None)
                .or_insert(Some(index));
        }
    }
    seen.into_iter()
        .filter_map(|(key, slot)| slot.map(|index| (key, index)))
        .collect()
}

fn move_key(stamp: &DiskStamp) -> Option<((u64, u64), u64, i128)> {
    stamp.inode.map(|inode| (inode, stamp.len, stamp.modified))
}

/// A file that left one folder path and appeared at another with the same
/// file number, length, and write time was moved: the store renames it.
fn match_folder_moves(
    plan: &mut Plan,
    gone: &mut Vec<(String, NodeStamp, DiskStamp)>,
    view: &HashMap<String, Side>,
) {
    let sources = unique_keys(gone.iter().map(|(_, _, disk)| move_key(disk)));
    if sources.is_empty() {
        return;
    }
    let candidates = unique_keys(plan.imports.iter().map(|import| {
        (import.expect.is_none() && !view.contains_key(&import.path))
            .then(|| move_key(&import.scanned))
            .flatten()
    }));
    let mut taken = HashSet::new();
    let mut moved_imports = HashSet::new();
    for (key, target) in candidates {
        let Some(&source) = sources.get(&key) else {
            continue;
        };
        let (from, node, _) = &gone[source];
        let import = &plan.imports[target];
        plan.store_moves.push(Move {
            from: from.clone(),
            to: import.path.clone(),
            node: *node,
            disk: import.scanned,
        });
        taken.insert(source);
        moved_imports.insert(target);
    }
    retain_unmarked(&mut plan.imports, &moved_imports);
    retain_unmarked(gone, &taken);
    plan.store_moves.sort_by(|a, b| a.to.cmp(&b.to));
}

/// A store file renamed in the app keeps its blob, so its stamp moves with
/// it: the folder copy is renamed instead of written again.
fn match_store_moves(plan: &mut Plan, gone: &mut Vec<(String, DiskStamp, NodeStamp)>, scan: &Scan) {
    let sources = unique_keys(gone.iter().map(|(_, _, node)| Some(*node)));
    if sources.is_empty() {
        return;
    }
    let candidates = unique_keys(plan.exports.iter().map(|export| {
        (export.replace.is_none() && !scan.entries.contains_key(&export.path))
            .then_some(export.node)
    }));
    let mut taken = HashSet::new();
    let mut moved_exports = HashSet::new();
    for (node, target) in candidates {
        let Some(&source) = sources.get(&node) else {
            continue;
        };
        let (from, disk, _) = &gone[source];
        plan.folder_moves.push(Move {
            from: from.clone(),
            to: plan.exports[target].path.clone(),
            node,
            disk: *disk,
        });
        taken.insert(source);
        moved_exports.insert(target);
    }
    retain_unmarked(&mut plan.exports, &moved_exports);
    retain_unmarked(gone, &taken);
    plan.folder_moves.sort_by(|a, b| a.to.cmp(&b.to));
}

fn retain_unmarked<T>(items: &mut Vec<T>, marked: &HashSet<usize>) {
    let mut index = 0;
    items.retain(|_| {
        let keep = !marked.contains(&index);
        index += 1;
        keep
    });
}

/// A folder another app removed leaves the store only when nothing under it
/// stays there. Otherwise it is made again in the folder.
fn resolve_store_dir_deletes(
    plan: &mut Plan,
    gone: Vec<String>,
    view: &HashMap<String, Side>,
    session: &PlainSession,
    closing: bool,
) {
    if gone.is_empty() {
        return;
    }
    let held = &session.held;
    let leaving: HashSet<&str> = plan
        .store_deletes
        .iter()
        .map(|(path, _)| path.as_str())
        .chain(gone.iter().map(String::as_str))
        .chain(plan.store_moves.iter().map(|moved| moved.from.as_str()))
        .collect();
    let mut kept = Vec::new();
    for dir in &gone {
        let survives = view.keys().any(|path| {
            disk::is_under(path, dir) && (!leaving.contains(path.as_str()) || held.contains(path))
        }) || plan.hold.iter().any(|path| disk::is_under(path, dir));
        if survives {
            kept.push(dir.clone());
        } else {
            plan.store_dir_deletes.push(dir.clone());
        }
    }
    if !session.whole {
        // Files never sent keep it in the store. It stays out of the folder.
        plan.forget.extend(kept);
    } else if !closing {
        plan.folder_dirs.extend(kept);
    }
}

/// A folder the app removed leaves the disk only when the folder holds
/// nothing else under it. Otherwise the store gets the folder back.
fn resolve_folder_dir_deletes(plan: &mut Plan, gone: Vec<String>, scan: &Scan) {
    if gone.is_empty() {
        return;
    }
    let leaving: HashSet<&str> = plan
        .folder_deletes
        .iter()
        .map(|(path, _)| path.as_str())
        .chain(gone.iter().map(String::as_str))
        .chain(plan.folder_moves.iter().map(|moved| moved.from.as_str()))
        .collect();
    for dir in &gone {
        let survives = scan
            .entries
            .keys()
            .any(|path| disk::is_under(path, dir) && !leaving.contains(path.as_str()));
        if survives {
            plan.store_dirs.push(dir.clone());
        } else {
            plan.folder_dir_deletes.push(dir.clone());
        }
    }
}

/// Names the folder cannot hold, or that it would treat as an entry already
/// there or as another name this pass writes, are not written.
fn drop_unwritable(plan: &mut Plan, scan: &Scan, rules: &NameRules) {
    let mut claimed: HashMap<String, String> = scan
        .entries
        .keys()
        .map(|path| (rules.fold_path(path), path.clone()))
        .collect();
    let mut writable = |path: &str| {
        if !rules.allows_path(path) {
            return false;
        }
        match claimed.entry(rules.fold_path(path)) {
            std::collections::hash_map::Entry::Occupied(owner) => owner.get() == path,
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert(path.to_string());
                true
            }
        }
    };
    let before = plan.exports.len() + plan.folder_dirs.len() + plan.folder_moves.len();
    plan.folder_dirs.retain(|dir| writable(dir));
    plan.folder_moves.retain(|moved| writable(&moved.to));
    plan.exports.retain(|export| writable(&export.path));
    let after = plan.exports.len() + plan.folder_dirs.len() + plan.folder_moves.len();
    plan.unwritable += (before - after) as u32;
}

/// How one write to the folder ended.
enum Step {
    Done,
    /// The file or the store moved on since the plan; the next pass sees it.
    Changed,
    /// The folder refused the write.
    Refused,
}

/// Everything a pass needs while it runs.
struct Pass<'a> {
    dir: &'a Path,
    folder: &'a Path,
    bridge: bool,
    wipe: &'a WipeOptions,
    cancel: &'a AtomicBool,
    report: PlainSyncReport,
    retired: Vec<RetiredFileChunks>,
    staged: usize,
    /// Paths other apps changed or removed during this pass.
    touched: Vec<String>,
    added: u32,
    changed: u32,
    removed: u32,
}

impl Pass<'_> {
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn os(&self, path: &str) -> PathBuf {
        disk::os_path(self.folder, path)
    }

    fn with_plain<T>(&self, f: impl FnOnce(&mut OpenSession) -> Result<T>) -> Result<T> {
        with_open_session(self.dir, |session| {
            if session.plain.is_none() {
                return Err(UprivError::VaultNotOpen(session.vault_id.clone()));
            }
            f(session)
        })
    }

    /// Seal what is staged once a wave is full, or everything with `force`.
    fn seal(&mut self, force: bool) -> Result<()> {
        if self.staged == 0 && self.retired.is_empty() {
            return Ok(());
        }
        if !force && self.staged < IMPORT_WAVE {
            return Ok(());
        }
        let retired = std::mem::take(&mut self.retired);
        self.with_plain(|session| seal_staged_sync(session, &retired))?;
        self.staged = 0;
        Ok(())
    }
}

fn plain_mut(session: &mut OpenSession) -> &mut PlainSession {
    session.plain.as_mut().expect("checked by Pass::with_plain")
}

/// Fails its next read once the pass is cancelled, so one large file cannot
/// hold up a close that was told to hurry.
struct CancelReader<'a, R> {
    inner: R,
    cancel: &'a AtomicBool,
}

impl<R: Read> Read for CancelReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(io::Error::other("pass cancelled"));
        }
        self.inner.read(buf)
    }
}

/// Run one pass. `closing` only saves the folder's changes into the store.
pub(super) fn run(
    dir: &Path,
    closing: bool,
    cancel: &AtomicBool,
    wipe: &WipeOptions,
) -> Result<PlainSyncReport> {
    let (folder, helpers, bridge, vault_id, token) = with_open_session(dir, |session| {
        let plain = session
            .plain
            .as_ref()
            .ok_or_else(|| UprivError::VaultNotOpen(session.vault_id.clone()))?;
        Ok((
            plain.folder.clone(),
            plain.helpers.clone(),
            plain.bridge,
            session.vault_id.clone(),
            plain.token.clone(),
        ))
    })?;
    let mut report = PlainSyncReport::default();
    let ours = matches!(
        marker::read(&folder),
        Ok(Some(found)) if found.written_by(&vault_id, &token)
    );
    let skip: Vec<&str> = helpers.iter().map(String::as_str).collect();
    let scan = match ours.then(|| disk::scan(&folder, &skip)) {
        Some(Ok(scan)) => scan,
        _ => {
            report.folder_missing = true;
            return finish(dir, report, Tally::default());
        }
    };
    report.skipped = scan.skipped + scan.unreadable.len() as u32;
    let now = unix_nanos_now();
    let plan = with_open_session(dir, |session| {
        let view = store_view(&session.index);
        let plain = session
            .plain
            .as_ref()
            .ok_or_else(|| UprivError::VaultNotOpen(session.vault_id.clone()))?;
        Ok(plan(&view, plain, &scan, closing, now))
    })?;
    drop(scan);
    report.unwritable = plan.unwritable;
    report.retry = plan.retry;
    report.skipped += plan.mismatched;

    let mut pass = Pass {
        dir,
        folder: &folder,
        bridge,
        wipe,
        cancel,
        report,
        retired: Vec::new(),
        staged: 0,
        touched: Vec::new(),
        added: 0,
        changed: 0,
        removed: 0,
    };
    let outcome = execute(&mut pass, plan, closing);
    let sealed = pass.seal(true);
    outcome?;
    sealed?;
    let tally = Tally {
        touched: std::mem::take(&mut pass.touched),
        added: pass.added,
        changed: pass.changed,
        removed: pass.removed,
    };
    finish(dir, pass.report, tally)
}

/// What other apps did, as one pass saw it.
#[derive(Default)]
struct Tally {
    touched: Vec<String>,
    added: u32,
    changed: u32,
    removed: u32,
}

fn finish(dir: &Path, mut report: PlainSyncReport, tally: Tally) -> Result<PlainSyncReport> {
    with_open_session(dir, |session| {
        let store_files = session
            .index
            .nodes
            .iter()
            .filter(|node| node.as_file().is_some() && !is_reserved_logical(&node.path))
            .count();
        let index = &session.index;
        let Some(plain) = session.plain.as_mut() else {
            return Ok(());
        };
        plain.totals.added += tally.added;
        plain.totals.changed += tally.changed;
        plain.totals.removed += tally.removed;
        plain.touched.extend(tally.touched);
        // A few chosen files in the folder say nothing about the vault's size.
        let tracked = if plain.whole {
            tracked_files(&plain.synced)
        } else {
            store_files
        };
        plain.tracked = plain.tracked.max(tracked);
        plain
            .pending
            .retain(|path| !plain.synced.contains_key(path) && index.find(path).is_some());
        report.held_deletions = plain.held.len() as u32;
        plain.last = Some(report.clone());
        if plain.listing_changed() {
            session.tree_revision = session.tree_revision.saturating_add(1);
        }
        Ok(())
    })?;
    Ok(report)
}

fn execute(pass: &mut Pass<'_>, mut plan: Plan, closing: bool) -> Result<()> {
    pass.with_plain(|session| {
        let plain = plain_mut(session);
        for path in &plan.unhold {
            plain.held.remove(path);
        }
        plain.held.extend(plan.hold.iter().cloned());
        Ok(())
    })?;
    pass.touched.extend(plan.hold.iter().cloned());

    for conflict in std::mem::take(&mut plan.conflicts) {
        if pass.cancelled() {
            return Ok(());
        }
        settle_conflict(pass, &conflict, closing, &mut plan)?;
    }
    for dir in &plan.store_dirs {
        add_store_dir(pass, dir)?;
    }
    for moved in &plan.store_moves {
        move_in_store(pass, moved)?;
    }
    for import in &plan.imports {
        if pass.cancelled() {
            return Ok(());
        }
        if import_file(pass, import)? {
            if import.expect.is_some() {
                pass.changed += 1;
            } else {
                pass.added += 1;
            }
        }
        pass.seal(false)?;
    }
    for dir in &plan.folder_dirs {
        if ensure_folder_dirs(pass, dir).is_err() {
            pass.report.unwritable += 1;
        }
    }
    for moved in &plan.folder_moves {
        move_in_folder(pass, moved)?;
    }
    for export in &plan.exports {
        if pass.cancelled() {
            return Ok(());
        }
        match export_file(pass, export)? {
            Step::Done => pass.report.written += 1,
            Step::Changed => pass.report.retry += 1,
            Step::Refused => pass.report.unwritable += 1,
        }
    }
    delete_in_store(pass, &plan.store_deletes, &plan.store_dir_deletes)?;
    delete_in_folder(pass, &plan.folder_deletes, &plan.folder_dir_deletes)?;
    pass.with_plain(|session| {
        let plain = plain_mut(session);
        for path in &plan.adopt {
            plain.synced.insert(path.clone(), Synced::Dir);
        }
        for path in &plan.forget {
            plain.synced.remove(path);
        }
        Ok(())
    })
}

/// Both sides changed one file. Equal bytes are not a conflict. Otherwise the
/// folder copy moves to a conflict name and is saved as a new file, and the
/// store copy is written back under the original name.
fn settle_conflict(
    pass: &mut Pass<'_>,
    conflict: &Conflict,
    closing: bool,
    plan: &mut Plan,
) -> Result<()> {
    if conflict.disk.len == conflict.size && conflict.size <= SAME_CONTENT_MAX {
        match same_content(pass, conflict) {
            Ok(true) => {
                let synced = Synced::File {
                    node: conflict.node,
                    disk: conflict.disk,
                };
                return pass.with_plain(|session| {
                    plain_mut(session)
                        .synced
                        .insert(conflict.path.clone(), synced);
                    Ok(())
                });
            }
            Ok(false) => {}
            Err(_) => {
                pass.report.retry += 1;
                return Ok(());
            }
        }
    }
    let stamp = conflict_stamp();
    let folder = pass.folder;
    let aside = pass.with_plain(|session| {
        Ok(conflict_name(&conflict.path, &stamp, |candidate| {
            session.index.find(candidate).is_some()
                || !matches!(disk::stamp_at(&disk::os_path(folder, candidate)), Ok(None))
        }))
    })?;
    let from = pass.os(&conflict.path);
    let moved = aside.as_ref().and_then(|aside| {
        let to = pass.os(aside);
        let unchanged =
            matches!(disk::stamp_at(&from), Ok(Some(Seen::File(now))) if now == conflict.disk);
        if !unchanged || crate::host_fs::rename_no_replace(&from, &to).is_err() {
            return None;
        }
        match disk::stamp_at(&to) {
            Ok(Some(Seen::File(stamp))) => Some(stamp),
            _ => None,
        }
    });
    let (Some(aside), Some(moved)) = (aside, moved) else {
        pass.report.retry += 1;
        return Ok(());
    };
    pass.report.conflicts += 1;
    pass.with_plain(|session| {
        plain_mut(session).synced.remove(&conflict.path);
        Ok(())
    })?;
    let import = Import {
        path: aside,
        scanned: moved,
        expect: None,
    };
    if import_file(pass, &import)? {
        pass.changed += 1;
    }
    if !closing {
        plan.exports.push(Export {
            path: conflict.path.clone(),
            node: conflict.node,
            size: conflict.size,
            replace: None,
        });
    }
    Ok(())
}

/// `2026-10-16 142501`, UTC.
fn conflict_stamp() -> String {
    let (y, mo, d, h, mi, s) = crate::time::utc_ymdhms(crate::time::unix_millis() / 1000);
    format!("{y:04}-{mo:02}-{d:02} {h:02}{mi:02}{s:02}")
}

/// `notes (conflict 2026-10-16 142501).txt` next to `notes.txt`. `None`
/// when no free name fits.
fn conflict_name(path: &str, stamp: &str, taken: impl Fn(&str) -> bool) -> Option<String> {
    let (parent, name) = match path.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => ("", path),
    };
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if dot > 0 => name.split_at(dot),
        _ => (name, ""),
    };
    (1..=99u32).find_map(|attempt| {
        let suffix = if attempt == 1 {
            format!(" (conflict {stamp})")
        } else {
            format!(" (conflict {stamp} {attempt})")
        };
        let room = LOGICAL_NAME_MAX.saturating_sub(suffix.len() + ext.len());
        let mut cut = stem.len().min(room);
        while !stem.is_char_boundary(cut) {
            cut -= 1;
        }
        let candidate =
            child_logical_path(parent, &format!("{}{suffix}{ext}", &stem[..cut])).ok()?;
        (!taken(&candidate)).then_some(candidate)
    })
}

/// Compare the folder file with the store version, piece by piece.
fn same_content(pass: &Pass<'_>, conflict: &Conflict) -> io::Result<bool> {
    let mut file = disk::open_for_import(&pass.os(&conflict.path))?;
    let mut ours = vec![0u8; EXPORT_PIECE.min(conflict.size) as usize];
    let mut compare = || -> io::Result<bool> {
        let mut offset = 0u64;
        while offset < conflict.size {
            let len = EXPORT_PIECE.min(conflict.size - offset);
            let mut theirs = pass
                .with_plain(|session| {
                    if node_stamp_at(&session.index, &conflict.path) != Some(conflict.node) {
                        return Err(UprivError::VaultPathNotFound(conflict.path.clone()));
                    }
                    read_store_range(session, &conflict.path, offset, len)
                })
                .map_err(|_| io::Error::other("store copy changed"))?;
            let piece = &mut ours[..len as usize];
            let read = file.read_exact(piece);
            let equal = read.is_ok() && piece[..] == theirs[..];
            theirs.zeroize();
            read?;
            if !equal {
                return Ok(false);
            }
            offset += len;
        }
        Ok(true)
    };
    let result = compare();
    ours.zeroize();
    result
}

/// Make `dir` and the folders above it that the store only implies.
fn ensure_store_dirs(session: &mut OpenSession, dir: &str) -> Result<bool> {
    let mut missing = Vec::new();
    let mut current = Some(dir);
    while let Some(path) = current {
        match session.index.find(path) {
            Some(node) if node.is_dir() => break,
            Some(_) => return Ok(false),
            None => missing.push(path.to_string()),
        }
        current = parent_logical(path);
    }
    for path in missing.iter().rev() {
        stage_mkdir(session, path)?;
    }
    Ok(true)
}

fn add_store_dir(pass: &mut Pass<'_>, dir: &str) -> Result<()> {
    let made = pass.with_plain(|session| {
        let made = ensure_store_dirs(session, dir)?;
        if made {
            plain_mut(session)
                .synced
                .insert(dir.to_string(), Synced::Dir);
        }
        Ok(made)
    })?;
    if made {
        pass.staged += 1;
    } else {
        pass.report.skipped += 1;
    }
    Ok(())
}

fn move_in_store(pass: &mut Pass<'_>, moved: &Move) -> Result<()> {
    let applied = pass.with_plain(|session| {
        if node_stamp_at(&session.index, &moved.from) != Some(moved.node)
            || session.index.find(&moved.to).is_some()
        {
            return Ok(false);
        }
        if let Some(parent) = parent_logical(&moved.to) {
            if !ensure_store_dirs(session, parent)? {
                return Ok(false);
            }
        }
        match stage_move(session, &moved.from, &moved.to) {
            Ok(()) => {}
            Err(UprivError::VaultPathExists(_) | UprivError::VaultPathNotFound(_)) => {
                return Ok(false);
            }
            Err(error) => return Err(error),
        }
        let plain = plain_mut(session);
        plain.synced.remove(&moved.from);
        plain.synced.insert(
            moved.to.clone(),
            Synced::File {
                node: moved.node,
                disk: moved.disk,
            },
        );
        Ok(true)
    })?;
    if applied {
        pass.staged += 1;
        pass.report.saved += 1;
        pass.touched.push(moved.to.clone());
    } else {
        pass.report.retry += 1;
    }
    Ok(())
}

/// Save one folder file into the store. The bytes are encrypted without the
/// session lock; the index only names them if neither side moved meanwhile.
/// `Ok(true)` when the file was saved.
fn import_file(pass: &mut Pass<'_>, import: &Import) -> Result<bool> {
    let os = pass.os(&import.path);
    let mut file = match disk::open_for_import(&os) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(_) => {
            pass.report.retry += 1;
            return Ok(false);
        }
    };
    let opened = match settled_stamp(&os, &file, pass.bridge) {
        Ok(opened) if disk::opened_matches(&import.scanned, &opened, pass.bridge) => opened,
        _ => {
            pass.report.retry += 1;
            return Ok(false);
        }
    };
    let mut reader = CancelReader {
        inner: &mut file,
        cancel: pass.cancel,
    };
    let sealed = match seal_reader(pass.dir, &mut reader, |_| {
        UprivError::ImportSourceUnreadable(PathBuf::new())
    }) {
        Ok(sealed) => sealed,
        Err(UprivError::ImportSourceUnreadable(_)) => {
            pass.report.retry += 1;
            return Ok(false);
        }
        Err(error) => return Err(error),
    };
    let unchanged = matches!(settled_stamp(&os, &file, pass.bridge), Ok(after) if after == opened);
    drop(file);
    if !unchanged {
        pass.report.retry += 1;
        return Ok(false);
    }
    let saved = pass.with_plain(|session| {
        let index = &session.index;
        if node_stamp_at(index, &import.path) != import.expect
            || index.find(&import.path).is_some_and(|node| node.is_dir())
            || !parents_are_dirs(index, &import.path)
        {
            return Ok(None);
        }
        let retired = stage_sealed(session, &import.path, sealed)?;
        let node = node_stamp_at(&session.index, &import.path)
            .ok_or_else(|| UprivError::VaultPathNotFound(import.path.clone()))?;
        plain_mut(session)
            .synced
            .insert(import.path.clone(), Synced::File { node, disk: opened });
        Ok(Some(retired))
    })?;
    let Some(retired) = saved else {
        pass.report.retry += 1;
        return Ok(false);
    };
    pass.retired.extend(retired);
    pass.staged += 1;
    pass.report.saved += 1;
    pass.touched.push(import.path.clone());
    Ok(true)
}

/// The stamp later scans compare with. A storage-access descriptor reports
/// more than the listing does, so the listing row is used there.
fn settled_stamp(os: &Path, file: &crate::host_fs::File, bridge: bool) -> io::Result<DiskStamp> {
    if bridge {
        return match disk::stamp_at(os)? {
            Some(Seen::File(stamp)) => Ok(stamp),
            _ => Err(io::Error::from(io::ErrorKind::NotFound)),
        };
    }
    disk::stamp_of_file(file)
}

/// Make `dir` and its missing parents in the folder, owner-only.
fn ensure_folder_dirs(pass: &mut Pass<'_>, dir: &str) -> Result<()> {
    let mut missing = Vec::new();
    let mut current = Some(dir);
    while let Some(path) = current {
        match disk::stamp_at(&pass.os(path))? {
            Some(Seen::Dir) => break,
            Some(Seen::File(_)) => return Err(UprivError::VaultPathExists(path.to_string())),
            None => missing.push(path.to_string()),
        }
        current = parent_logical(path);
    }
    for path in missing.iter().rev() {
        match disk::make_dir(&pass.os(path)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
    pass.with_plain(|session| {
        let plain = plain_mut(session);
        for path in missing {
            plain.synced.insert(path, Synced::Dir);
        }
        plain.synced.insert(dir.to_string(), Synced::Dir);
        Ok(())
    })
}

fn move_in_folder(pass: &mut Pass<'_>, moved: &Move) -> Result<()> {
    let from = pass.os(&moved.from);
    let to = pass.os(&moved.to);
    if !matches!(disk::stamp_at(&from), Ok(Some(Seen::File(now))) if now == moved.disk) {
        pass.report.retry += 1;
        return Ok(());
    }
    if let Some(parent) = parent_logical(&moved.to) {
        if ensure_folder_dirs(pass, parent).is_err() {
            pass.report.unwritable += 1;
            return Ok(());
        }
    }
    if crate::host_fs::rename_no_replace(&from, &to).is_err() {
        pass.report.retry += 1;
        return Ok(());
    }
    let Ok(Some(Seen::File(disk))) = disk::stamp_at(&to) else {
        pass.report.retry += 1;
        return Ok(());
    };
    pass.with_plain(|session| {
        let plain = plain_mut(session);
        plain.synced.remove(&moved.from);
        plain.synced.insert(
            moved.to.clone(),
            Synced::File {
                node: moved.node,
                disk,
            },
        );
        Ok(())
    })?;
    pass.report.written += 1;
    Ok(())
}

/// Write one store file to the folder through a temporary name, so other
/// apps never see half of it. A replaced copy is overwritten once it is out
/// of the way.
fn export_file(pass: &mut Pass<'_>, export: &Export) -> Result<Step> {
    let target = pass.os(&export.path);
    if let Some(parent) = parent_logical(&export.path) {
        if ensure_folder_dirs(pass, parent).is_err() {
            return Ok(Step::Refused);
        }
    }
    let Some(parent_dir) = target.parent() else {
        return Ok(Step::Refused);
    };
    let Ok((temp, mut file)) = disk::create_temp(parent_dir) else {
        return Ok(Step::Refused);
    };
    let written = write_export(pass, export, &mut file);
    drop(file);
    let complete = match written {
        Ok(complete) => complete,
        Err(error) => {
            discard_temp(pass, &temp);
            return match error {
                UprivError::Io(_) => Ok(Step::Refused),
                // One store file that cannot be read must not stop the rest.
                UprivError::VaultStoreInvalid { .. } => {
                    log_event(LogLevel::Warn, "vault_plain_export_unreadable", &[]);
                    Ok(Step::Refused)
                }
                other => Err(other),
            };
        }
    };
    if !complete {
        discard_temp(pass, &temp);
        return Ok(Step::Changed);
    }
    super::residue::exclude_file(&temp);
    let placed = match &export.replace {
        None => crate::host_fs::rename_no_replace(&temp, &target),
        Some(expected) => replace_checked(pass, &temp, &target, expected),
    };
    if placed.is_err() {
        discard_temp(pass, &temp);
        return Ok(Step::Changed);
    }
    let Ok(Some(Seen::File(disk))) = disk::stamp_at(&target) else {
        return Ok(Step::Changed);
    };
    pass.with_plain(|session| {
        plain_mut(session).synced.insert(
            export.path.clone(),
            Synced::File {
                node: export.node,
                disk,
            },
        );
        Ok(())
    })?;
    Ok(Step::Done)
}

fn discard_temp(pass: &Pass<'_>, temp: &Path) {
    if crate::vault::wipe::wipe_file_then_unlink(temp, pass.wipe).is_err() {
        disk::discard(temp);
    }
}

/// Copy the store version the plan saw into `file`. `Ok(false)` when the
/// store moved on meanwhile or the pass was cancelled.
fn write_export(pass: &Pass<'_>, export: &Export, file: &mut crate::host_fs::File) -> Result<bool> {
    let mut offset = 0u64;
    while offset < export.size {
        if pass.cancelled() {
            return Ok(false);
        }
        let len = EXPORT_PIECE.min(export.size - offset);
        let piece = pass.with_plain(|session| {
            if node_stamp_at(&session.index, &export.path) != Some(export.node) {
                return Ok(None);
            }
            read_store_range(session, &export.path, offset, len).map(Some)
        })?;
        let Some(mut piece) = piece else {
            return Ok(false);
        };
        let written = file.write_all(&piece);
        piece.zeroize();
        written?;
        offset += len;
    }
    Ok(true)
}

fn folder_copy_changed() -> io::Error {
    io::Error::other("folder copy changed")
}

/// Put `temp` in place of `target` when `target` is still the copy the plan
/// saw, then overwrite that old copy.
fn replace_checked(
    pass: &Pass<'_>,
    temp: &Path,
    target: &Path,
    expected: &DiskStamp,
) -> io::Result<()> {
    // Unix replaces in one step, and the open handle keeps the old bytes
    // reachable for the overwrite after the name points at the new file.
    #[cfg(unix)]
    if !pass.bridge {
        if let Ok(mut old) =
            crate::paths::open_nofollow(target, crate::paths::NofollowMode::ReadWrite)
        {
            if disk::stamp_of_file(&old)? != *expected {
                return Err(folder_copy_changed());
            }
            let single = disk::single_name(&old)?;
            crate::host_fs::rename(temp, target)?;
            let never = AtomicBool::new(false);
            if single && overwrite_contents(&mut old, expected.len, pass.wipe, &never).is_err() {
                log_event(LogLevel::Warn, "vault_plain_overwrite_failed", &[]);
            }
            return Ok(());
        }
    }
    replace_via_aside(pass, temp, target, expected)
}

/// Move the old copy to a temporary name, put the new one in its place, then
/// wipe the old one. Windows refuses to replace a file that is open, and a
/// storage-access folder has no handle that outlives a replaced name.
fn replace_via_aside(
    pass: &Pass<'_>,
    temp: &Path,
    target: &Path,
    expected: &DiskStamp,
) -> io::Result<()> {
    let Some(dir) = target.parent() else {
        return Err(folder_copy_changed());
    };
    if !matches!(disk::stamp_at(target)?, Some(Seen::File(now)) if now == *expected) {
        return Err(folder_copy_changed());
    }
    let aside = disk::temp_path(dir);
    crate::host_fs::rename_no_replace(target, &aside)?;
    let moved = match disk::stamp_at(&aside) {
        Ok(Some(Seen::File(moved))) if disk::same_file(&moved, expected) => moved,
        _ => {
            let _ = crate::host_fs::rename_no_replace(&aside, target);
            return Err(folder_copy_changed());
        }
    };
    if let Err(error) = crate::host_fs::rename_no_replace(temp, target) {
        let _ = crate::host_fs::rename_no_replace(&aside, target);
        return Err(error);
    }
    if !matches!(sweep::wipe_path(&aside, &moved, pass.wipe), Ok(true)) {
        log_event(LogLevel::Warn, "vault_plain_overwrite_failed", &[]);
    }
    Ok(())
}

fn delete_in_store(
    pass: &mut Pass<'_>,
    files: &[(String, NodeStamp)],
    dirs: &[String],
) -> Result<()> {
    if files.is_empty() && dirs.is_empty() {
        return Ok(());
    }
    let (removed, retired) = pass.with_plain(|session| {
        let mut removed = Vec::new();
        let mut retired = Vec::new();
        for (path, node) in files {
            if node_stamp_at(&session.index, path) != Some(*node) {
                continue;
            }
            retired.extend(stage_delete(session, path)?);
            plain_mut(session).synced.remove(path);
            removed.push(path.clone());
        }
        for dir in dirs {
            if session
                .index
                .nodes
                .iter()
                .any(|node| disk::is_under(&node.path, dir))
            {
                continue;
            }
            if session.index.find(dir).is_some_and(|node| node.is_dir()) {
                stage_remove_empty_dir(session, dir)?;
            }
            plain_mut(session).synced.remove(dir);
        }
        Ok((removed, retired))
    })?;
    pass.report.saved += removed.len() as u32;
    pass.removed += removed.len() as u32;
    pass.touched.extend(removed);
    pass.retired.extend(retired);
    pass.staged += 1;
    pass.seal(true)
}

fn delete_in_folder(
    pass: &mut Pass<'_>,
    files: &[(String, DiskStamp)],
    dirs: &[String],
) -> Result<()> {
    for (path, disk) in files {
        match sweep::wipe_one(pass.folder, path, disk, pass.wipe) {
            Ok(true) => {
                pass.with_plain(|session| {
                    plain_mut(session).synced.remove(path);
                    Ok(())
                })?;
                pass.report.written += 1;
            }
            Ok(false) => {}
            Err(_) => pass.report.retry += 1,
        }
    }
    for dir in dirs {
        if crate::host_fs::remove_dir(pass.os(dir)).is_ok() {
            pass.with_plain(|session| {
                plain_mut(session).synced.remove(dir);
                Ok(())
            })?;
        }
    }
    Ok(())
}

/// Settle the deletions a mass change left waiting. With `apply`, a file
/// leaves the store while its folder copy is still gone and its store copy is
/// the one last synced. Every other held file that is still missing is
/// written back by the next pass. Returns how many files left the store.
pub(super) fn settle_held(session: &mut OpenSession, apply: bool) -> Result<u32> {
    let plain = session
        .plain
        .as_mut()
        .ok_or_else(|| UprivError::VaultNotOpen(session.vault_id.clone()))?;
    let mut doomed = Vec::new();
    for path in std::mem::take(&mut plain.held) {
        let gone = matches!(
            disk::stamp_at(&disk::os_path(&plain.folder, &path)),
            Ok(None)
        );
        if !gone {
            continue;
        }
        let synced_node = match plain.synced.get(&path) {
            Some(Synced::File { node, .. }) => Some(*node),
            _ => None,
        };
        if apply && synced_node.is_some() && node_stamp_at(&session.index, &path) == synced_node {
            doomed.push(path);
        } else {
            plain.synced.remove(&path);
            plain.pending.insert(path);
        }
    }
    if doomed.is_empty() {
        return Ok(0);
    }
    let mut retired = Vec::new();
    for path in &doomed {
        retired.extend(stage_delete(session, path)?);
    }
    let plain = plain_mut(session);
    for path in &doomed {
        plain.synced.remove(path);
    }
    plain.totals.removed += doomed.len() as u32;
    plain.touched.extend(doomed.iter().cloned());
    seal_staged_sync(session, &retired)?;
    Ok(doomed.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::plain::volume::FsFamily;

    fn stamp(len: u64, modified: i128, inode: u64) -> DiskStamp {
        DiskStamp {
            len,
            modified,
            changed: modified,
            inode: Some((1, inode)),
        }
    }

    fn node(seed: &str) -> NodeStamp {
        NodeStamp::of(seed, 1, &[])
    }

    fn synced_file(seed: &str, disk: DiskStamp) -> Synced {
        Synced::File {
            node: node(seed),
            disk,
        }
    }

    fn session(synced: &[(&str, Synced)]) -> PlainSession {
        let mut plain = PlainSession::for_tests(FsFamily::Posix);
        plain.synced = synced
            .iter()
            .map(|(path, entry)| (path.to_string(), *entry))
            .collect();
        plain
    }

    fn view(entries: &[(&str, Side)]) -> HashMap<String, Side> {
        entries
            .iter()
            .map(|(path, side)| (path.to_string(), *side))
            .collect()
    }

    fn scan(entries: &[(&str, Seen)]) -> Scan {
        Scan {
            entries: entries
                .iter()
                .map(|(path, seen)| (path.to_string(), *seen))
                .collect(),
            ..Scan::default()
        }
    }

    fn file(seed: &str) -> Side {
        Side::File {
            node: node(seed),
            size: 1,
        }
    }

    const LATER: i128 = i128::MAX / 4;

    fn paths<'a>(items: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
        let mut paths: Vec<&str> = items.collect();
        paths.sort_unstable();
        paths
    }

    #[test]
    fn each_side_change_goes_the_other_way() {
        let old = stamp(1, 10, 1);
        let edited = stamp(1, 20, 1);
        let plain = session(&[
            ("store-edit.txt", synced_file("a", old)),
            ("folder-edit.txt", synced_file("b", old)),
            ("both.txt", synced_file("c", old)),
            ("same.txt", synced_file("d", old)),
        ]);
        let plan = plan(
            &view(&[
                ("store-edit.txt", file("a2")),
                ("folder-edit.txt", file("b")),
                ("both.txt", file("c2")),
                ("same.txt", file("d")),
                ("new-in-app.txt", file("e")),
            ]),
            &plain,
            &scan(&[
                ("store-edit.txt", Seen::File(old)),
                ("folder-edit.txt", Seen::File(edited)),
                ("both.txt", Seen::File(edited)),
                ("same.txt", Seen::File(old)),
                ("new-elsewhere.txt", Seen::File(stamp(3, 5, 9))),
            ]),
            false,
            LATER,
        );
        assert_eq!(
            paths(plan.exports.iter().map(|e| e.path.as_str())),
            vec!["new-in-app.txt", "store-edit.txt"]
        );
        assert_eq!(
            paths(plan.imports.iter().map(|i| i.path.as_str())),
            vec!["folder-edit.txt", "new-elsewhere.txt"]
        );
        assert_eq!(plan.conflicts.len(), 1);
        assert_eq!(plan.conflicts[0].path, "both.txt");
    }

    #[test]
    fn a_file_on_both_sides_with_no_snapshot_is_a_conflict() {
        let plan = plan(
            &view(&[("a.txt", file("a"))]),
            &session(&[]),
            &scan(&[("a.txt", Seen::File(stamp(1, 1, 1)))]),
            false,
            LATER,
        );
        assert_eq!(plan.conflicts.len(), 1);
    }

    #[test]
    fn a_closing_pass_only_saves_the_folder() {
        let old = stamp(1, 10, 1);
        let plain = session(&[("a.txt", synced_file("a", old))]);
        let plan = plan(
            &view(&[("a.txt", file("a2")), ("b.txt", file("b"))]),
            &plain,
            &scan(&[
                ("a.txt", Seen::File(old)),
                ("c.txt", Seen::File(stamp(2, 3, 4))),
            ]),
            true,
            LATER,
        );
        assert!(plan.exports.is_empty());
        assert_eq!(plan.imports.len(), 1);
        assert_eq!(plan.imports[0].path, "c.txt");
    }

    #[test]
    fn a_rename_in_the_folder_moves_the_store_file() {
        let disk = stamp(1, 10, 7);
        let plain = session(&[("old.txt", synced_file("a", disk))]);
        let renamed = DiskStamp {
            changed: 99,
            ..disk
        };
        let plan = plan(
            &view(&[("old.txt", file("a"))]),
            &plain,
            &scan(&[("new.txt", Seen::File(renamed))]),
            false,
            LATER,
        );
        assert!(plan.imports.is_empty());
        assert!(plan.store_deletes.is_empty());
        assert_eq!(plan.store_moves.len(), 1);
        assert_eq!(plan.store_moves[0].from, "old.txt");
        assert_eq!(plan.store_moves[0].to, "new.txt");
    }

    #[test]
    fn two_files_with_the_same_move_key_are_not_matched() {
        let disk = stamp(1, 10, 7);
        let plain = session(&[
            ("a.txt", synced_file("a", disk)),
            ("b.txt", synced_file("b", disk)),
        ]);
        let plan = plan(
            &view(&[("a.txt", file("a")), ("b.txt", file("b"))]),
            &plain,
            &scan(&[("c.txt", Seen::File(disk))]),
            false,
            LATER,
        );
        assert!(plan.store_moves.is_empty());
        assert_eq!(plan.imports.len(), 1);
        assert_eq!(plan.store_deletes.len(), 2);
    }

    #[test]
    fn a_rename_in_the_app_moves_the_folder_copy() {
        let disk = stamp(1, 10, 7);
        let plain = session(&[("old.txt", synced_file("a", disk))]);
        let plan = plan(
            &view(&[("new.txt", file("a"))]),
            &plain,
            &scan(&[("old.txt", Seen::File(disk))]),
            false,
            LATER,
        );
        assert!(plan.exports.is_empty());
        assert!(plan.folder_deletes.is_empty());
        assert_eq!(plan.folder_moves.len(), 1);
        assert_eq!(plan.folder_moves[0].to, "new.txt");
    }

    #[test]
    fn many_folder_deletions_are_held_and_a_few_are_applied() {
        let disk = stamp(1, 10, 1);
        let names: Vec<String> = (0..6).map(|n| format!("f{n}.txt")).collect();
        let synced: Vec<(&str, Synced)> = names
            .iter()
            .map(|name| (name.as_str(), synced_file(name, disk)))
            .collect();
        let store: Vec<(&str, Side)> = names
            .iter()
            .map(|name| (name.as_str(), file(name)))
            .collect();
        let plain = session(&synced);

        let held = plan(&view(&store), &plain, &scan(&[]), false, LATER);
        assert_eq!(held.hold.len(), 6);
        assert!(held.store_deletes.is_empty());

        let kept: Vec<(&str, Seen)> = names[2..]
            .iter()
            .map(|name| (name.as_str(), Seen::File(disk)))
            .collect();
        let applied = plan(&view(&store), &plain, &scan(&kept), false, LATER);
        assert!(applied.hold.is_empty());
        assert_eq!(applied.store_deletes.len(), 2);
    }

    #[test]
    fn a_held_deletion_is_released_when_the_file_comes_back() {
        let disk = stamp(1, 10, 1);
        let mut plain = session(&[("a.txt", synced_file("a", disk))]);
        plain.held.insert("a.txt".into());
        let back = plan(
            &view(&[("a.txt", file("a"))]),
            &plain,
            &scan(&[("a.txt", Seen::File(disk))]),
            false,
            LATER,
        );
        assert_eq!(back.unhold, vec!["a.txt".to_string()]);
        let still = plan(
            &view(&[("a.txt", file("a"))]),
            &plain,
            &scan(&[]),
            false,
            LATER,
        );
        assert!(still.unhold.is_empty());
        assert!(still.store_deletes.is_empty());
        assert!(still.hold.is_empty());
    }

    #[test]
    fn nothing_is_deleted_where_the_scan_could_not_look() {
        let disk = stamp(1, 10, 1);
        let plain = session(&[("docs/a.txt", synced_file("a", disk))]);
        let mut seen = scan(&[]);
        seen.unreadable.push("docs".into());
        let plan = plan(
            &view(&[("docs/a.txt", file("a"))]),
            &plain,
            &seen,
            false,
            LATER,
        );
        assert!(plan.store_deletes.is_empty());
        assert!(plan.hold.is_empty());
        assert!(plan.exports.is_empty());

        let mut truncated = scan(&[]);
        truncated.truncated = true;
        let plan = plan_for(&plain, &truncated);
        assert!(plan.store_deletes.is_empty());
    }

    fn plan_for(plain: &PlainSession, seen: &Scan) -> Plan {
        plan(
            &view(&[("docs/a.txt", file("a"))]),
            plain,
            seen,
            false,
            LATER,
        )
    }

    #[test]
    fn a_folder_copy_is_deleted_only_while_unchanged() {
        let disk = stamp(1, 10, 1);
        let plain = session(&[("a.txt", synced_file("a", disk))]);
        let unchanged = plan(
            &view(&[]),
            &plain,
            &scan(&[("a.txt", Seen::File(disk))]),
            false,
            LATER,
        );
        assert_eq!(unchanged.folder_deletes.len(), 1);
        let edited = stamp(2, 20, 1);
        let changed = plan(
            &view(&[]),
            &plain,
            &scan(&[("a.txt", Seen::File(edited))]),
            false,
            LATER,
        );
        assert!(changed.folder_deletes.is_empty());
        assert_eq!(changed.imports.len(), 1);
    }

    #[test]
    fn a_file_still_being_written_waits_except_on_close() {
        let busy = scan(&[("busy.bin", Seen::File(stamp(5, 1_000, 3)))]);
        let now = 1_000 + SETTLE_NANOS / 2;
        let open = plan(&view(&[]), &session(&[]), &busy, false, now);
        assert!(open.imports.is_empty());
        assert_eq!(open.retry, 1);
        let closing = plan(&view(&[]), &session(&[]), &busy, true, now);
        assert_eq!(closing.imports.len(), 1);
    }

    #[test]
    fn names_the_folder_would_merge_or_refuse_are_not_written() {
        let plain = PlainSession::for_tests(FsFamily::Windows);
        let plan = plan(
            &view(&[
                ("Readme.txt", file("a")),
                ("bad:name.txt", file("b")),
                ("x.txt", file("c")),
                ("X.TXT", file("d")),
            ]),
            &plain,
            &scan(&[("README.txt", Seen::File(stamp(1, 1, 1)))]),
            false,
            LATER,
        );
        assert_eq!(plan.exports.len(), 1);
        assert_eq!(plan.unwritable, 3);
    }

    #[test]
    fn an_emptied_folder_tree_leaves_the_store_and_a_kept_one_comes_back() {
        let disk = stamp(1, 10, 1);
        let plain = session(&[
            ("docs", Synced::Dir),
            ("docs/a.txt", synced_file("a", disk)),
        ]);
        let gone = plan(
            &view(&[("docs", Side::Dir), ("docs/a.txt", file("a"))]),
            &plain,
            &scan(&[]),
            false,
            LATER,
        );
        assert_eq!(gone.store_deletes.len(), 1);
        assert_eq!(gone.store_dir_deletes, vec!["docs".to_string()]);

        let kept = plan(
            &view(&[
                ("docs", Side::Dir),
                ("docs/a.txt", file("a")),
                ("docs/new.txt", file("n")),
            ]),
            &plain,
            &scan(&[]),
            false,
            LATER,
        );
        assert!(kept.store_dir_deletes.is_empty());
        assert_eq!(kept.folder_dirs, vec!["docs".to_string()]);
    }

    #[test]
    fn reserved_store_paths_never_reach_the_folder() {
        let mut index = VaultIndex::empty();
        crate::store::mkdir_logical(&mut index, "docs").unwrap();
        for (path, file_id) in [
            ("docs/a.txt", "a"),
            (crate::store::PLAIN_POLICY_FILE, "policy"),
        ] {
            crate::store::record_imported_file(
                &mut index,
                path,
                file_id.to_string(),
                0,
                Vec::new(),
                Vec::new(),
                None,
            )
            .unwrap();
        }
        let view = store_view(&index);
        assert!(view.contains_key("docs/a.txt"));
        assert!(!view.contains_key(crate::store::PLAIN_POLICY_FILE));
    }

    #[test]
    fn conflict_names_keep_the_extension_and_skip_taken_names() {
        let stamp = "2026-10-16 142501";
        let first = conflict_name("docs/notes.txt", stamp, |_| false).unwrap();
        assert_eq!(first, "docs/notes (conflict 2026-10-16 142501).txt");
        let second = conflict_name("docs/notes.txt", stamp, |name| name == first).unwrap();
        assert_eq!(second, "docs/notes (conflict 2026-10-16 142501 2).txt");
        assert_eq!(
            conflict_name(".bashrc", stamp, |_| false).unwrap(),
            ".bashrc (conflict 2026-10-16 142501)"
        );
        let long = format!("{}.txt", "é".repeat(200));
        let cut = conflict_name(&long, stamp, |_| false).unwrap();
        assert!(cut.len() <= LOGICAL_NAME_MAX);
        assert!(cut.ends_with(").txt"));
        assert!(conflict_name("a.txt", stamp, |_| true).is_none());
    }
}
