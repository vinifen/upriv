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

    /// Read `[logging].level` (`error` / `warn` / `info` / `debug`, any case).
    /// Anything else is `info`.
    pub fn parse_filter(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "error" => LogLevel::Error,
            "warn" => LogLevel::Warn,
            "debug" => LogLevel::Debug,
            _ => LogLevel::Info,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_filter_reads_each_level() {
        assert_eq!(LogLevel::parse_filter("error"), LogLevel::Error);
        assert_eq!(LogLevel::parse_filter(" WARN "), LogLevel::Warn);
        assert_eq!(LogLevel::parse_filter("info"), LogLevel::Info);
        assert_eq!(LogLevel::parse_filter("debug"), LogLevel::Debug);
        assert_eq!(LogLevel::parse_filter("nope"), LogLevel::Info);
    }
}
