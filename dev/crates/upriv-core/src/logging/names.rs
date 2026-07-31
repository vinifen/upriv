//! Canonical `.upriv/logs/` filename parsing (writer + store share this).

/// Active file: `current-{seq:06}-{YYYYMMDDHHmmss}.log`
/// Returns `(seq, stamp)` where stamp is 14 ASCII digits (no `.log`).
pub fn parse_current_log_name(filename: &str) -> Option<(u32, &str)> {
    let rest = filename.strip_prefix("current-")?;
    let (seq_part, stamp_part) = rest.split_once('-')?;
    let stamp = stamp_part.strip_suffix(".log")?;
    if stamp.len() != 14 || !stamp.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let seq = seq_part.parse().ok()?;
    Some((seq, stamp))
}

/// Archived file: `{seq:06}-{YYYYMMDDHHmmss}.log` (no `current-` prefix).
pub fn parse_archived_log_name(filename: &str) -> Option<(u32, &str)> {
    if filename.starts_with("current-") {
        return None;
    }
    let rest = filename.strip_suffix(".log")?;
    let (seq_part, stamp) = rest.split_once('-')?;
    if stamp.len() != 14 || !stamp.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let seq = seq_part.parse().ok()?;
    Some((seq, stamp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_names() {
        assert_eq!(
            parse_current_log_name("current-000002-20260101120000.log"),
            Some((2, "20260101120000"))
        );
        assert_eq!(
            parse_archived_log_name("000003-20260102120000.log"),
            Some((3, "20260102120000"))
        );
    }

    #[test]
    fn rejects_non_canonical() {
        assert!(parse_current_log_name("current-foo.log").is_none());
        assert!(parse_archived_log_name("99-x.log").is_none());
        assert!(parse_archived_log_name("current-000001-20260101120000.log").is_none());
        assert!(parse_archived_log_name("weird-name.log").is_none());
    }
}
