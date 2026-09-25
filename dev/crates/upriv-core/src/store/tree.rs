//! Logical tree mutations on a [`VaultIndex`]. Chunk I/O stays in `chunk`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;

use super::chunk::{validate_logical_path, RetiredFileChunks, SEED_LOGICAL_PATH};
use super::index::{VaultIndex, VaultNode};
use crate::error::{Result, UprivError};

/// Hidden from the explorer; still a real logical file in `store/`.
pub const INTERNAL_WORKSPACE_FILE: &str = ".upriv-workspace.json";

/// Windows component limit; matches `@upriv/shared` `LOGICAL_FILE_NAME_MAX_LENGTH`.
pub const LOGICAL_NAME_MAX: usize = 255;

/// Wire DTO matching `@upriv/shared` `FileTreeNode`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileTreeNode {
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
}

/// UI paths are `/notes/a.txt`. Core index paths are `notes/a.txt`. Root is `""` / `"/"`.
pub fn from_ui_path(path: &str) -> Result<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return Ok(String::new());
    }
    let stripped = trimmed.strip_prefix('/').unwrap_or(trimmed);
    validate_logical_path(stripped)?;
    Ok(stripped.to_string())
}

pub fn to_ui_path(path: &str) -> String {
    if path.is_empty() {
        "/".into()
    } else {
        format!("/{path}")
    }
}

pub fn parent_logical(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(parent, _)| parent)
}

pub fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn require_parent_dir(index: &VaultIndex, path: &str) -> Result<()> {
    match parent_logical(path) {
        None => Ok(()),
        Some(parent) => match index.find(parent) {
            Some(node) if node.is_dir() => Ok(()),
            Some(_) => Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(parent),
                detail: "parent is a file".into(),
            }),
            None => Err(UprivError::VaultPathNotFound(parent.into())),
        },
    }
}

fn sibling_names(index: &VaultIndex, parent: &str) -> Vec<String> {
    index
        .nodes
        .iter()
        .filter(|node| parent_logical(&node.path).unwrap_or("") == parent)
        .map(|node| file_name(&node.path).to_string())
        .collect()
}

fn name_taken(index: &VaultIndex, parent: &str, base: &str) -> bool {
    index.nodes.iter().any(|node| {
        parent_logical(&node.path).unwrap_or("") == parent && file_name(&node.path) == base
    })
}

fn unique_with_pattern(existing: &[String], base: &str, folder: bool) -> String {
    if !existing.iter().any(|n| n == base) {
        return base.to_string();
    }
    if folder {
        let mut index = 2;
        loop {
            let candidate = format!("{base} {index}");
            if !existing.iter().any(|n| n == &candidate) {
                return candidate;
            }
            index += 1;
        }
    }
    let (stem, ext) = match base.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (base, String::new()),
    };
    let mut index = 2;
    loop {
        let candidate = format!("{stem}-{index}{ext}");
        if !existing.iter().any(|n| n == &candidate) {
            return candidate;
        }
        index += 1;
    }
}

pub fn unique_file_name(index: &VaultIndex, parent: &str, base: &str) -> String {
    if !name_taken(index, parent, base) {
        return base.to_string();
    }
    unique_with_pattern(&sibling_names(index, parent), base, false)
}

pub fn unique_folder_name(index: &VaultIndex, parent: &str, base: &str) -> String {
    if !name_taken(index, parent, base) {
        return base.to_string();
    }
    unique_with_pattern(&sibling_names(index, parent), base, true)
}

/// `parent/name` after validating the new component (root parent is `""`).
pub fn child_logical_path(parent: &str, name: &str) -> Result<String> {
    validate_component(name)?;
    if parent.is_empty() {
        Ok(name.to_string())
    } else {
        validate_logical_path(parent)?;
        Ok(format!("{parent}/{name}"))
    }
}

