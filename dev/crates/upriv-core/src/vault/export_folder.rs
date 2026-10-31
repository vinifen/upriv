//! The folder a person chose for an export, and the one file an export
//! writes there: a vault `.zip`, `.7z`, or plain-text `.zip`, the backups of a
//! vault, or the data-folder zip.
//!
//! The file is written as `<file>.upriv-part` and renamed into place once it
//! is complete. A file already using the name, or one still being written, is
//! never replaced: the data-folder zip refuses that name (its window asks for
//! another), and a vault or backup export takes the next free number
//! (`Notes 2.zip`).

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::error::{Result, UprivError};
#[allow(unused_imports)]
use crate::host_fs::HostFsQuery;
use crate::paths::VaultRoot;
use crate::session::Job;

use super::partial::{discard_partial, PartialWork};

/// Suffix of an export file that is still being written.
pub(super) const PART_SUFFIX: &str = ".upriv-part";

/// Refuse a folder inside a `.upriv`, including a picked Android tree whose
/// address is, and a path that is not a folder.
pub(super) fn check_export_folder(root: &VaultRoot, dest_dir: &Path) -> Result<()> {
    // A picked Android folder is the logical export root. Its tree address
    // says whether it sits inside a `.upriv`.
    let picked_tree = crate::host_fs::export_tree_uri(dest_dir);
    if crate::paths::path_is_under_reserved_upriv_tree(dest_dir)
        || picked_tree
            .is_some_and(|uri| crate::paths::path_is_under_reserved_upriv_tree(Path::new(&uri)))
        || crate::paths::is_reserved_upriv_workspace_path(dest_dir, root.root())
    {
        return Err(UprivError::ExportDestinationReserved(
            dest_dir.to_path_buf(),
        ));
    }
    if !dest_dir.host_is_dir() {
        return Err(std::io::Error::new(ErrorKind::NotFound, "export folder not found").into());
    }
    Ok(())
}

/// One export file in the chosen folder, and the partial it is renamed from.
pub(super) struct ExportFile {
    pub(super) dir: PathBuf,
    pub(super) dest: PathBuf,
    pub(super) partial: PathBuf,
}

impl ExportFile {
    pub(super) fn new(dir: &Path, file_name: &str) -> Self {
        Self {
            dir: dir.to_path_buf(),
            dest: dir.join(file_name),
            partial: dir.join(format!("{file_name}{PART_SUFFIX}")),
        }
    }

    /// The file, or one still being written under its name, is already there.
    pub(super) fn is_taken(&self) -> bool {
        self.dest.host_exists() || self.partial.host_exists()
    }

    /// Flush the finished partial and rename it into place. A file that
    /// arrived under the name meanwhile fails with `AlreadyExists`.
    pub(super) fn install(&self) -> Result<()> {
        crate::paths::sync_file_durable(&self.partial)?;
        crate::host_fs::rename_no_replace(&self.partial, &self.dest)?;
        Ok(())
    }
}

/// Highest number a taken export name takes before the export gives up.
const EXPORT_NAME_NUMBER_MAX: u32 = 9_999;

/// An export file name that takes a number while it is taken: `Notes.zip`,
/// then `Notes 2.zip`, `Notes 3.zip`, …
pub(super) struct NumberedExportName {
    stem: String,
    extension: String,
}

impl NumberedExportName {
    pub(super) fn new(stem: &str, extension: &str) -> Self {
        Self {
            stem: stem.to_string(),
            extension: extension.to_string(),
        }
    }

    /// The name with `number` added; `1` is the name itself.
    pub(super) fn file_name(&self, number: u32) -> String {
        if number <= 1 {
            format!("{}.{}", self.stem, self.extension)
        } else {
            format!("{} {number}.{}", self.stem, self.extension)
        }
    }

