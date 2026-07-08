use std::str::FromStr;

/// Log severity — matches `[logging].level` in `settings.toml` and TS `LogLevel`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub const ALL: [LogLevel; 5] = [
        LogLevel::Trace,
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Trace => "TRACE",
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }

    /// Whether `self` should be written when the configured minimum is `min`.
    pub fn enabled_at(self, min: LogLevel) -> bool {
        self >= min
    }
}

impl FromStr for LogLevel {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        // Case-insensitive without allocating a lowercased copy per parse.
        let trimmed = value.trim();
        if let Some(level) = LogLevel::ALL
            .into_iter()
            .find(|level| trimmed.eq_ignore_ascii_case(level.as_str()))
        {
            return Ok(level);
        }
        if trimmed.eq_ignore_ascii_case("warning") {
            return Ok(LogLevel::Warn);
        }
        Err(())
    }
}
