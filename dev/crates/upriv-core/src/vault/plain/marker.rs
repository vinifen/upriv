//! `.upriv-plain` at the top of a plaintext folder: which vault and session
//! wrote the folder, and whether that session finished its wipe.
//!
//! The same token is recorded in `state.json` before anything is written to
//! the folder. A folder is wiped only when both agree, so a folder the user
//! moved there, or another vault's folder, is never touched.

use std::io::{self, Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::disk;

pub(super) const MARKER_NAME: &str = ".upriv-plain";
const MARKER_FORMAT: u32 = 1;
const MARKER_MAX_BYTES: u64 = 16 * 1024;

/// Files the app may place at the top of a folder for other apps. A marker
/// naming anything else is not trusted for it.
pub(super) const KNOWN_HELPERS: &[&str] = &[".nomedia", ".metadata_never_index"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum MarkerState {
    /// A session wrote vault files here and has not finished wiping them.
    Open,
    /// The last session wiped every file; only this marker is left.
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Marker {
    pub format_version: u32,
    pub vault_id: String,
    pub token: String,
    pub state: MarkerState,
    pub helpers: Vec<String>,
    /// Upriv made the folder itself. A folder the user made is emptied, never
    /// removed, and keeps its permissions.
    pub made_folder: bool,
}

impl Marker {
    pub(super) fn open(vault_id: &str, token: &str, helpers: &[String], made_folder: bool) -> Self {
        Self {
            format_version: MARKER_FORMAT,
            vault_id: vault_id.to_string(),
            token: token.to_string(),
            state: MarkerState::Open,
            helpers: helpers.to_vec(),
            made_folder,
        }
    }

    #[cfg(test)]
    pub(super) fn closed(&self) -> Self {
        Self {
            state: MarkerState::Closed,
            ..self.clone()
        }
    }

    pub(super) fn written_by(&self, vault_id: &str, token: &str) -> bool {
        self.vault_id == vault_id && self.token == token
    }

    /// Helper names this marker may claim, in the order it lists them.
    pub(super) fn trusted_helpers(&self) -> Vec<&str> {
        self.helpers
            .iter()
            .map(String::as_str)
            .filter(|name| KNOWN_HELPERS.contains(name))
            .collect()
    }
}

/// The marker in `folder`. `Ok(None)` when there is none; `InvalidData` when
/// the file is not a marker (too large, a link, or not this format).
pub(super) fn read(folder: &Path) -> io::Result<Option<Marker>> {
    let path = folder.join(MARKER_NAME);
    let mut file = match disk::open_for_import(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    (&mut file)
        .take(MARKER_MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MARKER_MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "marker too large",
        ));
    }
    let marker: Marker = serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if marker.format_version != MARKER_FORMAT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unknown marker format",
        ));
    }
    Ok(Some(marker))
}

/// Replace the marker in `folder` in one rename.
pub(super) fn write(folder: &Path, marker: &Marker) -> io::Result<()> {
    let bytes = serde_json::to_vec(marker)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let (temp, mut file) = disk::create_temp(folder)?;
    let written = (|| {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        crate::host_fs::rename(&temp, folder.join(MARKER_NAME))
    })();
    if written.is_err() {
        disk::discard(&temp);
    }
    written?;
    super::residue::hide(&folder.join(MARKER_NAME));
    Ok(())
}

pub(super) fn remove(folder: &Path) -> io::Result<()> {
    match crate::host_fs::remove_file(folder.join(MARKER_NAME)) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_round_trips_and_closes() {
        let tmp = tempfile::tempdir().unwrap();
        let marker = Marker::open("notes", "token-1", &[".nomedia".to_string()], true);
        write(tmp.path(), &marker).unwrap();
        let read_back = read(tmp.path()).unwrap().expect("marker");
        assert_eq!(read_back, marker);
        assert!(read_back.written_by("notes", "token-1"));
        assert!(!read_back.written_by("notes", "token-2"));
        assert!(!read_back.written_by("other", "token-1"));

        write(tmp.path(), &marker.closed()).unwrap();
        assert_eq!(
            read(tmp.path()).unwrap().expect("marker").state,
            MarkerState::Closed
        );
        let names: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(MARKER_NAME)]);
    }

    #[test]
    fn a_missing_marker_is_none_and_a_foreign_file_is_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read(tmp.path()).unwrap(), None);
        std::fs::write(tmp.path().join(MARKER_NAME), b"{\"anything\":1}").unwrap();
        assert_eq!(
            read(tmp.path()).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn helpers_outside_the_known_list_are_not_trusted() {
        let marker = Marker::open(
            "notes",
            "t",
            &[".nomedia".to_string(), "taxes.pdf".to_string()],
            true,
        );
        assert_eq!(marker.trusted_helpers(), vec![".nomedia"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_marker_that_is_a_link_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let elsewhere = tmp.path().join("elsewhere.json");
        let marker = Marker::open("notes", "t", &[], true);
        std::fs::write(&elsewhere, serde_json::to_vec(&marker).unwrap()).unwrap();
        std::os::unix::fs::symlink(&elsewhere, tmp.path().join(MARKER_NAME)).unwrap();
        assert!(read(tmp.path()).is_err());
    }
}
