//! Move a `.upriv` tree from one parent folder to another.
//!
//! Used when Android copies the private app folder into a granted folder, and
//! to put it back when that setup does not finish. A same-disk move is a
//! rename. A copy is written as `.upriv.upriv-part` and renamed to `.upriv` only
//! once it has the same files and directories as the source, so a copy a crash
//! cut off is never taken for a data folder. The source is removed after that
//! rename. If the destination already has `.upriv`, both trees stay.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

use crate::error::{Result, UprivError};
use crate::session::{Job, JobKind};

/// The copy's name until every file is in place. A leftover one is a copy a
/// crash cut off; the next copy removes it first.
const COPY_NAME: &str = ".upriv.upriv-part";

/// Outcome of [`relocate_upriv_dir`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UprivDirRelocate {
    /// The source parent has no `.upriv` directory.
    Absent,
    /// `.upriv` now lives under the destination parent. The source copy is gone.
    Moved,
    /// The destination parent already has `.upriv`. The source was left in place.
    DestinationOccupied,
}

/// Copy `{source_parent}/.upriv` into `{dest_parent}/.upriv` as the job
/// `job_id`, which the person can stop until the copy is renamed into place.
/// A stop removes the copy and leaves the source as it was.
pub fn copy_data_folder_into(
    source_parent: &Path,
    dest_parent: &Path,
    job_id: &str,
) -> Result<UprivDirRelocate> {
    Job::run(job_id, JobKind::DataFolderCopy, None, |job| {
        relocate(source_parent, dest_parent, job)
    })
}

/// Move `{source_parent}/.upriv` to `{dest_parent}/.upriv`, with no job: the
/// way back when a setup that copied it does not finish.
pub fn relocate_upriv_dir(source_parent: &Path, dest_parent: &Path) -> Result<UprivDirRelocate> {
    relocate(source_parent, dest_parent, &Job::untracked())
}

/// Local folders on the same disk are renamed. A storage-access destination,
/// or a cross-device move, is copied and the source is removed only after the
/// file list matches. A symlink anywhere in the source fails the move and
/// leaves the source in place.
fn relocate(source_parent: &Path, dest_parent: &Path, job: &Job) -> Result<UprivDirRelocate> {
    let source = source_parent.join(".upriv");
    let dest = dest_parent.join(".upriv");
    if !dir_exists_nofollow(&source)? {
        return Ok(UprivDirRelocate::Absent);
    }
    // A file (or anything else that is not a missing path) already occupies the
    // destination. Leave it so Repair can rename or delete it. A symlink is refused.
    if destination_occupied(&dest)? {
        return Ok(UprivDirRelocate::DestinationOccupied);
    }
    if same_dir(source_parent, dest_parent) {
        return Ok(UprivDirRelocate::Absent);
    }

    let source_files = file_manifest(&source)?;
    job.set_total(source_files.values().sum());
    crate::host_fs::create_dir_all(dest_parent)?;
    if local_rename(&source, &dest) {
        return Ok(UprivDirRelocate::Moved);
    }
    let copy = dest_parent.join(COPY_NAME);
    remove_copy(&copy)?;
    let copied = copy_tree(&source, &copy, job).and_then(|()| match file_manifest(&copy) {
        Ok(copied) if copied == source_files => Ok(()),
        Ok(_) | Err(_) => Err(io_other("copied data folder does not match the source")),
    });
    // A stop that came first keeps the copy from being renamed into place.
    if let Err(error) = copied.and_then(|()| job.final_step()) {
        let _ = remove_copy(&copy);
        return Err(error);
    }
    if let Err(error) = crate::host_fs::rename(&copy, &dest) {
        let _ = remove_copy(&copy);
        return Err(UprivError::Io(error));
    }
    crate::host_fs::remove_dir_all(&source).map_err(UprivError::Io)?;
    Ok(UprivDirRelocate::Moved)
}