fn validate_component(name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(name),
            detail: "empty name".into(),
        });
    }
    if name.len() > LOGICAL_NAME_MAX {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(name),
            detail: "name too long".into(),
        });
    }
    if name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name
            .chars()
            .any(|c| r#"<>:"|?*"#.contains(c) || c.is_control())
    {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(name),
            detail: "invalid name".into(),
        });
    }
    Ok(())
}

pub fn mkdir_logical(index: &mut VaultIndex, logical_path: &str) -> Result<()> {
    validate_logical_path(logical_path)?;
    validate_component(file_name(logical_path))?;
    require_parent_dir(index, logical_path)?;
    if index.find(logical_path).is_some() {
        return Err(UprivError::VaultPathExists(logical_path.into()));
    }
    index.nodes.push(VaultNode::dir(logical_path));
    Ok(())
}

/// Create `parent/name` if missing. Intermediate parents must already exist.
pub fn ensure_folder(index: &mut VaultIndex, parent: &str, name: &str) -> Result<String> {
    validate_component(name)?;
    let path = if parent.is_empty() {
        name.to_string()
    } else {
        validate_logical_path(parent)?;
        format!("{parent}/{name}")
    };
    match index.find(&path) {
        Some(node) if node.is_dir() => Ok(path),
        Some(_) => Err(UprivError::VaultPathExists(path)),
        None => {
            mkdir_logical(index, &path)?;
            Ok(path)
        }
    }
}

fn has_descendant(index: &VaultIndex, path: &str) -> bool {
    let prefix = format!("{path}/");
    index
        .nodes
        .iter()
        .any(|node| node.path.starts_with(&prefix))
}

fn path_occupied(index: &VaultIndex, path: &str) -> bool {
    index.find(path).is_some() || has_descendant(index, path)
}

/// Drop `logical_path` and everything under it from the index. Chunk blobs stay
/// on disk until the caller seals the index and then unlinks them.
pub fn delete_logical_path(
    index: &mut VaultIndex,
    logical_path: &str,
) -> Result<Vec<RetiredFileChunks>> {
    validate_logical_path(logical_path)?;
    if index.find(logical_path).is_none() {
        return Err(UprivError::VaultPathNotFound(logical_path.into()));
    }
    let prefix = format!("{logical_path}/");
    let mut to_remove: Vec<String> = index
        .nodes
        .iter()
        .filter(|node| node.path == logical_path || node.path.starts_with(&prefix))
        .map(|node| node.path.clone())
        .collect();
    to_remove.sort_by_key(|p| std::cmp::Reverse(p.len()));
    let mut retired = Vec::new();
    for path in &to_remove {
        if let Some(node) = index.find(path) {
            if let Some((file_id, _, versions)) = node.as_file() {
                retired.push(RetiredFileChunks {
                    file_id: file_id.to_string(),
                    chunk_count: versions.len() as u32,
                });
            }
        }
    }
    for path in &to_remove {
        index.remove(path);
    }
    Ok(retired)
}

/// Remove an empty directory node. A file, or a directory that still has
/// children, is refused so FUSE `rmdir` can return `ENOTDIR` / `ENOTEMPTY`.
pub fn delete_empty_directory(index: &mut VaultIndex, logical_path: &str) -> Result<()> {
    validate_logical_path(logical_path)?;
    let node = index
        .find(logical_path)
        .ok_or_else(|| UprivError::VaultPathNotFound(logical_path.into()))?;
    if !node.is_dir() {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "not a directory".into(),
        });
    }
    if has_descendant(index, logical_path) {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "directory not empty".into(),
        });
    }
    index.remove(logical_path);
    Ok(())
}

fn remap_prefix(index: &mut VaultIndex, from: &str, to: &str) -> Result<()> {
    if path_occupied(index, to) {
        return Err(UprivError::VaultPathExists(to.into()));
    }
    let prefix = format!("{from}/");
    let now = crate::time::unix_millis();
    for node in &mut index.nodes {
        if node.path == from {
            node.path = to.to_string();
            node.modified_at = now;
        } else if let Some(rest) = node.path.strip_prefix(&prefix) {
            node.path = format!("{to}/{rest}");
            node.modified_at = now;
        }
    }
    Ok(())
}

