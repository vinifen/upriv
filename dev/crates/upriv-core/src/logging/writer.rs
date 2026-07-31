use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::config::LogConfig;
use super::format::format_log_line;
use super::names::{parse_archived_log_name, parse_current_log_name};
use super::LogLevel;
use crate::time::{utc_filename_stamp, utc_timestamp_iso_millis};

struct ActiveFile {
    path: PathBuf,
    seq: u32,
    line_index: u32,
    writer: BufWriter<File>,
}

/// Append-only structured logger for `.upriv/logs/` (single process writer).
pub struct Logger {
    config: LogConfig,
    inner: Mutex<Option<ActiveFile>>,
}

impl Logger {
    /// Open a logger for `config.logs_dir`.
    ///
    /// Does **not** create files until the first successful [`log`] (lazy).
    pub fn open(config: LogConfig) -> io::Result<Self> {
        Ok(Self {
            config,
            inner: Mutex::new(None),
        })
    }

    pub fn config(&self) -> &LogConfig {
        &self.config
    }

    pub fn log(&self, level: LogLevel, event: &str, fields: &[(&str, &str)]) {
        if !self.config.enabled || !level.enabled_at(self.config.min_level) {
            return;
        }
        let mut guard = self.lock_inner();
        if let Err(error) = self.write_line_locked(&mut guard, level, event, fields) {
            eprintln!("upriv-core log write failed: {error}");
        }
    }

    pub fn debug(&self, event: &str, fields: &[(&str, &str)]) {
        self.log(LogLevel::Debug, event, fields);
    }

    pub fn info(&self, event: &str, fields: &[(&str, &str)]) {
        self.log(LogLevel::Info, event, fields);
    }

    pub fn warn(&self, event: &str, fields: &[(&str, &str)]) {
        self.log(LogLevel::Warn, event, fields);
    }

    pub fn error(&self, event: &str, fields: &[(&str, &str)]) {
        self.log(LogLevel::Error, event, fields);
    }

    /// Drop the active file handle if it matches `filename` (basename).
    ///
    /// Required before deleting the live `current-*` so writes do not continue
    /// on an unlinked inode; the next [`log`] recreates a canonical current.
    pub fn release_active_named(&self, filename: &str) {
        let mut guard = self.lock_inner();
        let should_release = guard
            .as_ref()
            .and_then(|active| active.path.file_name())
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == filename);
        if should_release {
            if let Some(mut active) = guard.take() {
                let _ = active.writer.flush();
            }
        }
    }

    /// Flush buffered lines to disk. Call on graceful shutdown; lines are
    /// otherwise flushed on rotation and when the `Logger` is dropped.
    pub fn flush(&self) {
        let mut guard = self.lock_inner();
        if let Some(active) = guard.as_mut() {
            let _ = active.writer.flush();
        }
    }

    /// Lock the active-file guard, recovering from a poisoned mutex.
    ///
    /// A poisoned lock means another thread panicked mid-write; recovering the
    /// guard keeps logging consistent instead of panicking in some paths and
    /// silently dropping writes in others.
    fn lock_inner(&self) -> std::sync::MutexGuard<'_, Option<ActiveFile>> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_line_locked(
        &self,
        guard: &mut Option<ActiveFile>,
        level: LogLevel,
        event: &str,
        fields: &[(&str, &str)],
    ) -> io::Result<()> {
        // External rename/delete: drop stale handle so we open/create a real current.
        if let Some(active) = guard.as_ref() {
            if !active.path.exists() {
                *guard = None;
            }
        }

        if guard.is_none() {
            ensure_logs_dir(&self.config.logs_dir)?;
            *guard = Some(open_or_create_active(&self.config)?);
        }

        let should_rotate = guard.as_ref().expect("active log file").line_index
            >= self.config.effective_entries_per_file();
        if should_rotate {
            rotate_active(&self.config, guard)?;
        }

        let active = guard.as_mut().expect("active log file");
        active.line_index += 1;
        let timestamp = utc_timestamp_iso_millis();
        let line = format_log_line(active.line_index, &timestamp, level, event, fields);
        match writeln!(active.writer, "{line}") {
            Ok(()) => {
                // Flush each line so the Logs UI sees events immediately (low volume).
                let _ = active.writer.flush();
                Ok(())
            }
            Err(error) => {
                // Fail-soft recovery: drop handle and recreate once.
                *guard = None;
                ensure_logs_dir(&self.config.logs_dir)?;
                *guard = Some(open_or_create_active(&self.config)?);
                let active = guard.as_mut().expect("active log file after recover");
                active.line_index += 1;
                let timestamp = utc_timestamp_iso_millis();
                let line = format_log_line(active.line_index, &timestamp, level, event, fields);
                writeln!(active.writer, "{line}").map_err(|_| error)?;
                let _ = active.writer.flush();
                Ok(())
            }
        }
    }
}

