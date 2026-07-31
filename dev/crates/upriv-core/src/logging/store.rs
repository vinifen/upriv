//! Read / list / delete helpers for `.upriv/logs/` (UI via RPC).
//!
//! Lists **every** `*.log` in the directory. The writer only appends to a
//! canonical `current-{seq}-{stamp}.log`; odd filenames still appear here.

use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use super::names::{parse_archived_log_name, parse_current_log_name};
use crate::time::utc_ymdhms;

/// Soft cap for `log_get` body (bytes). Larger files return an error.
pub const MAX_LOG_GET_BYTES: u64 = 2 * 1024 * 1024;

/// Skip exact line counting above this size (list sets `line_count_exact = false`).
pub const MAX_LINE_COUNT_SCAN_BYTES: u64 = 512 * 1024;

/// Metadata for one file under `.upriv/logs/` (wire camelCase via serde rename).
///
/// Contract fixture (shared with TS `parseAppLogFile`):
/// `dev/apps/shared/src/domain/logs/tests/log-file-info.wire.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub filename: String,
    pub seq: u32,
    pub is_current: bool,
    /// ISO-8601 UTC — from filename stamp when canonical, else file mtime.
    pub created_at: String,
    pub size_bytes: u64,
    pub line_count: u32,
    /// `false` when the file was too large to scan — `line_count` is not authoritative.
    pub line_count_exact: bool,
    /// Empty for list responses; filled by [`read_log_file`].
    pub content: String,
}

/// List every `*.log` under `logs_dir` (missing dir → empty list).
pub fn list_log_files(logs_dir: &Path) -> io::Result<Vec<LogFileInfo>> {
    if !logs_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(logs_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(filename) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !filename.ends_with(".log") {
            continue;
        }
        files.push(describe_log_file(&path, filename)?);
    }
    Ok(files)
}

/// Read one log file. `filename` must be a basename (no path separators).
pub fn read_log_file(logs_dir: &Path, filename: &str) -> io::Result<Option<LogFileInfo>> {
    let Some(path) = safe_log_path(logs_dir, filename) else {
        return Ok(None);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let meta = fs::metadata(&path)?;
    if meta.len() > MAX_LOG_GET_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "log_file_too_large: {} bytes (max {MAX_LOG_GET_BYTES})",
                meta.len()
            ),
        ));
    }
    let mut info = describe_log_file(&path, filename)?;
    let mut content = String::new();
    File::open(&path)?.read_to_string(&mut content)?;
    info.content = content;
    Ok(Some(info))
}

/// Delete log files by basename. Missing files are ignored (idempotent).
///
/// Returns [`io::ErrorKind::InvalidInput`] if any name fails [`safe_log_path`].
/// All names are validated **before** any delete (no partial success on mixed input).
///
/// Call [`super::Logger::release_active_named`] first when deleting the live
/// `current-*` so the writer does not keep writing to an unlinked inode.
pub fn delete_log_files(logs_dir: &Path, filenames: &[String]) -> io::Result<()> {
    let mut paths: Vec<PathBuf> = Vec::with_capacity(filenames.len());
    let mut invalid: Vec<&str> = Vec::new();
    for filename in filenames {
        match safe_log_path(logs_dir, filename) {
            Some(path) => paths.push(path),
            None => invalid.push(filename.as_str()),
        }
    }
    if !invalid.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid log filename(s): {}", invalid.join(", ")),
        ));
    }
    for path in paths {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn describe_log_file(path: &Path, filename: &str) -> io::Result<LogFileInfo> {
    let meta = fs::metadata(path)?;
    let size_bytes = meta.len();
    let (line_count, line_count_exact) = if size_bytes > MAX_LINE_COUNT_SCAN_BYTES {
        (0, false)
    } else {
        (count_lines(path).unwrap_or(0), true)
    };

    let (seq, is_current, created_at) = if let Some((seq, stamp)) = parse_current_log_name(filename)
    {
        (
            seq,
            true,
            stamp_to_iso(stamp).unwrap_or_else(|| mtime_iso(&meta)),
        )
    } else if let Some((seq, stamp)) = parse_archived_log_name(filename) {
        (
            seq,
            false,
            stamp_to_iso(stamp).unwrap_or_else(|| mtime_iso(&meta)),
        )
    } else {
        (0, false, mtime_iso(&meta))
    };

    Ok(LogFileInfo {
        filename: filename.to_string(),
        seq,
        is_current,
        created_at,
        size_bytes,
        line_count,
        line_count_exact,
        content: String::new(),
    })
}

fn stamp_to_iso(stamp: &str) -> Option<String> {
    if stamp.len() != 14 {
        return None;
    }
    let (y, rest) = stamp.split_at(4);
    let (mo, rest) = rest.split_at(2);
    let (d, rest) = rest.split_at(2);
    let (h, rest) = rest.split_at(2);
    let (mi, s) = rest.split_at(2);
    Some(format!("{y}-{mo}-{d}T{h}:{mi}:{s}.000Z"))
}

fn mtime_iso(meta: &fs::Metadata) -> String {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| {
            let (y, mo, day, h, mi, s) = utc_ymdhms(d.as_secs());
            format!(
                "{y:04}-{mo:02}-{day:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z",
                ms = d.subsec_millis()
            )
        })
        .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string())
}

