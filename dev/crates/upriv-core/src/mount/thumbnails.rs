//! Freedesktop thumbnail cache cleanup for a Linux vault folder: a
//! file-manager mount or a plaintext vault's folder.
//!
//! Nautilus treats a `fuse` mount as local and writes PNG previews under
//! `$XDG_CACHE_HOME/thumbnails`; it does the same for any plaintext folder.
//! Those files stay after the folder is gone. Close overwrites those PNGs,
//! syncs, and unlinks the ones whose `Thumb::URI` is under that folder. While
//! the vault is open, the same wipe runs on [`OPEN_PURGE_INTERVAL`]. The scan
//! does not run on the close or open path. A wipe writes one info line with
//! the count. A bad cache writes one warning.
//!
//! Windows does not use this scanner. Explorer's `thumbcache_*.db` is a
//! machine-wide hash cache, so the WinFsp mount prevents preview generation
//! instead of editing those files. See `explorer`.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::{HashSet, VecDeque};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use crate::logging::{log_event, LogLevel};

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const THUMB_URI_KEYWORD: &str = "Thumb::URI";
const THUMB_SIZE_DIRS: &[&str] = &["normal", "large", "x-large", "xx-large", "fail"];
/// A thumbnail text chunk is a URI. Refuse anything larger so a hostile cache
/// file cannot force a huge allocation.
const MAX_TEXT_CHUNK: u64 = 64 * 1024;
/// `Thumb::URI` sits near the front of a freedesktop PNG. Stop if it does not.
const MAX_PNG_CHUNKS: u32 = 32;
const MAX_CACHE_ENTRIES: u32 = 50_000;
const MAX_PNG_LEN: u64 = 8 * 1024 * 1024;
const PURGE_BUDGET: Duration = Duration::from_secs(20);
/// How often to wipe previews while a vault folder is open.
const OPEN_PURGE_INTERVAL: Duration = Duration::from_secs(2 * 60);
/// One blocked read must not be silent forever. Later requests log once.
const PURGE_STUCK_AFTER: Duration = Duration::from_secs(30);

static SCHEDULE_CV: Condvar = Condvar::new();

/// Remember `folder` until [`unwatch_vault_folder`]. The wipe then runs on
/// [`OPEN_PURGE_INTERVAL`]. A relative path or `/` is ignored.
pub(crate) fn watch_vault_folder(folder: &Path) {
    #[cfg(target_os = "linux")]
    watch_vault_folder_linux(folder);
    #[cfg(not(target_os = "linux"))]
    let _ = folder;
}

#[cfg(target_os = "linux")]
fn watch_vault_folder_linux(folder: &Path) {
    if !folder_is_specific(folder) {
        return;
    }
    let mut schedule = schedule_lock();
    schedule.watch(folder.to_path_buf(), Instant::now());
    let failed = ensure_worker(&mut schedule);
    drop(schedule);
    SCHEDULE_CV.notify_one();
    if failed {
        log_purge_problem();
    }
}

/// Stop the periodic wipe for `folder`. A purge already queued still runs.
pub(crate) fn unwatch_vault_folder(folder: &Path) {
    #[cfg(target_os = "linux")]
    unwatch_vault_folder_linux(folder);
    #[cfg(not(target_os = "linux"))]
    let _ = folder;
}

#[cfg(target_os = "linux")]
fn unwatch_vault_folder_linux(folder: &Path) {
    let mut schedule = schedule_lock();
    schedule.unwatch(folder);
    drop(schedule);
    SCHEDULE_CV.notify_one();
}

/// Delete thumbnail-cache PNGs whose URI is under `folder`.
///
/// Returns before the scan finishes. A relative path or `/` is ignored so a
/// bad folder cannot wipe the whole cache. Each matching PNG is
/// overwritten and synced before its name is removed. When at least one
/// preview is wiped, an info line records the count and not the file. A cache
/// that cannot be read, a wipe that cannot finish, or a scan that hits its
/// budget, is a separate warning. Close and open do not wait and do not fail.
pub(crate) fn purge_folder_thumbnails(folder: &Path) {
    #[cfg(target_os = "linux")]
    purge_folder_thumbnails_linux(folder);
    #[cfg(not(target_os = "linux"))]
    let _ = folder;
}

