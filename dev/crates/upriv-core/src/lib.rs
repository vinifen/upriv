//! Upriv product logic — crypto, vault I/O, 7z, state machine.
//! Desktop (`upriv-daemon`) and mobile (JNI/FFI) call this crate only.

/// Application / crate version (shared with desktop `app_version` RPC).
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
