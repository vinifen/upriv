//! Apps that still have files of a plaintext folder open. A manual lock
//! names them first: an app that saves after the lock writes a file the vault
//! no longer reads, and close keeps that file for recovery.
//!
//! Linux reads `/proc`, Windows asks the Restart Manager. Other systems have
//! no cheap way to tell and report nobody.

use std::path::Path;

use serde::Serialize;

/// Most apps one answer names.
const MAX_HOLDERS: usize = 20;

/// One app with a file in the folder open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainHolder {
    pub name: String,
    pub pid: u32,
}

pub(super) fn holders(folder: &Path) -> Vec<PlainHolder> {
    if crate::host_fs::is_bridge_path(folder) {
        return Vec::new();
    }
    let mut found = platform::holders(folder);
    found.sort_by(|a, b| a.name.cmp(&b.name).then(a.pid.cmp(&b.pid)));
    found.dedup();
    found.truncate(MAX_HOLDERS);
    found
}

#[cfg(target_os = "linux")]
mod platform {
    use std::path::Path;

    use super::{PlainHolder, MAX_HOLDERS};

    pub(super) fn holders(folder: &Path) -> Vec<PlainHolder> {
        let Ok(folder) = std::fs::canonicalize(folder) else {
            return Vec::new();
        };
        let own = std::process::id();
        let Ok(processes) = std::fs::read_dir("/proc") else {
            return Vec::new();
        };
        let mut found = Vec::new();
        for process in processes.flatten() {
            let Some(pid) = process
                .file_name()
                .to_str()
                .and_then(|name| name.parse::<u32>().ok())
            else {
                continue;
            };
            if pid == own || !holds_file_under(&process.path(), &folder) {
                continue;
            }
            let name = std::fs::read_to_string(process.path().join("comm"))
                .map(|comm| comm.trim().to_string())
                .unwrap_or_default();
            found.push(PlainHolder { name, pid });
            if found.len() >= MAX_HOLDERS {
                break;
            }
        }
        found
    }

    /// Open descriptors only. Another user's processes are not readable, and
    /// cannot read an owner-only folder either.
    fn holds_file_under(process: &Path, folder: &Path) -> bool {
        let Ok(fds) = std::fs::read_dir(process.join("fd")) else {
            return false;
        };
        fds.flatten().any(|fd| {
            std::fs::read_link(fd.path())
                .is_ok_and(|target| target != folder && target.starts_with(folder))
        })
    }
}

#[cfg(windows)]
mod platform {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use super::PlainHolder;

    /// Files the Restart Manager is asked about at once.
    const MAX_FILES: usize = 4_096;
    const ERROR_MORE_DATA: u32 = 234;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct UniqueProcess {
        pid: u32,
        start_low: u32,
        start_high: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ProcessInfo {
        process: UniqueProcess,
        app_name: [u16; 256],
        service_short_name: [u16; 64],
        application_type: i32,
        app_status: u32,
        ts_session_id: u32,
        restartable: i32,
    }

    #[link(name = "rstrtmgr")]
    extern "system" {
        fn RmStartSession(session: *mut u32, flags: u32, key: *mut u16) -> u32;
        fn RmRegisterResources(
            session: u32,
            files_len: u32,
            files: *const *const u16,
            apps_len: u32,
            apps: *const UniqueProcess,
            services_len: u32,
            services: *const *const u16,
        ) -> u32;
        fn RmGetList(
            session: u32,
            needed: *mut u32,
            len: *mut u32,
            info: *mut ProcessInfo,
            reasons: *mut u32,
        ) -> u32;
        fn RmEndSession(session: u32) -> u32;
    }

    pub(super) fn holders(folder: &Path) -> Vec<PlainHolder> {
        let files = files_under(folder);
        if files.is_empty() {
            return Vec::new();
        }
        let mut session = 0u32;
        let mut key = [0u16; 33];
        if unsafe { RmStartSession(&mut session, 0, key.as_mut_ptr()) } != 0 {
            return Vec::new();
        }
        let found = list(session, &files);
        unsafe { RmEndSession(session) };
        found
    }

    fn list(session: u32, files: &[Vec<u16>]) -> Vec<PlainHolder> {
        let pointers: Vec<*const u16> = files.iter().map(|file| file.as_ptr()).collect();
        let registered = unsafe {
            RmRegisterResources(
                session,
                pointers.len() as u32,
                pointers.as_ptr(),
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
            )
        };
        if registered != 0 {
            return Vec::new();
        }
        let mut capacity = 16usize;
        loop {
            let empty = ProcessInfo {
                process: UniqueProcess {
                    pid: 0,
                    start_low: 0,
                    start_high: 0,
                },
                app_name: [0; 256],
                service_short_name: [0; 64],
                application_type: 0,
                app_status: 0,
                ts_session_id: 0,
                restartable: 0,
            };
            let mut info = vec![empty; capacity];
            let mut needed = 0u32;
            let mut len = capacity as u32;
            let mut reasons = 0u32;
            let status = unsafe {
                RmGetList(
                    session,
                    &mut needed,
                    &mut len,
                    info.as_mut_ptr(),
                    &mut reasons,
                )
            };
            if status == ERROR_MORE_DATA && (needed as usize) > capacity && capacity < 1024 {
                capacity = needed as usize;
                continue;
            }
            if status != 0 {
                return Vec::new();
            }
            return info[..len as usize]
                .iter()
                .map(|app| {
                    let end = app
                        .app_name
                        .iter()
                        .position(|unit| *unit == 0)
                        .unwrap_or(256);
                    PlainHolder {
                        name: String::from_utf16_lossy(&app.app_name[..end]),
                        pid: app.process.pid,
                    }
                })
                .collect();
        }
    }

    fn files_under(folder: &Path) -> Vec<Vec<u16>> {
        let mut files = Vec::new();
        let mut pending = vec![folder.to_path_buf()];
        while let Some(dir) = pending.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if kind.is_symlink() {
                    continue;
                }
                if kind.is_dir() {
                    pending.push(entry.path());
                } else if kind.is_file() {
                    let wide = entry
                        .path()
                        .as_os_str()
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                    files.push(wide);
                    if files.len() >= MAX_FILES {
                        return files;
                    }
                }
            }
        }
        files
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    use std::path::Path;

    use super::PlainHolder;

    pub(super) fn holders(_folder: &Path) -> Vec<PlainHolder> {
        Vec::new()
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn a_process_with_a_file_open_in_the_folder_is_named() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("Notes");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("a.txt"), b"x").unwrap();
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .stdin(std::fs::File::open(folder.join("a.txt")).unwrap())
            .spawn()
            .unwrap();
        let found = holders(&folder);
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            found.iter().any(|holder| holder.pid == child.id()),
            "{found:?}"
        );
        assert!(holders(&tmp.path().join("Other")).is_empty());
    }
}
