use std::str::FromStr;

/// Severity of one log **line** (written into `.upriv/logs/`).
///
/// The same four values are selectable as `[logging].level` / UI filter presets
/// (`error` | `warn` | `info` | `debug`) — see [`LogLevel::parse_filter`].
///
/// `Ord` is **severity** for filtering (`enabled_at`: higher = more severe), so
/// `Debug < Info < Warn < Error`. Product verbosity is the **inverse** of
/// `min_level` (lower min → more lines written).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub const ALL: [LogLevel; 4] = [
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ];

    /// UI / TOML filter presets (quietest → loudest).
    pub const FILTER_PRESETS: [LogLevel; 4] = [
        LogLevel::Error,
        LogLevel::Warn,
        LogLevel::Info,
        LogLevel::Debug,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }

    /// Product filter string for `[logging].level` / reconfigure fields.
    pub fn filter_str(self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
        }
    }

    /// Whether `self` should be written when the configured minimum is `min`.
    pub fn enabled_at(self, min: LogLevel) -> bool {
        self >= min
    }

    /// Normalize `[logging].level` to a filter preset (`error` / `warn` / `info` / `debug`).
    pub fn parse_filter(value: &str) -> Self {
        let trimmed = value.trim();
        if trimmed.eq_ignore_ascii_case("error") {
            return LogLevel::Error;
        }
        if trimmed.eq_ignore_ascii_case("warn") || trimmed.eq_ignore_ascii_case("warning") {
            return LogLevel::Warn;
        }
        if trimmed.eq_ignore_ascii_case("debug") {
            return LogLevel::Debug;
        }
        if trimmed.eq_ignore_ascii_case("info") {
            return LogLevel::Info;
        }
        LogLevel::Info
    }
}

impl FromStr for LogLevel {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_presets_normalize() {
        assert_eq!(LogLevel::parse_filter("error"), LogLevel::Error);
        assert_eq!(LogLevel::parse_filter("warn"), LogLevel::Warn);
        assert_eq!(LogLevel::parse_filter("warning"), LogLevel::Warn);
        assert_eq!(LogLevel::parse_filter("info"), LogLevel::Info);
        assert_eq!(LogLevel::parse_filter("debug"), LogLevel::Debug);
        assert_eq!(LogLevel::parse_filter("nope"), LogLevel::Info);
    }
}
