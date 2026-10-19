//! Linux inotify for an open plaintext folder. Windows and macOS use the
//! two-minute pass in `upriv-core`. This daemon does not link `notify`, and
//! the mobile library does not link this watcher.

/// Install the folder watcher for this process. A failure leaves the
/// two-minute pass as the only notice of outside edits.
pub fn install() {
    #[cfg(target_os = "linux")]
    linux::install();
}

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::HashMap;
    use std::ffi::{CString, OsStr};
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::Arc;

    use upriv_core::{set_plain_observer, PlainObserver};

    pub fn install() {
        if let Some(watch) = LinuxWatch::spawn() {
            set_plain_observer(Arc::new(watch));
        }
    }

    struct LinuxWatch {
        tx: Sender<Cmd>,
        wake: libc::c_int,
    }

    enum Cmd {
        Watch {
            vault_id: String,
            folder: PathBuf,
            changed: Arc<dyn Fn() + Send + Sync>,
        },
        Unwatch {
            vault_id: String,
        },
    }

    #[derive(Clone)]
    struct Watched {
        vault_id: String,
        path: PathBuf,
        changed: Arc<dyn Fn() + Send + Sync>,
    }

    const INTEREST: u32 = libc::IN_ATTRIB
        | libc::IN_CLOSE_WRITE
        | libc::IN_CREATE
        | libc::IN_DELETE
        | libc::IN_MODIFY
        | libc::IN_MOVED_FROM
        | libc::IN_MOVED_TO
        | libc::IN_DELETE_SELF
        | libc::IN_DONT_FOLLOW
        | libc::IN_ONLYDIR
        | libc::IN_EXCL_UNLINK;

    impl LinuxWatch {
        fn spawn() -> Option<Self> {
            let (tx, rx) = mpsc::channel();
            let wake = unsafe { libc::eventfd(0, libc::EFD_CLOEXEC | libc::EFD_NONBLOCK) };
            if wake < 0 {
                return None;
            }
            let inotify = unsafe { libc::inotify_init1(libc::IN_CLOEXEC | libc::IN_NONBLOCK) };
            if inotify < 0 {
                unsafe { libc::close(wake) };
                return None;
            }
            if std::thread::Builder::new()
                .name("upriv-plain-watch".into())
                .spawn(move || run(inotify, wake, rx))
                .is_err()
            {
                unsafe {
                    libc::close(inotify);
                    libc::close(wake);
                }
                return None;
            }
            Some(Self { tx, wake })
        }

        fn signal(&self) {
            let one = 1u64;
            unsafe {
                libc::write(
                    self.wake,
                    &one as *const u64 as *const libc::c_void,
                    std::mem::size_of::<u64>(),
                );
            }
        }
    }

    impl PlainObserver for LinuxWatch {
        fn watch(&self, vault_id: &str, folder: &Path, changed: Arc<dyn Fn() + Send + Sync>) {
            if self
                .tx
                .send(Cmd::Watch {
                    vault_id: vault_id.to_string(),
                    folder: folder.to_path_buf(),
                    changed,
                })
                .is_ok()
            {
                self.signal();
            }
        }

        fn unwatch(&self, vault_id: &str) {
            if self
                .tx
                .send(Cmd::Unwatch {
                    vault_id: vault_id.to_string(),
                })
                .is_ok()
            {
                self.signal();
            }
        }
    }

    #[repr(C, align(8))]
    struct Aligned([u8; 8192]);

    fn run(inotify: libc::c_int, wake: libc::c_int, rx: Receiver<Cmd>) {
        let mut by_wd: HashMap<i32, Watched> = HashMap::new();
        loop {
            let mut fds = [
                libc::pollfd {
                    fd: inotify,
                    events: libc::POLLIN,
                    revents: 0,
                },
                libc::pollfd {
                    fd: wake,
                    events: libc::POLLIN,
                    revents: 0,
                },
            ];
            let ready = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, -1) };
            if ready < 0 {
                if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                break;
            }
            if fds[1].revents & libc::POLLIN != 0 {
                let mut value = 0u64;
                unsafe {
                    libc::read(
                        wake,
                        &mut value as *mut u64 as *mut libc::c_void,
                        std::mem::size_of::<u64>(),
                    );
                }
                while let Ok(cmd) = rx.try_recv() {
                    match cmd {
                        Cmd::Watch {
                            vault_id,
                            folder,
                            changed,
                        } => {
                            drop_vault(&mut by_wd, inotify, &vault_id);
                            add_tree(&mut by_wd, inotify, &vault_id, &folder, &changed);
                        }
                        Cmd::Unwatch { vault_id } => drop_vault(&mut by_wd, inotify, &vault_id),
                    }
                }
            }
            if fds[0].revents & (libc::POLLIN | libc::POLLERR) != 0 {
                drain_inotify(inotify, &mut by_wd);
            }
        }
    }

    fn drain_inotify(inotify: libc::c_int, by_wd: &mut HashMap<i32, Watched>) {
        let mut buf = Aligned([0u8; 8192]);
        let mut notify: Vec<Arc<dyn Fn() + Send + Sync>> = Vec::new();
        loop {
            let n = unsafe {
                libc::read(
                    inotify,
                    buf.0.as_mut_ptr() as *mut libc::c_void,
                    buf.0.len(),
                )
            };
            if n <= 0 {
                break;
            }
            let n = n as usize;
            let header = std::mem::size_of::<libc::inotify_event>();
            let mut offset = 0;
            while offset + header <= n {
                let event = unsafe { &*(buf.0.as_ptr().add(offset) as *const libc::inotify_event) };
                let total = header + event.len as usize;
                if offset + total > n {
                    break;
                }
                let name = event_name(&buf.0[offset + header..offset + total]);
                handle_event(inotify, by_wd, event, name, &mut notify);
                offset += total;
            }
        }
        for changed in notify {
            changed();
        }
    }

    fn handle_event(
        inotify: libc::c_int,
        by_wd: &mut HashMap<i32, Watched>,
        event: &libc::inotify_event,
        name: Option<&OsStr>,
        notify: &mut Vec<Arc<dyn Fn() + Send + Sync>>,
    ) {
        if event.mask & libc::IN_Q_OVERFLOW != 0 {
            let mut seen = std::collections::HashSet::new();
            for watched in by_wd.values() {
                if seen.insert(watched.vault_id.clone()) {
                    notify.push(Arc::clone(&watched.changed));
                }
            }
            return;
        }
        let Some(watched) = by_wd.get(&event.wd).cloned() else {
            return;
        };
        if event.mask & (libc::IN_IGNORED | libc::IN_DELETE_SELF) != 0 {
            by_wd.remove(&event.wd);
            notify.push(watched.changed);
            return;
        }
        if event.mask & libc::IN_ISDIR != 0
            && event.mask & (libc::IN_CREATE | libc::IN_MOVED_TO) != 0
        {
            if let Some(name) = name {
                if name != "." && name != ".." {
                    let child = watched.path.join(name);
                    add_tree(by_wd, inotify, &watched.vault_id, &child, &watched.changed);
                }
            }
        }
        notify.push(watched.changed);
    }

    fn event_name(bytes: &[u8]) -> Option<&OsStr> {
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        if end == 0 {
            None
        } else {
            Some(OsStr::from_bytes(&bytes[..end]))
        }
    }

    fn add_tree(
        by_wd: &mut HashMap<i32, Watched>,
        inotify: libc::c_int,
        vault_id: &str,
        path: &Path,
        changed: &Arc<dyn Fn() + Send + Sync>,
    ) {
        let mut pending = vec![path.to_path_buf()];
        while let Some(path) = pending.pop() {
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() || !meta.is_dir() {
                continue;
            }
            let Ok(c_path) = CString::new(path.as_os_str().as_bytes()) else {
                continue;
            };
            let wd = unsafe { libc::inotify_add_watch(inotify, c_path.as_ptr(), INTEREST) };
            if wd >= 0 {
                by_wd.insert(
                    wd,
                    Watched {
                        vault_id: vault_id.to_string(),
                        path: path.clone(),
                        changed: Arc::clone(changed),
                    },
                );
            }
            let Ok(entries) = std::fs::read_dir(&path) else {
                continue;
            };
            for entry in entries.flatten() {
                pending.push(entry.path());
            }
        }
    }

    fn drop_vault(by_wd: &mut HashMap<i32, Watched>, inotify: libc::c_int, vault_id: &str) {
        let stale: Vec<i32> = by_wd
            .iter()
            .filter(|(_, watched)| watched.vault_id == vault_id)
            .map(|(wd, _)| *wd)
            .collect();
        for wd in stale {
            by_wd.remove(&wd);
            unsafe {
                libc::inotify_rm_watch(inotify, wd);
            }
        }
    }
}