/// Remove a copy that is not in place. Nothing there is fine.
fn remove_copy(copy: &Path) -> Result<()> {
    match crate::host_fs::remove_dir_all(copy) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(UprivError::Io(error)),
    }
}

/// True when `path` exists and is not a symlink. A symlink is an error.
fn destination_occupied(path: &Path) -> Result<bool> {
    match crate::host_fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(io_other("refusing a symlink")),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(UprivError::Io(error)),
    }
}

fn dir_exists_nofollow(path: &Path) -> Result<bool> {
    match crate::host_fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(io_other("refusing a symlink")),
        Ok(meta) if meta.is_dir() => Ok(true),
        Ok(_) => Err(io_other("data folder path is not a directory")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(UprivError::Io(error)),
    }
}

fn same_dir(left: &Path, right: &Path) -> bool {
    let left = crate::host_fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = crate::host_fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    left == right
}

/// Same-disk rename. A storage-access destination is copied instead.
fn local_rename(source: &Path, dest: &Path) -> bool {
    #[cfg(test)]
    if FORCE_COPY.with(|flag| flag.get()) {
        return false;
    }
    if crate::host_fs::is_bridge_path(source) || crate::host_fs::is_bridge_path(dest) {
        return false;
    }
    crate::host_fs::rename(source, dest).is_ok()
}

fn file_manifest(root: &Path) -> Result<BTreeMap<String, u64>> {
    let mut files = BTreeMap::new();
    walk_files(root, root, &mut files)?;
    Ok(files)
}

fn walk_files(root: &Path, dir: &Path, files: &mut BTreeMap<String, u64>) -> Result<()> {
    for entry in crate::host_fs::read_dir(dir).map_err(UprivError::Io)? {
        let entry = entry.map_err(UprivError::Io)?;
        let path = entry.path();
        let meta = crate::host_fs::symlink_metadata(&path).map_err(UprivError::Io)?;
        if meta.file_type().is_symlink() {
            return Err(io_other("refusing a symlink"));
        }
        if meta.is_dir() {
            let key = relative_key(root, &path)?;
            files.insert(format!("{key}/"), 0);
            walk_files(root, &path, files)?;
        } else if meta.is_file() {
            let key = relative_key(root, &path)?;
            files.insert(key, meta.len());
        } else {
            return Err(io_other("refusing a special file"));
        }
    }
    Ok(())
}

fn relative_key(root: &Path, path: &Path) -> Result<String> {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let mut parts = Vec::new();
    for component in rel.components() {
        let text = component
            .as_os_str()
            .to_str()
            .ok_or_else(|| io_other("data folder path is not utf-8"))?;
        parts.push(text);
    }
    Ok(parts.join("/"))
}

fn copy_tree(src: &Path, dst: &Path, job: &Job) -> Result<()> {
    crate::host_fs::create_dir_all(dst).map_err(UprivError::Io)?;
    for entry in crate::host_fs::read_dir(src).map_err(UprivError::Io)? {
        job.ensure_running()?;
        let entry = entry.map_err(UprivError::Io)?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = crate::host_fs::symlink_metadata(&from).map_err(UprivError::Io)?;
        if meta.file_type().is_symlink() {
            return Err(io_other("refusing a symlink"));
        }
        if meta.is_dir() {
            copy_tree(&from, &to, job)?;
        } else if meta.is_file() {
            copy_file(&from, &to, job)?;
        } else {
            return Err(io_other("refusing a special file"));
        }
    }
    Ok(())
}

/// Each block written fails once `job` is asked to stop.
fn copy_file(src: &Path, dst: &Path, job: &Job) -> Result<()> {
    let input = crate::host_fs::File::open(src).map_err(UprivError::Io)?;
    let output = crate::host_fs::File::create(dst).map_err(UprivError::Io)?;
    let mut writer = job.writer(output);
    std::io::copy(&mut job.progress_reader(input), &mut writer).map_err(UprivError::Io)?;
    writer.flush().map_err(UprivError::Io)?;
    writer.into_inner().sync_all().map_err(UprivError::Io)?;
    Ok(())
}

