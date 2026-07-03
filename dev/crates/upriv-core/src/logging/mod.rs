//! Rotating application log files under `.upriv/logs/` (SDD §6, `[logging]`).
//!
//! Each line is `NNNN <iso-millis> <LEVEL> <event> <fields>`, where `NNNN` is the
//! per-file 1-based index. The active file is prefixed `current-`; rotation drops
//! that prefix and starts a fresh `current-` file when `entries_per_file` is reached.
//! Retention prunes oldest archived files per `keep_last_entries`.

use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::config::load_app_settings;
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;

/// Serialize concurrent appends from multiple Tauri command threads.
static LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn parse(value: &str) -> LogLevel {
        match value.trim().to_ascii_lowercase().as_str() {
            "trace" => LogLevel::Trace,
            "debug" => LogLevel::Debug,
            "warn" | "warning" => LogLevel::Warn,
            "error" => LogLevel::Error,
            _ => LogLevel::Info,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Trace => "TRACE",
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }
}

/// Rotated log file (maps to desktop `AppLogFile`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileDto {
    pub filename: String,
    pub seq: u32,
    pub is_current: bool,
    pub created_at: String,
    pub size_bytes: u64,
    pub line_count: u32,
    pub content: String,
}

struct LogFileMeta {
    path: PathBuf,
    filename: String,
    seq: u32,
    is_current: bool,
    compact_ts: String,
}

/// Append one log entry (no-op when disabled or below the configured level).
pub fn append_log(root: &VaultRoot, level: LogLevel, event: &str, fields: &str) -> Result<()> {
    let settings = load_app_settings(root)?;
    if !settings.logging.enabled {
        return Ok(());
    }
    if level < LogLevel::parse(&settings.logging.level) {
        return Ok(());
    }

    let _guard = LOG_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let dir = root.logs_dir(&settings);
    fs::create_dir_all(&dir)?;

    let entries_per_file = settings.logging.entries_per_file.max(1);
    let mut files = scan_log_files(&dir)?;
    let max_seq = files.iter().map(|f| f.seq).max().unwrap_or(0);

    let mut current = take_current(&mut files);

    // Rotate when the active file is full.
    if let Some(meta) = &current {
        let lines = count_lines(&meta.path)?;
        if lines >= entries_per_file {
            archive_current(meta)?;
            current = None;
        }
    }

    let (path, next_index) = match current {
        Some(meta) => {
            let next = count_lines(&meta.path)? + 1;
            (meta.path, next)
        }
        None => {
            let next_seq = max_seq + 1;
            let compact = compact_timestamp();
            let filename = format!("current-{next_seq:06}-{compact}.log");
            (dir.join(filename), 1)
        }
    };

    let line = format!(
        "{:04} {} {} {}{}\n",
        next_index,
        iso_millis(),
        level.as_str(),
        event,
        if fields.trim().is_empty() {
            String::new()
        } else {
            format!(" {}", fields.trim())
        }
    );

    use std::io::Write;
    let mut file = fs::OpenOptions::new().create(true).append(true).open(&path)?;
    file.write_all(line.as_bytes())?;

    prune_logs(&dir, &settings)?;
    Ok(())
}

pub fn list_log_files(root: &VaultRoot) -> Result<Vec<LogFileDto>> {
    let settings = load_app_settings(root)?;
    let dir = root.logs_dir(&settings);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let metas = scan_log_files(&dir)?;
    let mut out = Vec::with_capacity(metas.len());
    for meta in metas {
        out.push(read_dto(&meta)?);
    }
    out.sort_by(|a, b| {
        b.is_current
            .cmp(&a.is_current)
            .then_with(|| b.created_at.cmp(&a.created_at))
            .then_with(|| b.seq.cmp(&a.seq))
    });
    Ok(out)
}

pub fn read_log_file(root: &VaultRoot, filename: &str) -> Result<LogFileDto> {
    let settings = load_app_settings(root)?;
    let dir = root.logs_dir(&settings);
    let meta = scan_log_files(&dir)?
        .into_iter()
        .find(|m| m.filename == filename)
        .ok_or_else(|| UprivError::WorkspaceNotFound(dir.join(filename)))?;
    read_dto(&meta)
}

