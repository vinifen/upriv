//! Upriv shared Rust core for desktop (`upriv-daemon`) and mobile (JNI/FFI).
//!
//! Current surface: structured `logging`, UTC `time` helpers, and `app_version()`.
//! Vault crypto, disk I/O, 7z, and the lifecycle state machine land here as the
//! product RPCs are ported.

pub mod logging;
pub mod time;

pub use time::{utc_filename_stamp, utc_timestamp_iso_millis, utc_ymdhms};

/// Application version (from `dev/VERSION`, set in build.rs).
pub fn app_version() -> &'static str {
    env!("UPRIV_APP_VERSION")
}