#[cfg(target_os = "linux")]
fn purge_folder_thumbnails_linux(folder: &Path) {
    if !folder_is_specific(folder) {
        return;
    }
    let mut schedule = schedule_lock();
    let stuck = schedule.request(folder.to_path_buf(), Instant::now());
    let failed = ensure_worker(&mut schedule);
    drop(schedule);
    SCHEDULE_CV.notify_one();
    if stuck || failed {
        log_purge_problem();
    }
}

fn schedule_lock() -> MutexGuard<'static, Schedule> {
    static SCHEDULE: OnceLock<Mutex<Schedule>> = OnceLock::new();
    SCHEDULE
        .get_or_init(|| Mutex::new(Schedule::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn ensure_worker(schedule: &mut Schedule) -> bool {
    if schedule.worker_alive {
        return false;
    }
    schedule.worker_alive = true;
    let spawned = std::thread::Builder::new()
        .name("upriv-thumb-purge".into())
        .spawn(worker_loop);
    if spawned.is_err() {
        schedule.worker_alive = false;
        return true;
    }
    false
}

fn worker_loop() {
    loop {
        let job = {
            let mut schedule = schedule_lock();
            loop {
                if let Some(path) = schedule.pop_job(Instant::now()) {
                    break Some(path);
                }
                if schedule.mounts.is_empty() {
                    schedule.worker_alive = false;
                    break None;
                }
                let Some(tick) = schedule.next_tick else {
                    schedule.worker_alive = false;
                    break None;
                };
                let wait = tick.saturating_duration_since(Instant::now());
                let (guard, _) = SCHEDULE_CV
                    .wait_timeout(schedule, wait)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                schedule = guard;
            }
        };
        let Some(path) = job else {
            return;
        };
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            purge_thumbnail_caches(&path, &thumbnail_cache_roots(), &ScanLimit::product())
        }));
        match outcome {
            Ok(scan) => {
                if scan.removed > 0 {
                    log_thumbnails_wiped(scan.removed);
                }
                if scan.fault.is_some() {
                    log_purge_problem();
                }
            }
            Err(_) => log_purge_problem(),
        }
        let mut schedule = schedule_lock();
        schedule.finish_job();
    }
}

fn log_thumbnails_wiped(count: u32) {
    let count = count.to_string();
    log_event(
        LogLevel::Info,
        "vault_thumbnail_wiped",
        &[("count", count.as_str())],
    );
}

fn log_purge_problem() {
    log_event(LogLevel::Warn, "vault_thumbnail_purge_failed", &[]);
}

struct Schedule {
    mounts: HashSet<PathBuf>,
    pending: VecDeque<PathBuf>,
    running: Option<PathBuf>,
    rerun: bool,
    next_tick: Option<Instant>,
    worker_alive: bool,
    running_since: Option<Instant>,
    stuck_logged: bool,
}

