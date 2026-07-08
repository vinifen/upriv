use std::path::{Path, PathBuf};

use super::LogLevel;

/// App logging settings — mirrors `[logging]` + `logs_dir` from `.upriv/settings.toml`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogConfig {
    pub enabled: bool,
    pub min_level: LogLevel,
    /// Lines per file before rotation (1–1000 index per file; prod default 1000).
    pub entries_per_file: u32,
    /// Total lines to retain across archived files; `0` = unlimited.
    pub keep_last_entries: u32,
    pub logs_dir: PathBuf,
}

impl LogConfig {
    pub fn new(logs_dir: impl Into<PathBuf>) -> Self {
        Self {
            enabled: true,
            min_level: LogLevel::Info,
            entries_per_file: 1000,
            keep_last_entries: 10_000,
            logs_dir: logs_dir.into(),
        }
    }

    pub fn disabled(logs_dir: impl Into<PathBuf>) -> Self {
        Self {
            enabled: false,
            ..Self::new(logs_dir)
        }
    }

    pub fn logs_dir(&self) -> &Path {
        &self.logs_dir
    }

    /// Rotation threshold within the spec range (1–1000 lines per file).
    /// `0` is invalid (would rotate every line) and falls back to the default;
    /// oversized values are capped so the 4-digit line index cannot overflow.
    pub fn effective_entries_per_file(&self) -> u32 {
        const DEFAULT_ENTRIES_PER_FILE: u32 = 1000;
        match self.entries_per_file {
            0 => DEFAULT_ENTRIES_PER_FILE,
            n => n.min(DEFAULT_ENTRIES_PER_FILE),
        }
    }
}
