//! Which store names a folder's filesystem can hold.
//!
//! A name the folder refuses, or two names it treats as one (`Notes.txt` and
//! `notes.txt` on a case-insensitive volume), would leave a vault file with no
//! folder copy, or one copy for two files. Open refuses those vaults, and a
//! pass does not write a name the folder cannot hold.

use std::borrow::Cow;
use std::collections::{BTreeSet, HashMap};

use unicode_normalization::UnicodeNormalization;

use super::volume::FsFamily;
use crate::store::{is_reserved_logical, VaultIndex};

/// Windows treats these stems as devices on every volume, with any extension.
const DEVICE_STEMS: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "COM¹", "COM²", "COM³", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
    "LPT9", "LPT¹", "LPT²", "LPT³",
];

/// Longest name outside Windows (`NAME_MAX`), in bytes of UTF-8.
const MAX_NAME_BYTES: usize = 255;
/// Longest name on the Windows family, in UTF-16 units.
const MAX_NAME_UNITS: usize = 255;
/// Store paths the open error lists. The count is always complete.
pub(super) const MAX_NAME_EXAMPLES: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct NameRules {
    family: FsFamily,
    /// The system counts a name in bytes (every system but Windows).
    byte_limit: bool,
    /// Device names are refused by Windows itself, whatever the volume.
    device_names: bool,
}

impl NameRules {
    pub(super) fn new(family: FsFamily) -> Self {
        Self {
            family,
            byte_limit: !cfg!(windows),
            device_names: cfg!(windows),
        }
    }

    /// True when the folder can hold one entry named `name`.
    pub(super) fn allows(&self, name: &str) -> bool {
        if name.is_empty() || (self.byte_limit && name.len() > MAX_NAME_BYTES) {
            return false;
        }
        if self.family == FsFamily::Windows {
            if name.encode_utf16().count() > MAX_NAME_UNITS {
                return false;
            }
            if name
                .chars()
                .any(|c| c.is_control() || r#"<>:"/\|?*"#.contains(c))
            {
                return false;
            }
            if name.ends_with('.') || name.ends_with(' ') {
                return false;
            }
        }
        !(self.device_names && is_device_name(name))
    }

    /// True when every component of a store path is allowed.
    pub(super) fn allows_path(&self, path: &str) -> bool {
        path.split('/').all(|part| self.allows(part))
    }

    /// One spelling per name the folder treats as the same entry.
    pub(super) fn fold<'a>(&self, name: &'a str) -> Cow<'a, str> {
        match self.family {
            FsFamily::Posix => Cow::Borrowed(name),
            FsFamily::Windows => Cow::Owned(name.to_lowercase()),
            FsFamily::Apple => Cow::Owned(name.nfd().collect::<String>().to_lowercase()),
        }
    }

    /// [`Self::fold`] for every component of a store path.
    pub(super) fn fold_path(&self, path: &str) -> String {
        match self.family {
            FsFamily::Posix => path.to_string(),
            _ => path
                .split('/')
                .map(|part| self.fold(part).into_owned())
                .collect::<Vec<_>>()
                .join("/"),
        }
    }
}

fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    DEVICE_STEMS.contains(&stem.to_uppercase().as_str())
}

/// Store paths this folder cannot hold: a refused name, or a name that is the
/// same entry as another one there. A bad folder is listed once, not with
/// every file under it; both spellings of a clash are listed.
pub(super) fn unsupported_names(index: &VaultIndex, rules: &NameRules) -> Vec<String> {
    let mut bad = BTreeSet::new();
    // Folded parent + folded name → the first store spelling.
    let mut seen: HashMap<(String, String), String> = HashMap::new();
    for node in &index.nodes {
        if is_reserved_logical(&node.path) {
            continue;
        }
        let mut parent = String::new();
        for part in node.path.split('/') {
            let spelled = if parent.is_empty() {
                part.to_string()
            } else {
                format!("{parent}/{part}")
            };
            if !rules.allows(part) {
                bad.insert(spelled);
                break;
            }
            let key = (rules.fold_path(&parent), rules.fold(part).into_owned());
            match seen.get(&key) {
                Some(first) if *first != spelled => {
                    bad.insert(first.clone());
                    bad.insert(spelled);
                    break;
                }
                Some(_) => {}
                None => {
                    seen.insert(key, spelled.clone());
                }
            }
            parent = spelled;
        }
    }
    bad.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{VaultNode, SEED_LOGICAL_PATH};

    fn index(paths: &[&str]) -> VaultIndex {
        let mut index = VaultIndex::empty();
        for path in paths {
            index
                .nodes
                .push(VaultNode::file(path, "f".into(), 1, vec![], vec![]));
        }
        index
    }

    fn rules(family: FsFamily, device_names: bool) -> NameRules {
        NameRules {
            family,
            byte_limit: true,
            device_names,
        }
    }

    #[test]
    fn windows_rules_refuse_characters_devices_and_trailing_dots() {
        let rules = rules(FsFamily::Windows, true);
        assert!(rules.allows("notes.txt"));
        assert!(!rules.allows("a:b.txt"));
        assert!(!rules.allows("tab\there"));
        assert!(!rules.allows("ends with dot."));
        assert!(!rules.allows("ends with space "));
        assert!(!rules.allows("CON"));
        assert!(!rules.allows("nul.txt"));
        assert!(!rules.allows("Com1.tar.gz"));
        assert!(!rules.allows("lpt\u{b9}"));
        assert!(rules.allows("console.txt"));
        assert!(!rules.allows(&"é".repeat(300)));
        assert!(!rules.allows_path("ok/a|b"));
        assert!(rules.allows_path("ok/fine.txt"));
    }

    #[test]
    fn posix_rules_allow_what_linux_allows() {
        let rules = rules(FsFamily::Posix, false);
        assert!(rules.allows("a:b?.txt"));
        assert!(rules.allows("CON"));
        assert!(!rules.allows(&"a".repeat(256)));
    }

    #[test]
    fn a_case_clash_lists_both_spellings_on_a_folding_volume() {
        let index = index(&["Notes.txt", "notes.txt", "other.txt"]);
        assert_eq!(
            unsupported_names(&index, &rules(FsFamily::Windows, false)),
            vec!["Notes.txt".to_string(), "notes.txt".to_string()]
        );
        assert!(unsupported_names(&index, &rules(FsFamily::Posix, false)).is_empty());
    }

    #[test]
    fn apple_folds_normalization_and_case() {
        let rules = rules(FsFamily::Apple, false);
        let composed = "caf\u{e9}.txt";
        let decomposed = "cafe\u{301}.TXT";
        assert_eq!(rules.fold(composed), rules.fold(decomposed));
        let index = index(&[composed, decomposed]);
        assert_eq!(unsupported_names(&index, &rules).len(), 2);
    }

    #[test]
    fn folders_that_fold_together_clash_even_without_their_own_node() {
        let index = index(&["Docs/a.txt", "docs/b.txt"]);
        assert_eq!(
            unsupported_names(&index, &rules(FsFamily::Windows, false)),
            vec!["Docs".to_string(), "docs".to_string()]
        );
    }

    #[test]
    fn a_bad_folder_is_listed_once() {
        let index = index(&["a:b/one.txt", "a:b/two.txt"]);
        assert_eq!(
            unsupported_names(&index, &rules(FsFamily::Windows, false)),
            vec!["a:b".to_string()]
        );
    }

    #[test]
    fn reserved_paths_are_not_checked() {
        let index = index(&[SEED_LOGICAL_PATH]);
        assert!(unsupported_names(&index, &rules(FsFamily::Windows, true)).is_empty());
    }
}