pub fn rename_logical_path(index: &mut VaultIndex, from: &str, new_name: &str) -> Result<String> {
    let parent = parent_logical(from).unwrap_or("");
    relocate_logical_path(index, from, parent, new_name)
}

pub fn move_logical_path(index: &mut VaultIndex, from: &str, to_folder: &str) -> Result<String> {
    let name = file_name(from).to_string();
    relocate_logical_path(index, from, to_folder, &name)
}

/// Rename and/or reparent in one index mutation (single later `commit`).
pub fn relocate_logical_path(
    index: &mut VaultIndex,
    from: &str,
    to_folder: &str,
    new_name: &str,
) -> Result<String> {
    validate_logical_path(from)?;
    validate_component(new_name)?;
    let from_parent = parent_logical(from).unwrap_or("");
    let moving = to_folder != from_parent;
    if moving && !to_folder.is_empty() {
        validate_logical_path(to_folder)?;
        match index.find(to_folder) {
            Some(node) if node.is_dir() => {}
            Some(_) => {
                return Err(UprivError::VaultStoreInvalid {
                    path: PathBuf::from(to_folder),
                    detail: "destination is a file".into(),
                });
            }
            None => return Err(UprivError::VaultPathNotFound(to_folder.into())),
        }
    } else if !to_folder.is_empty() {
        validate_logical_path(to_folder)?;
    }
    if index.find(from).is_none() {
        return Err(UprivError::VaultPathNotFound(from.into()));
    }
    let to = if to_folder.is_empty() {
        new_name.to_string()
    } else {
        format!("{to_folder}/{new_name}")
    };
    if to == from {
        return Ok(to);
    }
    if to.starts_with(&format!("{from}/")) {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(from),
            detail: "cannot move a folder into itself".into(),
        });
    }
    remap_prefix(index, from, &to)?;
    Ok(to)
}

/// Like [`relocate_logical_path`], but replaces an existing file or empty
/// directory at the destination. A destination that still has children fails
/// with `directory not empty`. Returns chunk blobs the caller unlinks only
/// after the index seal succeeds.
pub fn relocate_replacing(
    index: &mut VaultIndex,
    from: &str,
    to_folder: &str,
    new_name: &str,
) -> Result<(String, Vec<RetiredFileChunks>)> {
    validate_logical_path(from)?;
    validate_component(new_name)?;
    let to = if to_folder.is_empty() {
        new_name.to_string()
    } else {
        format!("{to_folder}/{new_name}")
    };
    if to == from {
        return Ok((to, Vec::new()));
    }
    if has_descendant(index, &to) {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(&to),
            detail: "directory not empty".into(),
        });
    }
    let source_is_dir = index.find(from).is_some_and(|source| source.is_dir());
    let replaced = if let Some(node) = index.find(&to) {
        if node.is_dir() && !source_is_dir {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(&to),
                detail: "destination is a directory".into(),
            });
        }
        if !node.is_dir() && source_is_dir {
            return Err(UprivError::VaultStoreInvalid {
                path: PathBuf::from(&to),
                detail: "destination is a file".into(),
            });
        }
        let chunks = node
            .as_file()
            .map(|(file_id, _, versions)| RetiredFileChunks {
                file_id: file_id.to_string(),
                chunk_count: versions.len() as u32,
            });
        Some(chunks)
    } else {
        None
    };
    if replaced.is_some() {
        index.remove(&to);
    }
    let path = relocate_logical_path(index, from, to_folder, new_name)?;
    let mut retired = Vec::new();
    if let Some(Some(chunks)) = replaced {
        retired.push(chunks);
    }
    Ok((path, retired))
}

