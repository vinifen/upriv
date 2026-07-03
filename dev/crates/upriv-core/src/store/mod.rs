mod hash;
mod header;
pub(crate) mod index_doc;

pub use hash::compute_store_hash;
pub use header::{create_header, chunk_path, index_path, VaultHeader};
pub use index_doc::{IndexDocument, IndexFileEntry};

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use rand::RngCore;
use walkdir::WalkDir;

use crate::crypto::{
    decrypt_chunk, decrypt_index, derive_subkeys, encrypt_chunk, encrypt_index, ContentKey,
    IndexKey, MasterKey,
};
use crate::error::{Result, UprivError};
use crate::store::hash::{ensure_store_dirs, index_path as idx_path, reject_demo_store};
use crate::store::index_doc::normalize_path;

pub struct EncryptedStore {
    store_dir: PathBuf,
    content_key: ContentKey,
    index_key: IndexKey,
    index: IndexDocument,
    dirty: bool,
}

impl EncryptedStore {
    pub fn open(store_dir: &Path, password: &str) -> Result<Self> {
        reject_demo_store(store_dir)?;
        let header_path = store_dir.join("vault.header");
        let header = header::VaultHeader::load(&header_path)?;
        let master = header.unlock_master_key(password)?;
        let (content_key, index_key) = derive_subkeys(&master);
        let index = Self::read_index(store_dir, &index_key)?;
        Ok(Self {
            store_dir: store_dir.to_path_buf(),
            content_key,
            index_key,
            index,
            dirty: false,
        })
    }

    pub fn create_new(store_dir: &Path, vault_id: &str, password: &str) -> Result<Self> {
        ensure_store_dirs(store_dir)?;
        let (header, master) = create_header(vault_id, password)?;
        header.save(&store_dir.join("vault.header"))?;
        let (content_key, index_key) = derive_subkeys(&master);
        let store = Self {
            store_dir: store_dir.to_path_buf(),
            content_key,
            index_key,
            index: IndexDocument::empty(),
            dirty: true,
        };
        store.flush_index()?;
        Ok(store)
    }

    pub fn store_dir(&self) -> &Path {
        &self.store_dir
    }

    pub fn file_entries(&self) -> &[IndexFileEntry] {
        &self.index.files
    }

    pub fn read_file(&self, path: &str) -> Result<Vec<u8>> {
        let entry = self
            .index
            .find(path)
            .ok_or_else(|| UprivError::InvalidStore(format!("file not found: {path}")))?;
        let blob = fs::read(header::chunk_path(&self.store_dir, &entry.chunk_id))?;
        let plain = decrypt_chunk(&self.content_key, &blob)?;
        Ok(plain[..entry.size as usize].to_vec())
    }