impl Drop for Logger {
    fn drop(&mut self) {
        self.flush();
    }
}

/// Create `logs_dir` only when safe.
///
/// Under a product path `…/.upriv/logs`, require a **valid** vault-root marker and
/// create only the `logs` leaf — never `mkdir` a missing `.upriv` (that would
/// resurrect an Incomplete tree and skip NeedsSetup / repair).
/// Bare test dirs (parent not named `.upriv`) may still use `create_dir_all`.
fn ensure_logs_dir(logs_dir: &Path) -> io::Result<()> {
    if let Some(upriv) = logs_dir.parent() {
        if upriv.file_name().is_some_and(|name| name == ".upriv") {
            let Some(root) = upriv.parent() else {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "refusing to create logs: .upriv has no parent",
                ));
            };
            crate::paths::validate_existing_vault_root(root).map_err(|error| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("refusing to create logs: {error}"),
                )
            })?;
            if logs_dir.is_dir() {
                return Ok(());
            }
            // Leaf only — do not create `.upriv` if it vanished after validate.
            return match fs::create_dir(logs_dir) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error),
            };
        }
    }
    fs::create_dir_all(logs_dir)
}

fn open_or_create_active(config: &LogConfig) -> io::Result<ActiveFile> {
    if let Some(resumed) = try_resume_current(config)? {
        return Ok(resumed);
    }
    let next_seq = next_sequence_number(&config.logs_dir)?;
    create_active_file(config, next_seq, 0)
}

fn try_resume_current(config: &LogConfig) -> io::Result<Option<ActiveFile>> {
    let mut candidates: Vec<(u32, PathBuf)> = Vec::new();
    for entry in fs::read_dir(&config.logs_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(filename) = name.to_str() else {
            continue;
        };
        if let Some((seq, _stamp)) = parse_current_log_name(filename) {
            candidates.push((seq, entry.path()));
        }
    }

    if candidates.is_empty() {
        return Ok(None);
    }

    // Spec: exactly one active `current-*` file. A crash mid-rotation can leave
    // several; resume the highest `seq` deterministically and archive the rest
    // so indices/sequence numbers stay monotonic instead of picking whichever
    // the filesystem iterated last.
    candidates.sort_by_key(|(seq, _)| *seq);
    let (seq, path) = candidates.pop().expect("candidates is non-empty");
    for (_, stale) in candidates {
        eprintln!("upriv-core: archiving stale active log {}", stale.display());
        let archived = archive_current_path(&stale);
        fs::rename(&stale, &archived)?;
    }

    let line_index = count_lines(&path)?;
    let file = OpenOptions::new().append(true).open(&path)?;
    Ok(Some(ActiveFile {
        path,
        seq,
        line_index,
        writer: BufWriter::new(file),
    }))
}

fn create_active_file(config: &LogConfig, seq: u32, line_index: u32) -> io::Result<ActiveFile> {
    let stamp = utc_filename_stamp();
    let filename = format!("current-{seq:06}-{stamp}.log");
    let path = config.logs_dir.join(filename);
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)?;
    Ok(ActiveFile {
        path,
        seq,
        line_index,
        writer: BufWriter::new(file),
    })
}