impl Schedule {
    fn new() -> Self {
        Self {
            mounts: HashSet::new(),
            pending: VecDeque::new(),
            running: None,
            rerun: false,
            next_tick: None,
            worker_alive: false,
            running_since: None,
            stuck_logged: false,
        }
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    fn watch(&mut self, path: PathBuf, now: Instant) {
        if !folder_is_specific(&path) {
            return;
        }
        let first = self.mounts.is_empty();
        self.mounts.insert(path);
        if first {
            self.next_tick = Some(now + OPEN_PURGE_INTERVAL);
        }
    }

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    fn unwatch(&mut self, path: &Path) {
        self.mounts.remove(path);
        if self.mounts.is_empty() {
            self.next_tick = None;
        }
    }

    /// Queue `path` once. A request for the scan already running asks for one
    /// more pass when that scan finishes. Returns true when that scan has been
    /// running longer than [`PURGE_STUCK_AFTER`].
    fn request(&mut self, path: PathBuf, now: Instant) -> bool {
        if !folder_is_specific(&path) {
            return false;
        }
        let stuck = self.note_stuck(now);
        if self.running.as_ref() == Some(&path) {
            self.rerun = true;
            return stuck;
        }
        if !self.pending.iter().any(|queued| queued == &path) {
            self.pending.push_back(path);
        }
        stuck
    }

    fn note_stuck(&mut self, now: Instant) -> bool {
        let Some(started) = self.running_since else {
            return false;
        };
        if now.saturating_duration_since(started) <= PURGE_STUCK_AFTER || self.stuck_logged {
            return false;
        }
        self.stuck_logged = true;
        true
    }

    fn enqueue_due(&mut self, now: Instant) {
        let Some(tick) = self.next_tick else {
            return;
        };
        if now < tick {
            return;
        }
        self.next_tick = Some(now + OPEN_PURGE_INTERVAL);
        let mounts: Vec<PathBuf> = self.mounts.iter().cloned().collect();
        for path in mounts {
            let _ = self.request(path, now);
        }
    }

    fn pop_job(&mut self, now: Instant) -> Option<PathBuf> {
        self.enqueue_due(now);
        let path = self.pending.pop_front()?;
        self.running = Some(path.clone());
        self.rerun = false;
        self.running_since = Some(now);
        self.stuck_logged = false;
        Some(path)
    }

    fn finish_job(&mut self) {
        let Some(path) = self.running.take() else {
            return;
        };
        self.running_since = None;
        if self.rerun {
            self.rerun = false;
            if !self.pending.iter().any(|queued| queued == &path) {
                self.pending.push_back(path);
            }
        }
    }
}

fn thumbnail_cache_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(xdg) = std::env::var_os("XDG_CACHE_HOME") {
        if !xdg.is_empty() {
            roots.push(PathBuf::from(xdg).join("thumbnails"));
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        if !home.is_empty() {
            let home = PathBuf::from(home);
            roots.push(home.join(".cache").join("thumbnails"));
            roots.push(home.join(".thumbnails"));
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

struct ScanLimit {
    max_entries: u32,
    max_file_len: u64,
    deadline: Instant,
}

impl ScanLimit {
    fn product() -> Self {
        Self {
            max_entries: MAX_CACHE_ENTRIES,
            max_file_len: MAX_PNG_LEN,
            deadline: Instant::now() + PURGE_BUDGET,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PurgeFault {
    Unreadable,
    Stopped,
}

struct ThumbnailScan {
    removed: u32,
    fault: Option<PurgeFault>,
}

fn purge_thumbnail_caches(
    mount_point: &Path,
    caches: &[PathBuf],
    limit: &ScanLimit,
) -> ThumbnailScan {
    if !folder_is_specific(mount_point) {
        return ThumbnailScan {
            removed: 0,
            fault: None,
        };
    }
    let mut removed = 0u32;
    let mut fault = None;
    let mut seen = 0u32;
    for cache in caches {
        for dir_name in THUMB_SIZE_DIRS {
            let scan = purge_thumbnail_dir(&cache.join(dir_name), mount_point, limit, &mut seen);
            removed = removed.saturating_add(scan.removed);
            if fault.is_none() {
                fault = scan.fault;
            }
            if matches!(scan.fault, Some(PurgeFault::Stopped)) {
                return ThumbnailScan { removed, fault };
            }
        }
    }
    ThumbnailScan { removed, fault }
}

/// Overwrite the preview, sync it, then unlink. One random pass is the vault
/// wipe default. If the overwrite fails, the name is still removed and the
/// caller logs the miss.
fn discard_thumbnail_file(path: &Path) -> Result<(), ()> {
    let opts = crate::vault::wipe::WipeOptions {
        passes: 1,
        pattern: crate::config::vault_config::VaultWipePattern::Random,
    };
    if crate::vault::wipe::secure_wipe_path(path, &opts).is_ok() {
        return Ok(());
    }
    match std::fs::remove_file(path) {
        Ok(()) => Err(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(()),
    }
}

fn folder_is_specific(folder: &Path) -> bool {
    folder.is_absolute() && folder != Path::new("/")
}

fn purge_thumbnail_dir(
    dir: &Path,
    mount_point: &Path,
    limit: &ScanLimit,
    seen: &mut u32,
) -> ThumbnailScan {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return ThumbnailScan {
                removed: 0,
                fault: None,
            };
        }
        Err(_) => {
            return ThumbnailScan {
                removed: 0,
                fault: Some(PurgeFault::Unreadable),
            };
        }
    };
    let mut removed = 0u32;
    let mut wipe_failed = false;
    for entry in entries {
        if Instant::now() >= limit.deadline || *seen >= limit.max_entries {
            return ThumbnailScan {
                removed,
                fault: Some(PurgeFault::Stopped),
            };
        }
        let Ok(entry) = entry else {
            continue;
        };
        *seen = seen.saturating_add(1);
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // `file_type` does not follow symlinks. A link is not a cache PNG.
        if !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("png") {
            continue;
        }
        // A freedesktop preview is a small PNG. Skip anything larger so one
        // odd file cannot make the scan read for a long time.
        match entry.metadata() {
            Ok(meta) if meta.len() > limit.max_file_len => continue,
            Ok(_) => {}
            Err(_) => continue,
        }
        let Ok(mut file) = File::open(&path) else {
            continue;
        };
        let Some(uri) = png_thumb_uri(&mut file) else {
            continue;
        };
        if !uri_is_under_folder(&uri, mount_point) {
            continue;
        }
        match discard_thumbnail_file(&path) {
            Ok(()) => removed = removed.saturating_add(1),
            Err(()) => wipe_failed = true,
        }
    }
    ThumbnailScan {
        removed,
        fault: wipe_failed.then_some(PurgeFault::Unreadable),
    }
}

fn png_thumb_uri(file: &mut File) -> Option<String> {
    let mut signature = [0u8; 8];
    file.read_exact(&mut signature).ok()?;
    if &signature != PNG_SIGNATURE {
        return None;
    }
    for _ in 0..MAX_PNG_CHUNKS {
        let pos = file.stream_position().ok()?;
        let mut len_buf = [0u8; 4];
        file.read_exact(&mut len_buf).ok()?;
        let len = u32::from_be_bytes(len_buf) as u64;
        let mut kind = [0u8; 4];
        file.read_exact(&mut kind).ok()?;
        if &kind == b"tEXt" {
            if len > MAX_TEXT_CHUNK {
                return None;
            }
            let mut data = vec![0u8; len as usize];
            file.read_exact(&mut data).ok()?;
            let mut crc_buf = [0u8; 4];
            file.read_exact(&mut crc_buf).ok()?;
            if png_crc(&kind, &data) != u32::from_be_bytes(crc_buf) {
                return None;
            }
            if let Some(uri) = text_value(&data, THUMB_URI_KEYWORD) {
                return Some(uri);
            }
            continue;
        }
        if &kind == b"IEND" {
            return None;
        }
        file.seek(SeekFrom::Current(
            i64::try_from(len.saturating_add(4)).ok()?,
        ))
        .ok()?;
        let next = file.stream_position().ok()?;
        if next <= pos {
            return None;
        }
    }
    None
}

fn text_value(chunk: &[u8], keyword: &str) -> Option<String> {
    let split = chunk.iter().position(|byte| *byte == 0)?;
    if chunk[..split] != *keyword.as_bytes() {
        return None;
    }
    let value = &chunk[split + 1..];
    if !value.is_ascii() {
        return None;
    }
    String::from_utf8(value.to_vec()).ok()
}

/// PNG CRC-32 over the chunk type and data (ISO-3309).
fn png_crc(kind: &[u8], data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in kind.iter().chain(data) {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

/// True when `uri` is a `file://` URI for `folder` or a path inside it.
pub(crate) fn uri_is_under_folder(uri: &str, folder: &Path) -> bool {
    let Some(path) = file_uri_path(uri) else {
        return false;
    };
    let folder = normalize_absolute(folder);
    let candidate = normalize_absolute(&path);
    if folder.as_os_str().is_empty() || candidate.as_os_str().is_empty() {
        return false;
    }
    candidate == folder || candidate.starts_with(&folder)
}

fn file_uri_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let encoded = if let Some(path) = rest.strip_prefix("localhost/") {
        let mut absolute = String::from("/");
        absolute.push_str(path);
        absolute
    } else if rest.starts_with('/') {
        rest.to_string()
    } else {
        return None;
    };
    let decoded = percent_decode(&encoded)?;
    if !decoded.starts_with('/') {
        return None;
    }
    Some(PathBuf::from(decoded))
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let hi = hex_nibble(bytes[index + 1])?;
            let lo = hex_nibble(bytes[index + 2])?;
            out.push((hi << 4) | lo);
            index += 3;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).ok()
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Collapse `.` and `..` without touching the filesystem.
fn normalize_absolute(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir => out.push(component.as_os_str()),
            Component::Normal(part) => out.push(part),
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finished(scan: ThumbnailScan) -> u32 {
        assert_eq!(scan.fault, None);
        scan.removed
    }

    fn absolute_mount(name: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(format!(r"C:\mnt\{name}"))
        } else {
            PathBuf::from(format!("/mnt/{name}"))
        }
    }

    #[test]
    fn open_mount_purge_waits_one_interval_then_queues_each_mount_once() {
        let start = Instant::now();
        let mut schedule = Schedule::new();
        let first = absolute_mount("vault");
        let second = absolute_mount("other");
        schedule.watch(first.clone(), start);
        schedule.watch(second.clone(), start);
        schedule.enqueue_due(start);
        assert!(schedule.pending.is_empty());

        let due = start + OPEN_PURGE_INTERVAL;
        schedule.enqueue_due(due);
        assert_eq!(schedule.pending.len(), 2);
        schedule.enqueue_due(due);
        assert_eq!(schedule.pending.len(), 2);
        assert!(schedule.pop_job(due).is_some());
        schedule.finish_job();
        assert!(schedule.pop_job(due).is_some());
        schedule.finish_job();
        assert!(schedule.pending.is_empty());

        schedule.unwatch(&second);
        schedule.enqueue_due(due + OPEN_PURGE_INTERVAL);
        let queued: Vec<PathBuf> = schedule.pending.iter().cloned().collect();
        assert_eq!(queued, vec![first]);
    }

    #[test]
    fn a_repeated_purge_request_queues_one_extra_pass() {
        let now = Instant::now();
        let mut schedule = Schedule::new();
        let mount = absolute_mount("vault");
        assert!(!schedule.request(PathBuf::from("relative"), now));
        assert!(!schedule.request(PathBuf::from("/"), now));
        assert!(schedule.pending.is_empty());

        assert!(!schedule.request(mount.clone(), now));
        assert!(!schedule.request(mount.clone(), now));
        assert_eq!(schedule.pending.len(), 1);

        let job = schedule.pop_job(now).expect("queued");
        assert_eq!(job, mount);
        assert!(!schedule.request(mount.clone(), now));
        assert!(schedule.pending.is_empty());
        assert!(schedule.rerun);
        schedule.finish_job();
        assert_eq!(schedule.pending.len(), 1);
        assert!(schedule.pop_job(now).is_some());
        schedule.finish_job();
        assert!(schedule.pending.is_empty());
        assert!(!schedule.rerun);
    }

    #[test]
    fn a_long_running_scan_is_reported_once() {
        let start = Instant::now();
        let mut schedule = Schedule::new();
        let mount = absolute_mount("vault");
        schedule.request(mount.clone(), start);
        schedule.pop_job(start);
        assert!(!schedule.request(mount.clone(), start + Duration::from_secs(29)));
        assert!(schedule.request(
            mount.clone(),
            start + PURGE_STUCK_AFTER + Duration::from_secs(1)
        ));
        assert!(!schedule.request(mount, start + PURGE_STUCK_AFTER + Duration::from_secs(2)));
    }

    fn text_chunk(keyword_and_value: &[u8]) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&(keyword_and_value.len() as u32).to_be_bytes());
        chunk.extend_from_slice(b"tEXt");
        chunk.extend_from_slice(keyword_and_value);
        let crc = png_crc(b"tEXt", keyword_and_value);
        chunk.extend_from_slice(&crc.to_be_bytes());
        chunk
    }

    fn thumb_png(uri: &str) -> Vec<u8> {
        let mut body = format!("{THUMB_URI_KEYWORD}\0{uri}").into_bytes();
        let mut png = Vec::new();
        png.extend_from_slice(PNG_SIGNATURE);
        let software = b"Software\0test";
        png.extend(text_chunk(software));
        png.extend(text_chunk(&std::mem::take(&mut body)));
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        let crc = png_crc(b"IEND", b"");
        png.extend_from_slice(&crc.to_be_bytes());
        png
    }

    #[test]
    fn png_crc_matches_the_iso_3309_vector() {
        let data = b"Thumb::URI\x00file:///mnt/vault/a.png";
        assert_eq!(png_crc(b"tEXt", data), 0xdcc0_6d3b);
    }

    #[cfg(unix)]
    #[test]
    fn purge_removes_only_pngs_under_the_mount() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("thumbnails");
        let mount = Path::new("/mnt/vault");
        for dir in ["normal", "large", "fail", "other"] {
            std::fs::create_dir_all(cache.join(dir)).unwrap();
        }
        std::fs::write(
            cache.join("large/under.png"),
            thumb_png("file:///mnt/vault/photos/a%20b.png"),
        )
        .unwrap();
        std::fs::write(
            cache.join("normal/root.png"),
            thumb_png("file:///mnt/vault"),
        )
        .unwrap();
        std::fs::write(
            cache.join("fail/localhost.png"),
            thumb_png("file://localhost/mnt/vault/nested/file.png"),
        )
        .unwrap();
        std::fs::write(
            cache.join("large/sibling.png"),
            thumb_png("file:///mnt/vault-extra/a.png"),
        )
        .unwrap();
        std::fs::write(
            cache.join("large/escape.png"),
            thumb_png("file:///mnt/vault/../other/a.png"),
        )
        .unwrap();
        std::fs::write(
            cache.join("normal/mtp.png"),
            thumb_png("mtp://device/mnt/vault/a.png"),
        )
        .unwrap();
        std::fs::write(cache.join("large/note.txt"), b"not-a-png").unwrap();
        let mut bad = thumb_png("file:///mnt/vault/bad.png");
        let needle = b"file:///mnt/vault/bad.png";
        let pos = bad
            .windows(needle.len())
            .position(|window| window == needle)
            .expect("uri");
        bad[pos] ^= 0xff;
        std::fs::write(cache.join("normal/bad-crc.png"), bad).unwrap();
        std::fs::write(
            cache.join("other/ignored.png"),
            thumb_png("file:///mnt/vault/ignored.png"),
        )
        .unwrap();

        let removed = finished(purge_thumbnail_caches(
            mount,
            std::slice::from_ref(&cache),
            &ScanLimit::product(),
        ));
        assert_eq!(removed, 3);
        assert!(!cache.join("large/under.png").exists());
        assert!(!cache.join("normal/root.png").exists());
        assert!(!cache.join("fail/localhost.png").exists());
        assert!(cache.join("large/sibling.png").exists());
        assert!(cache.join("large/escape.png").exists());
        assert!(cache.join("normal/mtp.png").exists());
        assert!(cache.join("large/note.txt").exists());
        assert!(cache.join("normal/bad-crc.png").exists());
        assert!(cache.join("other/ignored.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn purge_overwrites_png_bytes_before_the_name_is_removed() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("thumbnails");
        std::fs::create_dir_all(cache.join("large")).unwrap();
        let png = cache.join("large/preview.png");
        let body = thumb_png("file:///mnt/vault/photo.png");
        std::fs::write(&png, &body).unwrap();
        let kept = cache.join("large/preview.kept");
        std::fs::hard_link(&png, &kept).unwrap();

        let removed = finished(purge_thumbnail_caches(
            Path::new("/mnt/vault"),
            &[cache],
            &ScanLimit::product(),
        ));

        assert_eq!(removed, 1);
        assert!(!png.exists());
        let overwritten = std::fs::read(&kept).unwrap();
        assert_eq!(overwritten.len(), body.len());
        assert_ne!(overwritten, body);
        let marker = b"file:///mnt/vault/photo.png";
        assert!(!overwritten
            .windows(marker.len())
            .any(|window| window == marker));
    }

    #[cfg(unix)]
    #[test]
    fn purge_refuses_the_filesystem_root() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("thumbnails");
        std::fs::create_dir_all(cache.join("large")).unwrap();
        std::fs::write(
            cache.join("large/keep.png"),
            thumb_png("file:///mnt/vault/a.png"),
        )
        .unwrap();
        let removed = finished(purge_thumbnail_caches(
            Path::new("/"),
            std::slice::from_ref(&cache),
            &ScanLimit::product(),
        ));
        assert_eq!(removed, 0);
        assert!(cache.join("large/keep.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn purge_skips_an_oversized_png_and_stops_when_the_budget_is_spent() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("thumbnails");
        std::fs::create_dir_all(cache.join("large")).unwrap();
        let png = cache.join("large/big.png");
        std::fs::write(&png, thumb_png("file:///mnt/vault/a.png")).unwrap();
        let mount = Path::new("/mnt/vault");
        let skipped = ScanLimit {
            max_entries: MAX_CACHE_ENTRIES,
            max_file_len: 8,
            deadline: Instant::now() + Duration::from_secs(20),
        };
        let removed = finished(purge_thumbnail_caches(
            mount,
            std::slice::from_ref(&cache),
            &skipped,
        ));
        assert_eq!(removed, 0);
        assert!(png.exists());

        let stopped = ScanLimit {
            max_entries: 0,
            max_file_len: MAX_PNG_LEN,
            deadline: Instant::now() + Duration::from_secs(20),
        };
        let scan = purge_thumbnail_caches(mount, std::slice::from_ref(&cache), &stopped);
        assert_eq!(scan.removed, 0);
        assert_eq!(scan.fault, Some(PurgeFault::Stopped));
        assert!(png.exists());
    }

    #[cfg(unix)]
    #[test]
    fn purge_keeps_a_png_whose_uri_is_buried_past_the_chunk_cap() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("thumbnails");
        std::fs::create_dir_all(cache.join("normal")).unwrap();
        let mut png = Vec::from(PNG_SIGNATURE.as_slice());
        for _ in 0..MAX_PNG_CHUNKS {
            png.extend_from_slice(&0u32.to_be_bytes());
            png.extend_from_slice(b"xxxx");
            png.extend_from_slice(&png_crc(b"xxxx", b"").to_be_bytes());
        }
        let uri = b"Thumb::URI\x00file:///mnt/vault/late.png";
        png.extend_from_slice(&(uri.len() as u32).to_be_bytes());
        png.extend_from_slice(b"tEXt");
        png.extend_from_slice(uri);
        png.extend_from_slice(&png_crc(b"tEXt", uri).to_be_bytes());
        let path = cache.join("normal/late.png");
        std::fs::write(&path, png).unwrap();
        let removed = finished(purge_thumbnail_caches(
            Path::new("/mnt/vault"),
            std::slice::from_ref(&cache),
            &ScanLimit::product(),
        ));
        assert_eq!(removed, 0);
        assert!(path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn purge_reports_an_unreadable_cache_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("thumbnails");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::write(cache.join("large"), b"not-a-directory").unwrap();
        let scan = purge_thumbnail_caches(Path::new("/mnt/vault"), &[cache], &ScanLimit::product());
        assert_eq!(scan.removed, 0);
        assert_eq!(scan.fault, Some(PurgeFault::Unreadable));
    }
}