    pub fn write_file(&mut self, path: &str, data: &[u8]) -> Result<()> {
        let mut chunk_id = [0u8; 4];
        rand::thread_rng().fill_bytes(&mut chunk_id);
        let chunk_id = hex::encode(chunk_id);
        let blob = encrypt_chunk(&self.content_key, data)?;
        let chunk_path = header::chunk_path(&self.store_dir, &chunk_id);
        if let Some(parent) = chunk_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&chunk_path, blob)?;
        self.index
            .upsert(path, chunk_id, data.len() as u64);
        self.dirty = true;
        Ok(())
    }

    pub fn list_dir(&self, dir_path: &str) -> Vec<(String, bool)> {
        self.index.list_dir(dir_path)
    }

    pub fn file_exists(&self, path: &str) -> bool {
        self.index.find(path).is_some()
    }

    pub fn dir_exists(&self, path: &str) -> bool {
        self.index.dir_exists(path)
    }

    pub fn index_dirs(&self) -> Vec<String> {
        self.index.dirs.clone()
    }

    pub fn dir_is_empty(&self, path: &str) -> bool {
        self.index.dir_is_empty(path)
    }

    /// Remove a file and its chunk. Returns true if the file existed.
    pub fn remove_file(&mut self, path: &str) -> Result<bool> {
        let entry = self.index.find(path).cloned();
        let Some(entry) = entry else {
            return Ok(false);
        };
        let chunk = header::chunk_path(&self.store_dir, &entry.chunk_id);
        let _ = fs::remove_file(chunk);
        self.index.remove(path);
        self.dirty = true;
        Ok(true)
    }

    pub fn create_dir(&mut self, path: &str) {
        self.index.add_dir(path);
        self.dirty = true;
    }

    /// Remove an empty directory. Returns false if the directory is not empty.
    pub fn remove_dir(&mut self, path: &str) -> bool {
        if !self.index.dir_is_empty(path) {
            return false;
        }
        self.index.remove_dir(path);
        self.dirty = true;
        true
    }

    /// Rename a file or directory subtree. Chunks are untouched (only paths change).
    pub fn rename(&mut self, from: &str, to: &str) {
        self.index.rename_path(from, to);
        self.dirty = true;
    }

    pub fn flush_index(&self) -> Result<()> {
        let raw = serde_json::to_vec(&self.index)?;
        let encrypted = encrypt_index(&self.index_key, &raw)?;
        let path = idx_path(&self.store_dir);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, encrypted)?;
        Ok(())
    }

    pub fn flush(&mut self) -> Result<()> {
        if self.dirty {
            self.flush_index()?;
            self.dirty = false;
        }
        Ok(())
    }

    pub fn export_logical_tree(&self, dest: &Path) -> Result<()> {
        for entry in &self.index.files.clone() {
            let data = self.read_file(&entry.path)?;
            let out = dest.join(&entry.path);
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(out, data)?;
        }
        // Materialize explicitly-created (possibly empty) directories so they survive archiving.
        for dir in &self.index.dirs {
            fs::create_dir_all(dest.join(dir))?;
        }
        Ok(())
    }

    /// Replace store contents from a plaintext directory tree (dev plaintext workspace sync).
    pub fn import_logical_tree(&mut self, source: &Path) -> Result<()> {
        let mut imported = HashSet::new();
        let mut imported_dirs = HashSet::new();
        for entry in WalkDir::new(source).min_depth(1).into_iter().filter_map(|e| e.ok()) {
            let rel = entry
                .path()
                .strip_prefix(source)
                .map_err(|err| UprivError::Io(std::io::Error::new(std::io::ErrorKind::InvalidInput, err)))?
                .to_string_lossy()
                .replace('\\', "/");
            if entry.file_type().is_dir() {
                imported_dirs.insert(normalize_path(&rel));
                continue;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let data = fs::read(entry.path())?;
            self.write_file(&rel, &data)?;
            imported.insert(normalize_path(&rel));
        }

        for entry in self.index.files.clone() {
            if !imported.contains(&entry.path) {
                self.index.remove(&entry.path);
                self.dirty = true;
            }
        }

        // Reconcile explicit dir markers: keep only those still empty on disk.
        self.index.dirs.clear();
        for dir in imported_dirs {
            if self.index.dir_is_empty(&dir) {
                self.index.add_dir(&dir);
            }
        }
        self.dirty = true;
        Ok(())
    }

    fn read_index(store_dir: &Path, index_key: &IndexKey) -> Result<IndexDocument> {
        let path = idx_path(store_dir);
        if !path.is_file() {
            return Ok(IndexDocument::empty());
        }
        let bytes = fs::read(&path)?;
        if header::is_demo_blob(&bytes) {
            return Err(UprivError::InvalidStore(
                "demo placeholder index (ENCv1:)".into(),
            ));
        }
        let plain = decrypt_index(index_key, &bytes)?;
        Ok(serde_json::from_slice(&plain)?)
    }
}

pub fn seed_initial_file(store: &mut EncryptedStore, path: &str, contents: &[u8]) -> Result<()> {
    store.write_file(path, contents)?;
    store.flush()
}

// tiny hex helper without adding crate — use format!
mod hex {
    pub fn encode(bytes: [u8; 4]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