fn rotate_active(config: &LogConfig, guard: &mut Option<ActiveFile>) -> io::Result<()> {
    let Some(mut active) = guard.take() else {
        return Ok(());
    };
    active.writer.flush()?;
    drop(active.writer);

    let archived = archive_current_path(&active.path);
    fs::rename(&active.path, &archived)?;
    if let Err(err) = prune_old_files(config) {
        eprintln!("upriv-core: prune after rotate failed: {err}");
    }

    match create_active_file(config, active.seq + 1, 0) {
        Ok(next) => {
            *guard = Some(next);
            Ok(())
        }
        Err(err) => {
            // Roll archive back to `current-*` so the writer keeps a live handle.
            if let Err(rollback_err) = fs::rename(&archived, &active.path) {
                eprintln!(
                    "upriv-core: rotate create failed ({err}); rollback also failed ({rollback_err})"
                );
                *guard = None;
                return Err(err);
            }
            match OpenOptions::new().append(true).open(&active.path) {
                Ok(file) => {
                    // Re-count lines — do not invent threshold-1 (desync + lost lines).
                    let line_index = count_lines(&active.path).unwrap_or(active.line_index);
                    *guard = Some(ActiveFile {
                        path: active.path,
                        seq: active.seq,
                        line_index,
                        writer: BufWriter::new(file),
                    });
                    // Fail soft: keep appending to this (possibly over-threshold) file
                    // instead of dropping the line that triggered rotate.
                    eprintln!(
                        "upriv-core: rotate create failed ({err}); continuing on rolled-back current"
                    );
                    Ok(())
                }
                Err(reopen_err) => {
                    eprintln!(
                        "upriv-core: rotate create failed ({err}); reopen after rollback failed ({reopen_err})"
                    );
                    *guard = None;
                    Err(err)
                }
            }
        }
    }
}

fn archive_current_path(current: &Path) -> PathBuf {
    let filename = current
        .file_name()
        .and_then(|name| name.to_str())
        .expect("log path basename");
    let archived_name = match filename.strip_prefix("current-") {
        Some(name) => name,
        None => {
            eprintln!(
                "[upriv-core] archive_current_path: unexpected active log name {filename:?}; archiving as-is"
            );
            filename
        }
    };
    current.with_file_name(archived_name)
}

fn next_sequence_number(logs_dir: &Path) -> io::Result<u32> {
    let mut max_seq = 0_u32;
    if logs_dir.is_dir() {
        for entry in fs::read_dir(logs_dir)? {
            let entry = entry?;
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if let Some((seq, _)) = parse_current_log_name(&name) {
                max_seq = max_seq.max(seq);
            } else if let Some((seq, _)) = parse_archived_log_name(&name) {
                max_seq = max_seq.max(seq);
            }
        }
    }
    Ok(max_seq + 1)
}

fn count_lines(path: &Path) -> io::Result<u32> {
    // Stream lines so a large/corrupt file does not get fully buffered in RAM.
    let reader = BufReader::new(File::open(path)?);
    let mut count = 0_u32;
    for line in reader.lines() {
        line?;
        count = count.saturating_add(1);
    }
    Ok(count)
}