pub fn delete_log_files(root: &VaultRoot, filenames: &[String]) -> Result<()> {
    if filenames.is_empty() {
        return Ok(());
    }
    let settings = load_app_settings(root)?;
    let dir = root.logs_dir(&settings);
    let metas = scan_log_files(&dir)?;
    for filename in filenames {
        if let Some(meta) = metas.iter().find(|m| &m.filename == filename) {
            if meta.is_current {
                return Err(UprivError::InvalidStore("cannot_delete_current_log".into()));
            }
        }
    }
    for filename in filenames {
        validate_log_filename(filename)?;
        let path = dir.join(filename);
        if path.is_file() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn read_dto(meta: &LogFileMeta) -> Result<LogFileDto> {
    let content = fs::read_to_string(&meta.path).unwrap_or_default();
    let size_bytes = fs::metadata(&meta.path).map(|m| m.len()).unwrap_or(0);
    let line_count = if content.is_empty() {
        0
    } else {
        content.lines().count() as u32
    };
    Ok(LogFileDto {
        filename: meta.filename.clone(),
        seq: meta.seq,
        is_current: meta.is_current,
        created_at: iso_from_compact(&meta.compact_ts),
        size_bytes,
        line_count,
        content: content.trim_end_matches('\n').to_string(),
    })
}

fn scan_log_files(dir: &Path) -> Result<Vec<LogFileMeta>> {
    let mut files = Vec::new();
    if !dir.is_dir() {
        return Ok(files);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        let Some(filename) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if let Some(meta) = parse_log_meta(&path, filename) {
            files.push(meta);
        }
    }
    files.sort_by(|a, b| compare_meta(a, b));
    Ok(files)
}

/// Oldest first (archived chronological, then current last).
fn compare_meta(a: &LogFileMeta, b: &LogFileMeta) -> Ordering {
    a.is_current
        .cmp(&b.is_current)
        .then_with(|| a.compact_ts.cmp(&b.compact_ts))
        .then_with(|| a.seq.cmp(&b.seq))
}

fn parse_log_meta(path: &Path, filename: &str) -> Option<LogFileMeta> {
    let (is_current, rest) = match filename.strip_prefix("current-") {
        Some(rest) => (true, rest),
        None => (false, filename),
    };
    let rest = rest.strip_suffix(".log")?;
    let (seq_str, ts) = rest.split_once('-')?;
    if seq_str.len() != 6 || !seq_str.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if ts.len() != 14 || !ts.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(LogFileMeta {
        path: path.to_path_buf(),
        filename: filename.to_string(),
        seq: seq_str.parse().ok()?,
        is_current,
        compact_ts: ts.to_string(),
    })
}

fn take_current(files: &mut Vec<LogFileMeta>) -> Option<LogFileMeta> {
    let idx = files
        .iter()
        .enumerate()
        .filter(|(_, m)| m.is_current)
        .max_by_key(|(_, m)| m.seq)
        .map(|(i, _)| i)?;
    Some(files.remove(idx))
}

fn archive_current(meta: &LogFileMeta) -> Result<()> {
    let archived = meta.filename.trim_start_matches("current-");
    let target = meta
        .path
        .parent()
        .map(|p| p.join(archived))
        .unwrap_or_else(|| PathBuf::from(archived));
    if meta.path != target {
        fs::rename(&meta.path, &target)?;
    }
    Ok(())
}

fn prune_logs(dir: &Path, settings: &crate::config::AppSettings) -> Result<()> {
    let keep_entries = settings.logging.keep_last_entries.unwrap_or(0);
    if keep_entries == 0 {
        return Ok(());
    }
    let entries_per_file = settings.logging.entries_per_file.max(1);
    let keep_files = keep_entries.div_ceil(entries_per_file).max(1) as usize;

    let files = scan_log_files(dir)?; // oldest first
    if files.len() <= keep_files {
        return Ok(());
    }
    // Never delete the active file; only prune oldest archived ones.
    let removable: Vec<_> = files.iter().filter(|m| !m.is_current).collect();
    let excess = files.len().saturating_sub(keep_files);
    for meta in removable.into_iter().take(excess) {
        let _ = fs::remove_file(&meta.path);
    }
    Ok(())
}

fn count_lines(path: &Path) -> Result<u32> {
    if !path.is_file() {
        return Ok(0);
    }
    let content = fs::read_to_string(path)?;
    if content.is_empty() {
        return Ok(0);
    }
    Ok(content.lines().count() as u32)
}

fn validate_log_filename(filename: &str) -> Result<()> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err(UprivError::InvalidStore("invalid log filename".into()));
    }
    if !filename.ends_with(".log") {
        return Err(UprivError::InvalidStore("invalid log filename".into()));
    }
    Ok(())
}

fn now_unix() -> (u64, u32) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs(), now.subsec_millis())
}

