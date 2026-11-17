//! Which paths a device group's rows may hold, and when two paths are the
//! same folder or one is inside another. Checked as text for the group's own
//! system, so a Windows row is judged the same way on Linux. Pure: no I/O.
//!
//! The cases are shared with TypeScript (`folder-path-cases.json`).

use serde::Serialize;

use crate::device::DeviceSystem;
use crate::paths::reserved::{is_content_uri, path_is_under_reserved_upriv_tree, percent_decoded};

/// The folder Upriv makes for unlocked folders inside a row.
pub const UNLOCKED_CONTAINER: &str = "upriv-unlocked";
/// The folder Upriv makes for the app's backups inside a row.
pub const SHARED_BACKUPS_CONTAINER: &str = "upriv-backups";

/// Which list a row belongs to: each keeps out of the folders Upriv makes
/// for the others.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListKind {
    DataFolder,
    Unlocked,
    Backup,
}

/// Why a row's path is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PathIssue {
    Empty,
    NotAbsolute,
    /// Inside a `.upriv` tree.
    Reserved,
    /// Inside a folder Upriv makes for another list: a backup folder inside
    /// an unlocked folder, or the other way round.
    Overlap,
}

impl PathIssue {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::NotAbsolute => "not_absolute",
            Self::Reserved => "reserved",
            Self::Overlap => "overlap",
        }
    }
}

/// Why `path` cannot be a row of a `kind` list on a `system` device.
pub fn path_issue(system: DeviceSystem, kind: ListKind, path: &str) -> Option<PathIssue> {
    let path = path.trim();
    if path.is_empty() {
        return Some(PathIssue::Empty);
    }
    let Some(parts) = parts(system, path) else {
        return Some(PathIssue::NotAbsolute);
    };
    if path_is_under_reserved_upriv_tree(std::path::Path::new(path)) {
        return Some(PathIssue::Reserved);
    }
    // An unlocked row may itself be an `upriv-unlocked` folder, never a
    // folder inside one: a plain-text close wipes what is in there.
    let last = parts.segments.len().saturating_sub(1);
    let inside_other = parts
        .segments
        .iter()
        .enumerate()
        .any(|(index, segment)| match kind {
            ListKind::Unlocked => {
                is_backups_container(segment) || (segment == UNLOCKED_CONTAINER && index != last)
            }
            ListKind::Backup => segment == UNLOCKED_CONTAINER,
            ListKind::DataFolder => segment == UNLOCKED_CONTAINER || is_backups_container(segment),
        });
    inside_other.then_some(PathIssue::Overlap)
}

/// `upriv-backups`, or a vault's own `upriv-<folder id>-backups`, compared
/// after the case fold of systems that ignore case.
fn is_backups_container(segment: &str) -> bool {
    segment == SHARED_BACKUPS_CONTAINER
        || segment
            .strip_prefix("upriv-")
            .and_then(|rest| rest.strip_suffix("-backups"))
            .is_some_and(|id| !id.is_empty())
}

