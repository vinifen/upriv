//! UTC time helpers for the whole crate (`std` only — no external time deps).
//!
//! User-facing date formatting lives in `@upriv/shared`; core uses UTC wire formats.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// ISO-8601 UTC with milliseconds, e.g. `2026-05-29T12:00:00.010Z`.
pub fn utc_timestamp_iso_millis() -> String {
    let duration = unix_now();
    let (y, mo, d, h, mi, s) = utc_ymdhms(duration.as_secs());
    format!(
        "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z",
        ms = duration.subsec_millis()
    )
}

/// Filename stamp `YYYYMMDDHHmmss` (UTC).
pub fn utc_filename_stamp() -> String {
    let duration = unix_now();
    let (y, mo, d, h, mi, s) = utc_ymdhms(duration.as_secs());
    format!("{y:04}{mo:02}{d:02}{h:02}{mi:02}{s:02}")
}

/// Calendar UTC components from Unix seconds (Howard Hinnant civil algorithm).
pub fn utc_ymdhms(seconds: u64) -> (u32, u32, u32, u32, u32, u32) {
    let mut secs = seconds;
    let days = secs / 86_400;
    secs %= 86_400;
    let h = (secs / 3_600) as u32;
    secs %= 3_600;
    let mi = (secs / 60) as u32;
    let s = (secs % 60) as u32;

    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe + era * 400) as i64;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo_i = mp as i64 + if mp < 10 { 3 } else { -9 };
    let y = y + if mo_i <= 2 { 1 } else { 0 };
    (y as u32, mo_i as u32, d as u32, h, mi, s)
}

fn unix_now() -> Duration {
    // A system clock set before 1970 is not a real scenario we support; rather
    // than propagate an error through every timestamp caller, we fall back to
    // the epoch so logs/filenames stay well-formed (they just read as 1970).
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_millis_shape() {
        let ts = utc_timestamp_iso_millis();
        assert!(ts.ends_with('Z'));
        assert!(ts.contains('.'));
        assert_eq!(ts.len(), "2026-05-29T12:00:00.010Z".len());
    }

    #[test]
    fn filename_stamp_shape() {
        let stamp = utc_filename_stamp();
        assert_eq!(stamp.len(), 14);
        assert!(stamp.chars().all(|ch| ch.is_ascii_digit()));
    }

    #[test]
    fn known_unix_second() {
        let (y, mo, d, h, mi, s) = utc_ymdhms(1_780_056_000);
        assert_eq!((y, mo, d, h, mi, s), (2026, 5, 29, 12, 0, 0));
    }
}
