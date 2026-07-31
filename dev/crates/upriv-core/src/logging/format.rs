use super::LogLevel;

/// Format one log line — must stay in sync with `@upriv/shared` `domain/logs/format.ts`.
///
/// Sanitizes tokens at runtime so release builds never emit whitespace in
/// `event`/`key` or newlines in `value` (would break the shared line parser).
pub fn format_log_line(
    index: u32,
    timestamp_iso: &str,
    level: LogLevel,
    event: &str,
    fields: &[(&str, &str)],
) -> String {
    let event = sanitize_token(event);

    let mut line = format!(
        "{index:04} {timestamp_iso} {level:<5} {event:<18}",
        level = level.as_str(),
        event = event,
    );

    for (key, value) in fields {
        let key = sanitize_token(key);
        let value = sanitize_value(value);
        line.push(' ');
        line.push_str(&key);
        line.push('=');
        line.push_str(&value);
    }

    line
}

fn sanitize_token(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "_".to_string();
    }
    trimmed
        .chars()
        .map(|c| if c.is_whitespace() { '_' } else { c })
        .collect()
}

fn sanitize_value(raw: &str) -> String {
    raw.chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect()
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

    #[test]
    fn sanitizes_whitespace_and_newlines() {
        let line = format_log_line(
            1,
            "2026-05-29T12:00:00.010Z",
            LogLevel::Info,
            "bad event",
            &[("path key", "line1\nline2")],
        );
        assert!(line.contains("bad_event"));
        assert!(line.contains("path_key=line1 line2"));
        assert!(!line.contains('\n'));
    }
}