pub fn build_file_tree(index: &VaultIndex, root_name: &str) -> FileTreeNode {
    #[derive(Default)]
    struct Acc {
        files: BTreeMap<String, ()>,
        dirs: BTreeMap<String, Acc>,
    }
    let mut root = Acc::default();
    let mut paths: Vec<&VaultNode> = index.nodes.iter().collect();
    paths.sort_by(|a, b| a.path.cmp(&b.path));
    for node in paths {
        if file_name(&node.path) == INTERNAL_WORKSPACE_FILE || node.path == SEED_LOGICAL_PATH {
            continue;
        }
        let mut cur = &mut root;
        let parts: Vec<&str> = node.path.split('/').collect();
        for (i, part) in parts.iter().enumerate() {
            let last = i + 1 == parts.len();
            if last && !node.is_dir() {
                cur.files.insert((*part).to_string(), ());
            } else {
                cur = cur.dirs.entry((*part).to_string()).or_default();
            }
        }
    }
    fn into_node(name: String, acc: Acc) -> FileTreeNode {
        let mut children: Vec<FileTreeNode> = acc
            .dirs
            .into_iter()
            .map(|(name, child)| into_node(name, child))
            .collect();
        for (name, _) in acc.files {
            children.push(FileTreeNode {
                name,
                node_type: "file",
                children: None,
            });
        }
        children.sort_by(|a, b| match (a.node_type, b.node_type) {
            ("folder", "file") => std::cmp::Ordering::Less,
            ("file", "folder") => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        FileTreeNode {
            name,
            node_type: "folder",
            children: Some(children),
        }
    }
    into_node(root_name.to_string(), root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{
        create_empty_store, flush_index, open_store, write_logical_file, KdfUnlockPreset,
    };

    const PW: &[u8] = b"tree-ops-password";

    #[test]
    fn mkdir_rename_move_delete_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        mkdir_logical(&mut opened.index, "docs").unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "docs/a.txt",
            b"hi",
        )
        .unwrap();
        let renamed = rename_logical_path(&mut opened.index, "docs/a.txt", "b.txt").unwrap();
        assert_eq!(renamed, "docs/b.txt");
        mkdir_logical(&mut opened.index, "other").unwrap();
        let moved = move_logical_path(&mut opened.index, "docs/b.txt", "other").unwrap();
        assert_eq!(moved, "other/b.txt");
        mkdir_logical(&mut opened.index, "inbox").unwrap();
        let relocated =
            relocate_logical_path(&mut opened.index, "other/b.txt", "inbox", "c.txt").unwrap();
        assert_eq!(relocated, "inbox/c.txt");
        assert!(opened.index.find("other/b.txt").is_none());
        flush_index(&dir, &opened).unwrap();
        delete_logical_path(&mut opened.index, "docs").unwrap();
        assert!(opened.index.find("docs").is_none());
        assert!(opened.index.find("inbox/c.txt").is_some());
        let tree = build_file_tree(&opened.index, "vault");
        assert_eq!(tree.node_type, "folder");
        let names: Vec<_> = tree
            .children
            .unwrap()
            .iter()
            .map(|c| c.name.clone())
            .collect();
        assert_eq!(names, ["inbox", "other"]);
    }

    #[test]
    fn ui_path_round_trip() {
        assert_eq!(from_ui_path("/").unwrap(), "");
        assert_eq!(from_ui_path("/a/b").unwrap(), "a/b");
        assert_eq!(to_ui_path("a/b"), "/a/b");
        assert!(from_ui_path("..").is_err());
    }

    #[test]
    fn rename_keeps_working_when_parent_dir_node_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(crate::paths::STORE_DIR_NAME);
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "docs/a.txt",
            b"hi",
        )
        .unwrap();
        assert!(opened.index.find("docs").is_none());
        let renamed = rename_logical_path(&mut opened.index, "docs/a.txt", "b.txt").unwrap();
        assert_eq!(renamed, "docs/b.txt");
        assert!(opened.index.find("docs/a.txt").is_none());
        assert!(opened.index.find("docs/b.txt").is_some());
        let missing = move_logical_path(&mut opened.index, "docs/b.txt", "nowhere");
        assert!(missing.is_err());
    }
}
