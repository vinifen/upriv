//! Welcome `README.md` for a new vault (scratch create or an import of
//! ordinary files). A Upriv store `.zip` or a backup copy never gets one.
//!
//! The app renders both files in the UI language; core only seals them.

use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::store::INTERNAL_WORKSPACE_FILE;

use super::fs::{fs_list_tree, fs_seal_staged_imports, fs_write_file};

/// Logical path of the welcome note at the vault root.
pub const WELCOME_README_LOGICAL_PATH: &str = "README.md";

/// Cap per welcome file — both are short UI-generated text.
pub const WELCOME_FILE_MAX_BYTES: usize = 64 * 1024;

/// Localized `README.md` + the file manager layout that opens it in Read view.
#[derive(Debug, Clone, Copy)]
pub struct VaultWelcome<'a> {
    pub readme: &'a str,
    pub workspace: &'a str,
}

impl<'a> VaultWelcome<'a> {
    /// `(logical_path, bytes)` pairs, refused when either is over the cap.
    pub(crate) fn files(self) -> Result<[(&'a str, &'a [u8]); 2]> {
        let files = [
            (WELCOME_README_LOGICAL_PATH, self.readme.as_bytes()),
            (INTERNAL_WORKSPACE_FILE, self.workspace.as_bytes()),
        ];
        for (path, bytes) in files {
            if bytes.len() > WELCOME_FILE_MAX_BYTES {
                return Err(UprivError::VaultFileTooLarge {
                    path: path.into(),
                    size: bytes.len() as u64,
                    max: WELCOME_FILE_MAX_BYTES as u64,
                });
            }
        }
        Ok(files)
    }
}

/// After an import streamed its files into the open session: write the welcome
/// note and its layout unless the root already has a `README.md` (any case).
/// An exported vault that is imported again keeps its one README.
pub(crate) fn seal_welcome_if_absent(
    root: &VaultRoot,
    vault_id: &str,
    welcome: VaultWelcome<'_>,
) -> Result<bool> {
    let files = welcome.files()?;
    fs_seal_staged_imports(root, vault_id)?;
    let tree = fs_list_tree(root, vault_id)?;
    let has_readme = tree
        .children
        .iter()
        .flatten()
        .any(|child| child.name.eq_ignore_ascii_case(WELCOME_README_LOGICAL_PATH));
    if has_readme {
        return Ok(false);
    }
    for (logical_path, bytes) in files {
        fs_write_file(root, vault_id, &format!("/{logical_path}"), bytes)?;
    }
    Ok(true)
}
