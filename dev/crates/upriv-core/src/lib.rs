//! Upriv product logic — crypto, vault I/O, 7z, state machine.
//! Desktop (`src-tauri`) and mobile (JNI/FFI) call this crate only.

/// Application / crate version (shared with Tauri `app_version` command).
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