/// True when `a` and `b` name the same folder on a `system` device.
pub fn same_path(system: DeviceSystem, a: &str, b: &str) -> bool {
    match (parts(system, a), parts(system, b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// True when `inner` is `outer` or a folder inside it on a `system` device.
pub fn is_within(system: DeviceSystem, inner: &str, outer: &str) -> bool {
    match (parts(system, inner), parts(system, outer)) {
        (Some(inner), Some(outer)) => {
            inner.root == outer.root && inner.segments.starts_with(&outer.segments)
        }
        _ => false,
    }
}

/// An absolute path taken apart for comparing: its root and its folders,
/// case folded where the system ignores case.
#[derive(Debug, PartialEq, Eq)]
struct Parts {
    root: String,
    segments: Vec<String>,
}

fn parts(system: DeviceSystem, path: &str) -> Option<Parts> {
    let path = path.trim();
    match system {
        DeviceSystem::Linux => unix_parts(path, false),
        DeviceSystem::Macos | DeviceSystem::Ios => unix_parts(path, true),
        DeviceSystem::Windows => windows_parts(path),
        DeviceSystem::Android => tree_parts(path),
    }
}

fn split(rest: &str, separators: &[char], fold: bool) -> Vec<String> {
    rest.split(separators)
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            if fold {
                segment.to_lowercase()
            } else {
                segment.to_string()
            }
        })
        .collect()
}

fn unix_parts(path: &str, fold: bool) -> Option<Parts> {
    let rest = path.strip_prefix('/')?;
    Some(Parts {
        root: "/".into(),
        segments: split(rest, &['/'], fold),
    })
}

fn windows_parts(path: &str) -> Option<Parts> {
    let bytes = path.as_bytes();
    if let Some(unc) = path.strip_prefix(r"\\").or_else(|| path.strip_prefix("//")) {
        let mut segments = split(unc, &['\\', '/'], true);
        if segments.len() < 2 {
            return None;
        }
        let share: Vec<String> = segments.drain(..2).collect();
        return Some(Parts {
            root: format!(r"\\{}", share.join(r"\")),
            segments,
        });
    }
    let is_drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    if !is_drive {
        return None;
    }
    Some(Parts {
        root: path[..2].to_ascii_lowercase(),
        segments: split(&path[3..], &['\\', '/'], true),
    })
}

/// A storage-access tree: `content://<authority>/tree/<volume>:<path>`,
/// compared on its decoded volume and path.
fn tree_parts(path: &str) -> Option<Parts> {
    if !is_content_uri(path) {
        return None;
    }
    let decoded = percent_decoded(path);
    let rest = &decoded["content://".len()..];
    let (authority, tree) = rest.split_once("/tree/")?;
    let (volume, inside) = tree.split_once(':').unwrap_or((tree, ""));
    if authority.is_empty() || volume.is_empty() {
        return None;
    }
    Some(Parts {
        root: format!("{authority}/{volume}"),
        segments: split(inside, &['/'], false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Cases {
        valid: Vec<ValidCase>,
        same: Vec<PairCase>,
        inside: Vec<InsideCase>,
    }

    #[derive(Deserialize)]
    struct ValidCase {
        system: DeviceSystem,
        list: String,
        path: String,
        issue: Option<String>,
    }

    #[derive(Deserialize)]
    struct PairCase {
        system: DeviceSystem,
        a: String,
        b: String,
        same: bool,
    }

    #[derive(Deserialize)]
    struct InsideCase {
        system: DeviceSystem,
        inner: String,
        outer: String,
        inside: bool,
    }

    fn cases() -> Cases {
        serde_json::from_str(include_str!(
            "../../../../apps/shared/src/domain/folder-lists/folder-path-cases.json"
        ))
        .expect("folder-path-cases.json")
    }

    fn kind(list: &str) -> ListKind {
        match list {
            "data_folder" => ListKind::DataFolder,
            "unlocked" => ListKind::Unlocked,
            "backup" => ListKind::Backup,
            other => panic!("unknown list {other}"),
        }
    }

    #[test]
    fn rows_are_checked_against_their_own_system() {
        for case in cases().valid {
            let issue =
                path_issue(case.system, kind(&case.list), &case.path).map(PathIssue::as_str);
            assert_eq!(
                issue,
                case.issue.as_deref(),
                "{:?} {} {:?}",
                case.system,
                case.list,
                case.path
            );
        }
    }

    #[test]
    fn the_same_folder_is_found_after_trimming_and_case_folding() {
        for case in cases().same {
            assert_eq!(
                same_path(case.system, &case.a, &case.b),
                case.same,
                "{:?} {:?} {:?}",
                case.system,
                case.a,
                case.b
            );
        }
    }

    #[test]
    fn a_folder_inside_another_is_found_on_whole_names() {
        for case in cases().inside {
            assert_eq!(
                is_within(case.system, &case.inner, &case.outer),
                case.inside,
                "{:?} {:?} in {:?}",
                case.system,
                case.inner,
                case.outer
            );
        }
    }
}