    /// The first number from `from` with neither a file nor a partial under
    /// its name in `dir`.
    pub(super) fn first_free(&self, dir: &Path, from: u32) -> Result<u32> {
        (from.max(1)..=EXPORT_NAME_NUMBER_MAX)
            .find(|&number| !ExportFile::new(dir, &self.file_name(number)).is_taken())
            .ok_or_else(|| {
                std::io::Error::new(ErrorKind::AlreadyExists, "no free export file name").into()
            })
    }

    /// Flush the finished `partial` and rename it to the name with `number`,
    /// or with the next free number when a file arrived under it meanwhile.
    /// An existing file is never replaced. Returns where it went and its number.
    pub(super) fn install(
        &self,
        dir: &Path,
        partial: &Path,
        mut number: u32,
    ) -> Result<(PathBuf, u32)> {
        crate::paths::sync_file_durable(partial)?;
        loop {
            let dest = dir.join(self.file_name(number));
            match crate::host_fs::rename_no_replace(partial, &dest) {
                Ok(()) => return Ok((dest, number)),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    number = self.first_free(dir, number + 1)?;
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
}

/// The file a vault or backup export wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportedFile {
    pub path: PathBuf,
    pub size: u64,
    /// `1` for the export's own name; higher when that name was taken and the
    /// file got this number (`Notes 2.zip`).
    pub number: u32,
}

/// Where a numbered export goes: the first free name in the chosen folder,
/// and the partial it is written as.
pub(super) struct NumberedExportTarget {
    dir: PathBuf,
    name: NumberedExportName,
    number: u32,
    partial: PathBuf,
}

impl NumberedExportTarget {
    pub(super) fn new(dest_dir: &Path, name: NumberedExportName) -> Result<Self> {
        let number = name.first_free(dest_dir, 1)?;
        let partial = ExportFile::new(dest_dir, &name.file_name(number)).partial;
        Ok(Self {
            dir: dest_dir.to_path_buf(),
            name,
            number,
            partial,
        })
    }

    /// The file the export is written as until it is complete.
    pub(super) fn partial(&self) -> &Path {
        &self.partial
    }

    /// Write the export into its partial with `write`, then move it to its
    /// free name. On any failure the partial is removed and logged as `work`;
    /// a failure after a stop reads as the stop.
    pub(super) fn write(
        &self,
        root: &VaultRoot,
        job: &Job,
        work: PartialWork,
        write: impl FnOnce(&Path) -> Result<u64>,
    ) -> Result<ExportedFile> {
        self.write_clearing(root, job, write, |partial| discard_partial(partial, work))
    }

    /// [`Self::write`], with `clear` deciding how a failure gets rid of the partial.
    pub(super) fn write_clearing(
        &self,
        root: &VaultRoot,
        job: &Job,
        write: impl FnOnce(&Path) -> Result<u64>,
        clear: impl FnOnce(&Path),
    ) -> Result<ExportedFile> {
        let installed = (|| {
            let size = job.settle(write(&self.partial))?;
            job.ensure_running()?;
            let (path, number) = self.name.install(&self.dir, &self.partial, self.number)?;
            Ok(ExportedFile { path, size, number })
        })();
        installed.map_err(|error| {
            clear(&self.partial);
            unreachable_folder_as_io(error, root)
        })
    }
}

/// `taken` for an `AlreadyExists` failure of [`ExportFile::install`] or of the
/// partial's `create_new`; any other error as it is.
pub(super) fn name_taken_as(error: UprivError, taken: impl FnOnce() -> UprivError) -> UprivError {
    match error {
        UprivError::Io(io) if io.kind() == ErrorKind::AlreadyExists => taken(),
        other => other,
    }
}

/// A picked Android folder whose drive stops answering fails the export like
/// any write error. Only a data folder that stops answering stays unreachable,
/// which asks the person to reconnect it.
pub(super) fn unreachable_folder_as_io(error: UprivError, root: &VaultRoot) -> UprivError {
    match error {
        UprivError::Io(io) if crate::host_fs::is_unreachable(&io) && root.root().host_is_dir() => {
            UprivError::Io(std::io::Error::new(io.kind(), io.to_string()))
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::vault_root_with;

    #[test]
    fn a_folder_inside_a_upriv_is_refused() {
        let (_tmp, root) = vault_root_with(&[]);
        let inside = root.root().join(".upriv/app");
        crate::host_fs::create_dir_all(&inside).unwrap();
        assert!(matches!(
            check_export_folder(&root, &inside),
            Err(UprivError::ExportDestinationReserved(_))
        ));
        let other = tempfile::tempdir().unwrap();
        let other_upriv = other.path().join(".upriv");
        crate::host_fs::create_dir_all(&other_upriv).unwrap();
        assert!(matches!(
            check_export_folder(&root, &other_upriv),
            Err(UprivError::ExportDestinationReserved(_))
        ));
        check_export_folder(&root, other.path()).unwrap();
    }

    #[test]
    fn a_missing_folder_is_refused() {
        let (_tmp, root) = vault_root_with(&[]);
        let gone = tempfile::tempdir().unwrap().path().join("gone");
        assert!(matches!(
            check_export_folder(&root, &gone),
            Err(UprivError::Io(io)) if io.kind() == ErrorKind::NotFound
        ));
    }

    #[test]
    fn a_file_or_a_partial_under_the_name_takes_it_and_install_never_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let file = ExportFile::new(dir.path(), "Notes.zip");
        assert!(!file.is_taken());
        crate::host_fs::write(&file.partial, b"half").unwrap();
        assert!(file.is_taken());
        crate::host_fs::write(&file.dest, b"older").unwrap();
        let refused = file.install().map_err(|error| {
            name_taken_as(error, || {
                UprivError::DataFolderExportNameTaken(file.dest.clone())
            })
        });
        assert!(matches!(
            refused,
            Err(UprivError::DataFolderExportNameTaken(_))
        ));
        assert_eq!(crate::host_fs::read(&file.dest).unwrap(), b"older");
    }

    #[test]
    fn a_taken_name_takes_the_next_free_number() {
        let dir = tempfile::tempdir().unwrap();
        let name = NumberedExportName::new("My notes", "zip");
        assert_eq!(name.file_name(1), "My notes.zip");
        assert_eq!(name.file_name(3), "My notes 3.zip");
        assert_eq!(name.first_free(dir.path(), 1).unwrap(), 1);

        crate::host_fs::write(dir.path().join("My notes.zip"), b"older").unwrap();
        // A copy still being written holds its name too.
        crate::host_fs::write(dir.path().join("My notes 2.zip.upriv-part"), b"half").unwrap();
        assert_eq!(name.first_free(dir.path(), 1).unwrap(), 3);
    }

    #[test]
    fn a_file_that_arrives_meanwhile_moves_the_export_to_the_next_number() {
        let dir = tempfile::tempdir().unwrap();
        let name = NumberedExportName::new("My notes", "7z");
        let partial = dir.path().join("My notes.7z.upriv-part");
        crate::host_fs::write(&partial, b"export").unwrap();
        crate::host_fs::write(dir.path().join("My notes.7z"), b"arrived").unwrap();

        let (dest, number) = name.install(dir.path(), &partial, 1).unwrap();
        assert_eq!(
            (dest.clone(), number),
            (dir.path().join("My notes 2.7z"), 2)
        );
        assert_eq!(crate::host_fs::read(&dest).unwrap(), b"export");
        assert_eq!(
            crate::host_fs::read(dir.path().join("My notes.7z")).unwrap(),
            b"arrived"
        );
        assert!(!partial.host_exists());
    }

    #[test]
    fn install_moves_the_finished_file_into_place() {
        let dir = tempfile::tempdir().unwrap();
        let file = ExportFile::new(dir.path(), "Notes.7z");
        crate::host_fs::write(&file.partial, b"done").unwrap();
        file.install().unwrap();
        assert_eq!(crate::host_fs::read(&file.dest).unwrap(), b"done");
        assert!(!file.partial.host_exists());
    }
}