fn count_lines(path: &Path) -> io::Result<u32> {
    let reader = BufReader::new(File::open(path)?);
    let mut count = 0_u32;
    for line in reader.lines() {
        line?;
        count = count.saturating_add(1);
    }
    Ok(count)
}

/// Reject path traversal — basename only, must stay under `logs_dir`.
pub(crate) fn safe_log_path(logs_dir: &Path, filename: &str) -> Option<PathBuf> {
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains('\0')
        || filename == "."
        || filename == ".."
    {
        return None;
    }
    // Reject `..` as a path *component* only (not the substring in `foo..bar.log`).
    if filename.split(['/', '\\']).any(|part| part == "..") {
        return None;
    }
    if !filename.ends_with(".log") {
        return None;
    }
    let path = logs_dir.join(filename);
    let parent = path.parent()?;
    if parent != logs_dir {
        return None;
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("upriv-log-store-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[test]
    fn lists_canonical_and_odd_files() {
        let dir = temp_dir();
        fs::write(dir.join("current-000001-20260101120000.log"), "0001 a\n").unwrap();
        fs::write(dir.join("000002-20260102120000.log"), "0001 b\n").unwrap();
        fs::write(dir.join("weird-name.log"), "x\n").unwrap();
        fs::write(dir.join("notes.txt"), "nope").unwrap();

        let files = list_log_files(&dir).expect("list");
        assert_eq!(files.len(), 3);
        let weird = files
            .iter()
            .find(|f| f.filename == "weird-name.log")
            .unwrap();
        assert_eq!(weird.seq, 0);
        assert!(!weird.is_current);
        let current = files
            .iter()
            .find(|f| f.filename.starts_with("current-"))
            .unwrap();
        assert!(current.is_current);
        assert_eq!(current.seq, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_path_traversal() {
        let dir = temp_dir();
        assert!(safe_log_path(&dir, "../escape.log").is_none());
        assert!(safe_log_path(&dir, "..").is_none());
        assert!(safe_log_path(&dir, "ok.log").is_some());
        // Substring `..` in a basename is fine (not a path component).
        assert!(safe_log_path(&dir, "foo..bar.log").is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_rejects_invalid_names() {
        let dir = temp_dir();
        let err = delete_log_files(&dir, &["../escape.log".into()]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_mixed_invalid_does_not_remove_valid() {
        let dir = temp_dir();
        let name = "000001-20260101120000.log".to_string();
        fs::write(dir.join(&name), "x\n").unwrap();
        let err = delete_log_files(&dir, &[name.clone(), "../escape.log".into()]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        assert!(
            dir.join(&name).is_file(),
            "valid file must remain after mixed reject"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_is_idempotent() {
        let dir = temp_dir();
        let name = "000001-20260101120000.log".to_string();
        fs::write(dir.join(&name), "x\n").unwrap();
        delete_log_files(&dir, std::slice::from_ref(&name)).unwrap();
        delete_log_files(&dir, std::slice::from_ref(&name)).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_rejects_oversized_file() {
        let dir = temp_dir();
        let name = "huge.log";
        let path = dir.join(name);
        let chunk = vec![b'x'; 64 * 1024];
        let mut file = fs::File::create(&path).unwrap();
        use std::io::Write;
        let mut written = 0_u64;
        while written <= MAX_LOG_GET_BYTES {
            file.write_all(&chunk).unwrap();
            written += chunk.len() as u64;
        }
        drop(file);
        let err = read_log_file(&dir, name).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_file_info_wire_matches_shared_fixture() {
        let info = LogFileInfo {
            filename: "current-000001-20260101120000.log".into(),
            seq: 1,
            is_current: true,
            created_at: "2026-01-01T12:00:00.000Z".into(),
            size_bytes: 42,
            line_count: 3,
            line_count_exact: true,
            content: String::new(),
        };
        let actual = serde_json::to_value(&info).expect("serialize");
        let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/shared/src/domain/logs/tests/log-file-info.wire.json"
        )))
        .expect("fixture");
        assert_eq!(actual, fixture);
    }
}