fn io_other(message: &str) -> UprivError {
    UprivError::Io(std::io::Error::other(message))
}

#[cfg(test)]
thread_local! {
    static FORCE_COPY: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
struct ForceCopy;

#[cfg(test)]
impl ForceCopy {
    fn new() -> Self {
        FORCE_COPY.with(|flag| flag.set(true));
        Self
    }
}

#[cfg(test)]
impl Drop for ForceCopy {
    fn drop(&mut self) {
        FORCE_COPY.with(|flag| flag.set(false));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    struct ReadonlyDir<'a>(&'a Path);

    #[cfg(unix)]
    impl<'a> ReadonlyDir<'a> {
        fn new(path: &'a Path) -> Self {
            let mut perms = std::fs::metadata(path).unwrap().permissions();
            perms.set_readonly(true);
            std::fs::set_permissions(path, perms).unwrap();
            Self(path)
        }
    }

    #[cfg(unix)]
    impl Drop for ReadonlyDir<'_> {
        fn drop(&mut self) {
            let Ok(meta) = std::fs::metadata(self.0) else {
                return;
            };
            use std::os::unix::fs::PermissionsExt;
            let mut perms = meta.permissions();
            // Owner write so the temp dir can be removed. `set_readonly(false)` on Unix
            // makes the directory world-writable.
            perms.set_mode(perms.mode() | 0o700);
            let _ = std::fs::set_permissions(self.0, perms);
        }
    }

    fn write_tree(parent: &Path) {
        let root = parent.join(".upriv");
        let vaults = root.join("vaults").join("notes");
        crate::host_fs::create_dir_all(&vaults).unwrap();
        crate::host_fs::write(root.join("settings.toml"), b"locale = \"en\"\n").unwrap();
        crate::host_fs::write(vaults.join("config.toml"), b"id = \"notes\"\n").unwrap();
    }

    #[test]
    fn moves_tree_and_removes_source() {
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        let outcome = relocate_upriv_dir(src_parent.path(), dst_parent.path()).unwrap();
        assert_eq!(outcome, UprivDirRelocate::Moved);
        assert!(!src_parent.path().join(".upriv").exists());
        let settings = dst_parent.path().join(".upriv").join("settings.toml");
        assert_eq!(
            crate::host_fs::read(&settings).unwrap(),
            b"locale = \"en\"\n"
        );
        assert!(dst_parent
            .path()
            .join(".upriv/vaults/notes/config.toml")
            .is_file());
    }

    #[test]
    fn leaves_both_when_destination_exists() {
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        write_tree(dst_parent.path());
        crate::host_fs::write(
            dst_parent.path().join(".upriv").join("settings.toml"),
            b"already\n",
        )
        .unwrap();
        let outcome = relocate_upriv_dir(src_parent.path(), dst_parent.path()).unwrap();
        assert_eq!(outcome, UprivDirRelocate::DestinationOccupied);
        assert!(src_parent.path().join(".upriv/settings.toml").is_file());
        assert_eq!(
            crate::host_fs::read(dst_parent.path().join(".upriv/settings.toml")).unwrap(),
            b"already\n"
        );
    }

    #[test]
    fn file_at_destination_stays_so_repair_can_remove_it() {
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        crate::host_fs::write(dst_parent.path().join(".upriv"), b"not a directory").unwrap();
        let outcome = relocate_upriv_dir(src_parent.path(), dst_parent.path()).unwrap();
        assert_eq!(outcome, UprivDirRelocate::DestinationOccupied);
        assert!(src_parent.path().join(".upriv/settings.toml").is_file());
        assert_eq!(
            crate::host_fs::read(dst_parent.path().join(".upriv")).unwrap(),
            b"not a directory"
        );
    }

    #[test]
    fn absent_source_is_a_no_op() {
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        let outcome = relocate_upriv_dir(src_parent.path(), dst_parent.path()).unwrap();
        assert_eq!(outcome, UprivDirRelocate::Absent);
        assert!(!dst_parent.path().join(".upriv").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_in_source_keeps_the_source() {
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        std::os::unix::fs::symlink(
            "settings.toml",
            src_parent.path().join(".upriv").join("alias"),
        )
        .unwrap();
        let error = relocate_upriv_dir(src_parent.path(), dst_parent.path()).unwrap_err();
        assert!(matches!(error, UprivError::Io(_)));
        assert!(src_parent.path().join(".upriv/settings.toml").is_file());
        assert!(!dst_parent.path().join(".upriv").exists());
    }

    #[test]
    fn copies_when_rename_is_unavailable_and_removes_the_source() {
        let _force = ForceCopy::new();
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        let empty = src_parent.path().join(".upriv/vaults/empty");
        crate::host_fs::create_dir_all(&empty).unwrap();
        let outcome = relocate_upriv_dir(src_parent.path(), dst_parent.path()).unwrap();
        assert_eq!(outcome, UprivDirRelocate::Moved);
        assert!(!src_parent.path().join(".upriv").exists());
        assert_eq!(
            crate::host_fs::read(dst_parent.path().join(".upriv/settings.toml")).unwrap(),
            b"locale = \"en\"\n"
        );
        assert!(dst_parent.path().join(".upriv/vaults/empty").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn copy_failure_keeps_the_source() {
        let _force = ForceCopy::new();
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        let restore = ReadonlyDir::new(dst_parent.path());
        let error = relocate_upriv_dir(src_parent.path(), dst_parent.path());
        drop(restore);
        assert!(error.is_err());
        assert!(src_parent.path().join(".upriv/settings.toml").is_file());
        assert!(!dst_parent.path().join(".upriv").exists());
    }

    #[test]
    fn a_stopped_copy_leaves_no_folder_and_keeps_the_source() {
        let _force = ForceCopy::new();
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        let job = crate::test_support::test_job_id();
        crate::session::cancel_job(&job).unwrap();
        let error = copy_data_folder_into(src_parent.path(), dst_parent.path(), &job).unwrap_err();
        assert!(matches!(error, UprivError::JobCancelled));
        assert!(src_parent.path().join(".upriv/settings.toml").is_file());
        assert!(!dst_parent.path().join(".upriv").exists());
        assert!(!dst_parent.path().join(COPY_NAME).exists());
    }

    #[test]
    fn a_copy_a_crash_cut_off_is_never_the_data_folder_and_goes_next_time() {
        let _force = ForceCopy::new();
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        let cut_off = dst_parent.path().join(COPY_NAME);
        crate::host_fs::create_dir_all(cut_off.join("vaults")).unwrap();
        crate::host_fs::write(cut_off.join("settings.toml"), b"half").unwrap();
        assert!(!dst_parent.path().join(".upriv").exists());

        let job = crate::test_support::test_job_id();
        let outcome = copy_data_folder_into(src_parent.path(), dst_parent.path(), &job).unwrap();
        assert_eq!(outcome, UprivDirRelocate::Moved);
        assert!(!cut_off.exists());
        assert_eq!(
            crate::host_fs::read(dst_parent.path().join(".upriv/settings.toml")).unwrap(),
            b"locale = \"en\"\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn special_file_keeps_the_source() {
        let src_parent = tempfile::tempdir().unwrap();
        let dst_parent = tempfile::tempdir().unwrap();
        write_tree(src_parent.path());
        let _sock =
            std::os::unix::net::UnixListener::bind(src_parent.path().join(".upriv").join("sock"))
                .unwrap();
        let error = relocate_upriv_dir(src_parent.path(), dst_parent.path()).unwrap_err();
        assert!(matches!(error, UprivError::Io(_)));
        assert!(src_parent.path().join(".upriv/settings.toml").is_file());
        assert!(!dst_parent.path().join(".upriv").exists());
    }
}
