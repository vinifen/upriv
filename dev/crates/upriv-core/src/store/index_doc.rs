use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IndexDocument {
    pub version: u32,
    pub files: Vec<IndexFileEntry>,
    /// Explicitly created directories (needed for empty folders; implicit dirs come from files).
    #[serde(default)]
    pub dirs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexFileEntry {
    pub path: String,
    pub chunk_id: String,
    pub size: u64,
}

impl IndexDocument {
    pub fn empty() -> Self {
        Self {
            version: 1,
            files: Vec::new(),
            dirs: Vec::new(),
        }
    }

    pub fn find(&self, path: &str) -> Option<&IndexFileEntry> {
        let normalized = normalize_path(path);
        self.files.iter().find(|entry| entry.path == normalized)
    }

    pub fn upsert(&mut self, path: &str, chunk_id: String, size: u64) {
        let normalized = normalize_path(path);
        if let Some(entry) = self.files.iter_mut().find(|entry| entry.path == normalized) {
            entry.chunk_id = chunk_id;
            entry.size = size;
            return;
        }
        self.files.push(IndexFileEntry {
            path: normalized,
            chunk_id,
            size,
        });
    }

    pub fn remove(&mut self, path: &str) -> bool {
        let normalized = normalize_path(path);
        let before = self.files.len();
        self.files.retain(|entry| entry.path != normalized);
        self.files.len() != before
    }

    pub fn list_dir(&self, dir_path: &str) -> Vec<(String, bool)> {
        let dir = normalize_dir(dir_path);
        let mut names = std::collections::BTreeMap::new();
        for entry in &self.files {
            if !entry.path.starts_with(&dir) {
                continue;
            }
            let rest = entry.path.strip_prefix(&dir).unwrap_or(&entry.path);
            if rest.is_empty() {
                continue;
            }
            let segment = rest.split('/').next().unwrap_or(rest);
            if segment.is_empty() {
                continue;
            }
            let is_dir = rest.contains('/') || self.is_subdir(&format!("{dir}{segment}/"));
            names.entry(segment.to_string()).or_insert(is_dir);
        }
        // Include explicitly created (possibly empty) directories at this level.
        for explicit in &self.dirs {
            if let Some(rest) = explicit.strip_prefix(&dir) {
                if rest.is_empty() || rest.contains('/') {
                    continue;
                }
                names.insert(rest.to_string(), true);
            }
        }
        names.into_iter().collect()
    }

    fn is_subdir(&self, prefix: &str) -> bool {
        self.files.iter().any(|entry| entry.path.starts_with(prefix))
            || self.dirs.iter().any(|d| d == prefix.trim_end_matches('/') || d.starts_with(prefix))
    }

    /// True if `path` is a directory (explicit, or implied by a descendant file).
    pub fn dir_exists(&self, path: &str) -> bool {
        let normalized = normalize_path(path);
        if normalized.is_empty() {
            return true;
        }
        let prefix = format!("{normalized}/");
        self.dirs.iter().any(|d| *d == normalized)
            || self.files.iter().any(|entry| entry.path.starts_with(&prefix))
    }

    pub fn add_dir(&mut self, path: &str) {
        let normalized = normalize_path(path);
        if normalized.is_empty() || self.dirs.iter().any(|d| *d == normalized) {
            return;
        }
        self.dirs.push(normalized);
    }

    /// Remove an explicit directory marker. Returns true if a marker was removed.
    pub fn remove_dir(&mut self, path: &str) -> bool {
        let normalized = normalize_path(path);
        let before = self.dirs.len();
        self.dirs.retain(|d| *d != normalized);
        self.dirs.len() != before
    }

    /// True if the directory has no child files or child dirs.
    pub fn dir_is_empty(&self, path: &str) -> bool {
        let normalized = normalize_path(path);
        let prefix = format!("{normalized}/");
        !self.files.iter().any(|entry| entry.path.starts_with(&prefix))
            && !self.dirs.iter().any(|d| d.starts_with(&prefix))
    }

    /// Rename a file or a directory subtree from `from` to `to`.
    pub fn rename_path(&mut self, from: &str, to: &str) {
        let from = normalize_path(from);
        let to = normalize_path(to);
        let from_prefix = format!("{from}/");
        let to_prefix = format!("{to}/");

        for entry in &mut self.files {
            if entry.path == from {
                entry.path = to.clone();
            } else if let Some(rest) = entry.path.strip_prefix(&from_prefix) {
                entry.path = format!("{to_prefix}{rest}");
            }
        }
        for dir in &mut self.dirs {
            if *dir == from {
                *dir = to.clone();
            } else if let Some(rest) = dir.strip_prefix(&from_prefix) {
                *dir = format!("{to_prefix}{rest}");
            }
        }
    }
}

pub fn normalize_path(path: &str) -> String {
    path.trim_start_matches('/')
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn normalize_dir(path: &str) -> String {
    let normalized = normalize_path(path);
    if normalized.is_empty() {
        String::new()
    } else {
        format!("{normalized}/")
    }
}
