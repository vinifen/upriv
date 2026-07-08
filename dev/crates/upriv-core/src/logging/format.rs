use super::LogLevel;

/// Format one log line — must stay in sync with `@upriv/shared` `domain/logs/format.ts`.
pub fn format_log_line(
    index: u32,
    timestamp_iso: &str,
    level: LogLevel,
    event: &str,
    fields: &[(&str, &str)],
) -> String {
    // Spec: 1–1000 lines per file; the 4-digit `{index:04}` field (parsed as
    // `\d{4}` by the shared TS parser) must never exceed 9999.
    debug_assert!((1..=1000).contains(&index));
    debug_assert!(!event.contains(char::is_whitespace));

    let mut line = format!(
        "{index:04} {timestamp_iso} {level:<5} {event:<18}",
        level = level.as_str(),
    );

    for (key, value) in fields {
        debug_assert!(!key.contains(char::is_whitespace));
        debug_assert!(!value.contains('\n'));
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(value);
    }

    line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_matches_shared_parser_sample() {
        let line = format_log_line(
            1,
            "2026-05-29T12:00:00.010Z",
            LogLevel::Info,
            "app_start",
            &[("version", "0.2.0-demo"), ("vaults", "4")],
        );
        assert!(line.starts_with("0001 2026-05-29T12:00:00.010Z INFO  app_start"));
        assert!(line.contains("version=0.2.0-demo"));
        assert!(line.contains("vaults=4"));
    }
}
