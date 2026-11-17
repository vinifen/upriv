//! Addresses Upriv keeps for itself, and the address shapes a stored path may
//! take on any system.
//!
//! Settings travel with the data folder, so a Windows path must survive a
//! save on Linux and a phone's `content://` tree a save on a computer. Every
//! `.upriv` tree is Upriv's own: no folder of a list, export, or mount may be
//! inside one.

use std::ffi::OsStr;
use std::path::{Component, Path};

/// True when `path` is an absolute address of some system: Unix, a Windows
/// drive or UNC path, or a storage-access tree.
pub fn is_absolute_address(path: &str) -> bool {
    let path = path.trim();
    if path.starts_with("content://") || path.starts_with('/') || path.starts_with(r"\\") {
        return true;
    }
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// Whether `candidate` has a `.upriv` segment (case-insensitive), whatever
/// data folder it belongs to. A storage-access address is checked after
/// percent-decoding, so `…%2F.upriv` is the same reserved tree.
pub fn path_is_under_reserved_upriv_tree(candidate: &Path) -> bool {
    if let Some(text) = candidate.to_str() {
        let text = text.trim();
        if is_content_uri(text) {
            return content_uri_has_reserved_upriv_segment(text);
        }
        return text
            .split(['/', '\\'])
            .any(|part| part.eq_ignore_ascii_case(".upriv"));
    }
    candidate
        .components()
        .any(|c| matches!(c, Component::Normal(n) if os_str_eq_ignore_ascii_case(n, ".upriv")))
}

pub(crate) fn is_content_uri(text: &str) -> bool {
    text.len() >= "content://".len()
        && text[.."content://".len()].eq_ignore_ascii_case("content://")
}

/// Decoded tree and document ids. `primary:Upriv` is the data folder.
/// `primary:.upriv` and `…/.upriv` are the ciphertext tree.
fn content_uri_has_reserved_upriv_segment(uri: &str) -> bool {
    percent_decoded(uri)
        .split(['/', '\\'])
        .any(segment_is_reserved_upriv)
}

/// `uri` with percent escapes decoded, twice at most (a tree id escapes its
/// document id once more).
pub(crate) fn percent_decoded(uri: &str) -> String {
    let mut decoded = uri.to_string();
    for _ in 0..2 {
        let next = percent_decode_once(&decoded);
        if next == decoded {
            break;
        }
        decoded = next;
    }
    decoded
}

fn segment_is_reserved_upriv(segment: &str) -> bool {
    if segment.eq_ignore_ascii_case(".upriv") {
        return true;
    }
    segment
        .rsplit(':')
        .next()
        .is_some_and(|tail| tail.eq_ignore_ascii_case(".upriv"))
}

fn percent_decode_once(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(decoded) = hex_byte(bytes[index + 1], bytes[index + 2]) {
                out.push(decoded);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_byte(hi: u8, lo: u8) -> Option<u8> {
    Some(from_hex(hi)? << 4 | from_hex(lo)?)
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Whether `candidate` is `<data_folder>/.upriv` or anything under it.
pub fn is_inside_upriv_of(candidate: &Path, data_folder: &Path) -> bool {
    let Ok(upriv) = data_folder.join(".upriv").canonicalize() else {
        // Lexical compare when the paths do not exist yet.
        return paths_equal_or_under_casefold(candidate, &data_folder.join(".upriv"));
    };
    let Ok(cand) = candidate.canonicalize() else {
        return paths_equal_or_under_casefold(candidate, &data_folder.join(".upriv"));
    };
    cand == upriv || cand.starts_with(&upriv)
}

/// Lexical prefix match with ASCII casefold on `Normal` components (parity with TS
/// `toLowerCase()` when canonicalize is unavailable — Windows/macOS volumes).
fn paths_equal_or_under_casefold(candidate: &Path, prefix: &Path) -> bool {
    let c: Vec<_> = candidate.components().collect();
    let p: Vec<_> = prefix.components().collect();
    if c.len() < p.len() {
        return false;
    }
    c.iter()
        .zip(p.iter())
        .all(|(a, b)| components_eq_ignore_ascii_case(a, b))
}

fn components_eq_ignore_ascii_case(a: &Component<'_>, b: &Component<'_>) -> bool {
    match (a, b) {
        (Component::Normal(a), Component::Normal(b)) => a.eq_ignore_ascii_case(b),
        _ => a == b,
    }
}

fn os_str_eq_ignore_ascii_case(os: &OsStr, ascii: &str) -> bool {
    os.eq_ignore_ascii_case(OsStr::new(ascii))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_system_keeps_its_absolute_shapes() {
        for path in [
            "/home/me",
            r"D:\Backups",
            "D:/Backups",
            r"\\server\share\Upriv",
            "content://com.android.externalstorage.documents/tree/primary%3ADocuments",
        ] {
            assert!(is_absolute_address(path), "{path}");
        }
        for path in ["relative/folder", "D:", "", "  "] {
            assert!(!is_absolute_address(path), "{path}");
        }
    }

    #[test]
    fn anything_inside_a_upriv_tree_is_reserved() {
        let root = Path::new("/data/root");
        assert!(is_inside_upriv_of(
            Path::new("/data/root/.upriv/vaults"),
            root
        ));
        assert!(is_inside_upriv_of(Path::new("/data/root/.upriv"), root));
        assert!(!is_inside_upriv_of(
            Path::new("/data/root/upriv-unlocked"),
            root
        ));
        let mixed_case = Path::new("/data/Root");
        assert!(is_inside_upriv_of(
            Path::new("/data/root/.Upriv/Vaults"),
            mixed_case
        ));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.Upriv/Vaults/x"
        )));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.upriv"
        )));
        assert!(!path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/upriv"
        )));
    }

    #[test]
    fn a_storage_access_tree_inside_upriv_is_reserved_after_decoding() {
        let tree = "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FUpriv%2F.upriv";
        assert!(path_is_under_reserved_upriv_tree(Path::new(tree)));
        let twice = "content://com.android.externalstorage.documents/tree/primary%253A.upriv";
        assert!(path_is_under_reserved_upriv_tree(Path::new(twice)));
        let fine =
            "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FNotes";
        assert!(!path_is_under_reserved_upriv_tree(Path::new(fine)));
    }
}