fn prune_old_files(config: &LogConfig) -> io::Result<()> {
    if config.keep_last_entries == 0 {
        return Ok(());
    }

    // Budget applies to **archived** files only (current is excluded from the sum).
    // Total on disk may temporarily reach keep_last + current growth (≤ entries_per_file).
    // Do **not** subtract entries_per_file here — that made keep_last == entries_per_file
    // delete every archive on the first rotation (effective retention ≈ 0).
    let budget = config.keep_last_entries;

    let mut archived: Vec<(u32, PathBuf, u32)> = Vec::new();
    for entry in fs::read_dir(&config.logs_dir)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if name.starts_with("current-") {
            continue;
        }
        let Some((seq, _)) = parse_archived_log_name(&name) else {
            continue;
        };
        let lines = match count_lines(&entry.path()) {
            Ok(n) => n,
            Err(err) => {
                eprintln!("upriv-core: prune skip {}: {err}", entry.path().display());
                continue;
            }
        };
        archived.push((seq, entry.path(), lines));
    }

    archived.sort_by_key(|(seq, _, _)| *seq);
    let mut total_lines: u32 = archived.iter().map(|(_, _, lines)| *lines).sum();
    for (_, path, lines) in archived {
        if total_lines <= budget {
            break;
        }
        fs::remove_file(&path)?;
        total_lines = total_lines.saturating_sub(lines);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_logs_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("upriv-log-test-{nanos}"))
    }

    #[test]
    fn rotates_and_archives_current_file() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 2,
            keep_last_entries: 0,
            logs_dir: dir.clone(),
        };

        let logger = Logger::open(config).expect("open");
        logger.info("first", &[]);
        logger.info("second", &[]);
        logger.info("third", &[]);

        let names: Vec<String> = fs::read_dir(&dir)
            .expect("read")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();

        assert!(names
            .iter()
            .any(|name| { !name.starts_with("current-") && name.ends_with(".log") }));
        assert!(names.iter().any(|name| name.starts_with("current-000002-")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn respects_min_level() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Warn,
            entries_per_file: 100,
            keep_last_entries: 0,
            logs_dir: dir.clone(),
        };
        let logger = Logger::open(config).expect("open");
        logger.info("skipped", &[]);
        logger.warn("kept", &[]);
        logger.flush();

        let current = fs::read_dir(&dir)
            .expect("read")
            .filter_map(|entry| entry.ok())
            .find(|entry| entry.file_name().to_string_lossy().starts_with("current-"))
            .expect("current file");
        let content = fs::read_to_string(current.path()).expect("read");
        assert!(!content.contains("skipped"));
        assert!(content.contains("kept"));
        let _ = fs::remove_dir_all(&dir);
    }

    fn archived_names(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .expect("read")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| !name.starts_with("current-") && name.ends_with(".log"))
            .collect()
    }

    #[test]
    fn disabled_logger_creates_no_files() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let logger = Logger::open(LogConfig::disabled(dir.clone())).expect("open");
        logger.info("ignored", &[]);
        logger.flush();
        assert!(
            !dir.exists()
                || fs::read_dir(&dir)
                    .map(|mut d| d.next().is_none())
                    .unwrap_or(true)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn enabled_open_without_log_creates_no_files() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 100,
            keep_last_entries: 0,
            logs_dir: dir.clone(),
        };
        let _logger = Logger::open(config).expect("open");
        assert!(
            !dir.exists()
                || fs::read_dir(&dir)
                    .map(|mut d| d.next().is_none())
                    .unwrap_or(true)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn zero_entries_per_file_does_not_rotate_every_line() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 0,
            keep_last_entries: 0,
            logs_dir: dir.clone(),
        };
        let logger = Logger::open(config).expect("open");
        logger.info("one", &[]);
        logger.info("two", &[]);
        logger.info("three", &[]);
        logger.flush();

        // `0` is clamped to a sane threshold, so a handful of lines must not
        // produce one archived file per entry.
        assert!(archived_names(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_respects_keep_last_entries() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 1,
            keep_last_entries: 2,
            logs_dir: dir.clone(),
        };
        let logger = Logger::open(config).expect("open");
        for index in 0..6 {
            logger.info("entry", &[("n", &index.to_string())]);
        }
        logger.flush();

        // budget = keep_last_entries (archived only) = 2,
        // so at most two archived lines should survive.
        let archived = archived_names(&dir);
        let total: usize = archived
            .iter()
            .map(|name| {
                let path = dir.join(name);
                count_lines(&path).expect("count") as usize
            })
            .sum();
        assert!(total <= 2, "archived retained {total} lines, expected <= 2");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_keeps_archive_when_keep_last_equals_entries_per_file() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 2,
            keep_last_entries: 2,
            logs_dir: dir.clone(),
        };
        let logger = Logger::open(config).expect("open");
        for index in 0..6 {
            logger.info("entry", &[("n", &index.to_string())]);
        }
        logger.flush();

        let archived = archived_names(&dir);
        assert!(
            !archived.is_empty(),
            "expected at least one archived file when keep_last == entries_per_file"
        );
        let total: usize = archived
            .iter()
            .map(|name| {
                let path = dir.join(name);
                count_lines(&path).expect("count") as usize
            })
            .sum();
        assert!(total <= 2, "archived retained {total} lines, expected <= 2");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_picks_highest_seq_and_archives_stale() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        // Simulate a crash that left two active files behind.
        fs::write(dir.join("current-000001-20260101000000.log"), "0001 x\n").expect("write");
        fs::write(dir.join("current-000002-20260101000001.log"), "0001 y\n").expect("write");

        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 100,
            keep_last_entries: 0,
            logs_dir: dir.clone(),
        };
        let logger = Logger::open(config).expect("open");
        logger.info("resumed", &[]);
        logger.flush();

        let current: Vec<String> = fs::read_dir(&dir)
            .expect("read")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("current-"))
            .collect();
        assert_eq!(
            current.len(),
            1,
            "expected a single active file, got {current:?}"
        );
        assert!(current[0].starts_with("current-000002-"));
        // The lower-seq file must have been archived, not deleted.
        assert!(dir.join("000001-20260101000000.log").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recreate_current_after_active_deleted() {
        let dir = temp_logs_dir();
        let _ = fs::remove_dir_all(&dir);
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 100,
            keep_last_entries: 0,
            logs_dir: dir.clone(),
        };
        let logger = Logger::open(config).expect("open");
        logger.info("before", &[]);
        logger.flush();

        let current_name = fs::read_dir(&dir)
            .expect("read")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .find(|name| name.starts_with("current-"))
            .expect("current");
        logger.release_active_named(&current_name);
        fs::remove_file(dir.join(&current_name)).expect("delete");

        logger.info("after_delete", &[]);
        logger.flush();

        let currents: Vec<_> = fs::read_dir(&dir)
            .expect("read")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("current-"))
            .collect();
        assert_eq!(currents.len(), 1);
        let content = fs::read_to_string(dir.join(&currents[0])).expect("read");
        assert!(content.contains("after_delete"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn effective_entries_per_file_never_exceeds_four_digit_index() {
        let dir = temp_logs_dir();
        let config = LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 50_000,
            keep_last_entries: 0,
            logs_dir: dir,
        };
        assert_eq!(config.effective_entries_per_file(), 1000);
    }

    #[test]
    fn refuse_to_recreate_upriv_without_settings() {
        let root = temp_logs_dir();
        let logs = PathBuf::from(&root).join(".upriv").join("logs");
        let logger = Logger::open(LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 1000,
            keep_last_entries: 0,
            logs_dir: logs,
        })
        .expect("open");
        logger.info("should_not_create_upriv", &[]);
        logger.flush();
        assert!(
            !PathBuf::from(&root).join(".upriv").exists(),
            "logging must not mkdir .upriv when settings.toml is missing"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn creates_logs_under_existing_valid_upriv() {
        let root = temp_logs_dir();
        let upriv = PathBuf::from(&root).join(".upriv");
        fs::create_dir_all(&upriv).expect("mkdir .upriv");
        fs::write(
            upriv.join("settings.toml"),
            "[package]\nversion = 1\nvaults_dir = \".upriv/vaults\"\n",
        )
        .expect("settings");
        let logs = upriv.join("logs");
        let logger = Logger::open(LogConfig {
            enabled: true,
            min_level: LogLevel::Debug,
            entries_per_file: 1000,
            keep_last_entries: 0,
            logs_dir: logs.clone(),
        })
        .expect("open");
        logger.info("ok", &[]);
        logger.flush();
        assert!(logs.is_dir());
        let _ = fs::remove_dir_all(&root);
    }
}