fn iso_millis() -> String {
    let (secs, millis) = now_unix();
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

fn compact_timestamp() -> String {
    let (secs, _) = now_unix();
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    format!("{y:04}{mo:02}{d:02}{h:02}{mi:02}{s:02}")
}

fn iso_from_compact(compact: &str) -> String {
    if compact.len() == 14 {
        let y = &compact[0..4];
        let mo = &compact[4..6];
        let d = &compact[6..8];
        let h = &compact[8..10];
        let mi = &compact[10..12];
        let s = &compact[12..14];
        format!("{y}-{mo}-{d}T{h}:{mi}:{s}Z")
    } else {
        "1970-01-01T00:00:00Z".to_string()
    }
}

/// Convert Unix seconds to civil UTC `(year, month, day, hour, min, sec)`.
fn civil_from_unix(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;

    let mut year = 1970u64;
    let mut day = days;
    loop {
        let year_days = if is_leap_year(year) { 366 } else { 365 };
        if day < year_days {
            break;
        }
        day -= year_days;
        year += 1;
    }
    let month_days = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u64;
    for dim in month_days {
        if day < dim {
            break;
        }
        day -= dim;
        month += 1;
    }
    (year, month, day + 1, hour, min, sec)
}

fn is_leap_year(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_settings(root: &Path, entries_per_file: u32, keep_last: Option<u32>) {
        fs::create_dir_all(root.join(".upriv")).unwrap();
        let keep_line = match keep_last {
            Some(n) => format!("keep_last_entries = {n}\n"),
            None => String::new(),
        };
        fs::write(
            root.join(".upriv/settings.toml"),
            format!(
                "[package]\nvaults_dir = \".upriv/vaults\"\nlogs_dir = \".upriv/logs\"\n\n[logging]\nenabled = true\nlevel = \"info\"\nentries_per_file = {entries_per_file}\n{keep_line}"
            ),
        )
        .unwrap();
    }

    #[test]
    fn appends_and_lists() {
        let temp = tempdir().unwrap();
        write_settings(temp.path(), 1000, None);
        let root = VaultRoot::discover(temp.path()).unwrap();

        append_log(&root, LogLevel::Info, "app_start", "version=test").unwrap();
        append_log(&root, LogLevel::Warn, "vault_open", "vault=notes").unwrap();

        let files = list_log_files(&root).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].is_current);
        assert_eq!(files[0].line_count, 2);
        assert!(files[0].content.contains("app_start"));
        assert!(files[0].content.starts_with("0001 "));
    }

    #[test]
    fn level_filter_drops_below_threshold() {
        let temp = tempdir().unwrap();
        write_settings(temp.path(), 1000, None);
        let root = VaultRoot::discover(temp.path()).unwrap();

        append_log(&root, LogLevel::Debug, "noisy", "").unwrap();
        let files = list_log_files(&root).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn rotates_at_entries_per_file() {
        let temp = tempdir().unwrap();
        write_settings(temp.path(), 2, None);
        let root = VaultRoot::discover(temp.path()).unwrap();

        for i in 0..5 {
            append_log(&root, LogLevel::Info, "tick", &format!("i={i}")).unwrap();
        }

        let files = list_log_files(&root).unwrap();
        // 5 entries / 2 per file => 3 files (2 archived + 1 current).
        assert_eq!(files.len(), 3);
        assert_eq!(files.iter().filter(|f| f.is_current).count(), 1);
        // Each fresh file restarts its index at 0001.
        assert!(files.iter().all(|f| f.content.starts_with("0001 ")));
    }

    #[test]
    fn prunes_oldest_per_keep_last() {
        let temp = tempdir().unwrap();
        // entries_per_file=1, keep_last_entries=2 → keep 2 files total.
        write_settings(temp.path(), 1, Some(2));
        let root = VaultRoot::discover(temp.path()).unwrap();

        for i in 0..5 {
            append_log(&root, LogLevel::Info, "tick", &format!("i={i}")).unwrap();
        }

        let files = list_log_files(&root).unwrap();
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn refuses_to_delete_current() {
        let temp = tempdir().unwrap();
        write_settings(temp.path(), 1000, None);
        let root = VaultRoot::discover(temp.path()).unwrap();
        append_log(&root, LogLevel::Info, "app_start", "").unwrap();
        let files = list_log_files(&root).unwrap();
        let current = files[0].filename.clone();
        let err = delete_log_files(&root, &[current]);
        assert!(err.is_err());
    }
}
