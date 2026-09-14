//! Logical files as XChaCha20-Poly1305 chunks under `contents/data/`.
//!
//! On-disk names are opaque `file_id`s. Logical paths live only in the sealed index.

use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::aead::{decrypt_xchacha, encrypt_xchacha, CONTENT_KEY_LEN};
use super::header::{chunk_aad, VaultHeader};
use super::index::{VaultIndex, VaultIndexEntry, DATA_DIR_NAME};
use crate::error::{Result, UprivError};
use crate::paths;

pub const CHUNK_FILE_SUFFIX: &str = ".chunk.enc";

pub const SEED_LOGICAL_PATH: &str = "upriv-seed.txt";

pub fn seed_plaintext(content_identity: Uuid) -> Vec<u8> {
    format!(
        "Upriv seed v1\ncontent_identity={content_identity}\nThis file is written at vault create to prove chunk AEAD round-trip.\nIt is not a secret.\n"
    )
    .into_bytes()
}

pub fn chunk_file_path(
    contents_dir: impl AsRef<Path>,
    file_id: &str,
    chunk_index: u32,
) -> Result<PathBuf> {
    let parsed = Uuid::parse_str(file_id).map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from(DATA_DIR_NAME),
        detail: "file_id is not a UUID".into(),
    })?;
    Ok(contents_dir
        .as_ref()
        .join(DATA_DIR_NAME)
        .join(format!("{parsed}.{chunk_index}{CHUNK_FILE_SUFFIX}")))
}

pub fn chunk_count(file_size: u64, chunk_size: u32) -> u32 {
    if file_size == 0 {
        return 0;
    }
    let size = u64::from(chunk_size.max(1));
    file_size.div_ceil(size) as u32
}

pub fn chunk_plain_len(file_size: u64, chunk_index: u32, chunk_size: u32) -> u32 {
    let start = u64::from(chunk_index) * u64::from(chunk_size);
    if start >= file_size {
        return 0;
    }
    (file_size - start).min(u64::from(chunk_size)) as u32
}

fn validate_logical_path(path: &str) -> Result<()> {
    let invalid = path.is_empty()
        || path.starts_with('/')
        || path.contains('\0')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..");
    if invalid {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(path),
            detail: "invalid logical path".into(),
        });
    }
    Ok(())
}

fn remove_file_chunks(
    contents_dir: &Path,
    file_id: &str,
    file_size: u64,
    chunk_size: u32,
) -> Result<()> {
    let count = chunk_count(file_size, chunk_size);
    for index in 0..count {
        let path = chunk_file_path(contents_dir, file_id, index)?;
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Encrypt `plaintext` into `contents/data/` and record it in `index` (caller seals the index).
pub fn write_logical_file(
    contents_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &mut VaultIndex,
    logical_path: &str,
    plaintext: &[u8],
) -> Result<()> {
    validate_logical_path(logical_path)?;
    let contents_dir = contents_dir.as_ref();
    let chunk_size = header.chunk_size;
    if chunk_size == 0 {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(DATA_DIR_NAME),
            detail: "chunk_size is zero".into(),
        });
    }
    if let Some(existing) = index
        .entries
        .iter()
        .find(|entry| entry.path == logical_path)
        .cloned()
    {
        remove_file_chunks(contents_dir, &existing.file_id, existing.size, chunk_size)?;
        index.entries.retain(|entry| entry.path != logical_path);
    }

    let file_id = Uuid::new_v4().to_string();
    let file_size = plaintext.len() as u64;
    let data_dir = contents_dir.join(DATA_DIR_NAME);
    std::fs::create_dir_all(&data_dir)?;

    let chunk_size_usize = chunk_size as usize;
    for (chunk_index, slice) in plaintext.chunks(chunk_size_usize).enumerate() {
        let chunk_index = chunk_index as u32;
        let aad = chunk_aad(header, &file_id, chunk_index, file_size, slice.len() as u32)?;
        let blob = encrypt_xchacha(content_key, slice, &aad)?;
        let path = chunk_file_path(contents_dir, &file_id, chunk_index)?;
        paths::write_bytes_atomic(&path, &blob)?;
    }

    index.entries.push(VaultIndexEntry {
        file_id,
        path: logical_path.to_string(),
        size: file_size,
    });
    Ok(())
}

/// Decrypt one logical file into RAM. Tag / AAD failure returns no plaintext.
pub fn read_logical_file(
    contents_dir: impl AsRef<Path>,
    header: &VaultHeader,
    content_key: &[u8; CONTENT_KEY_LEN],
    index: &VaultIndex,
    logical_path: &str,
) -> Result<Vec<u8>> {
    let contents_dir = contents_dir.as_ref();
    let entry = index
        .entries
        .iter()
        .find(|entry| entry.path == logical_path)
        .ok_or_else(|| UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "logical path not in index".into(),
        })?;
    let _ = Uuid::parse_str(&entry.file_id).map_err(|_| UprivError::VaultStoreInvalid {
        path: PathBuf::from(DATA_DIR_NAME),
        detail: "file_id is not a UUID".into(),
    })?;
    let chunk_size = header.chunk_size;
    let count = chunk_count(entry.size, chunk_size);
    let mut out = Vec::with_capacity(entry.size as usize);
    for chunk_index in 0..count {
        let expected_len = chunk_plain_len(entry.size, chunk_index, chunk_size);
        let path = chunk_file_path(contents_dir, &entry.file_id, chunk_index)?;
        let blob = std::fs::read(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                UprivError::VaultStoreInvalid {
                    path: path.clone(),
                    detail: "missing chunk".into(),
                }
            } else {
                error.into()
            }
        })?;
        let aad = chunk_aad(
            header,
            &entry.file_id,
            chunk_index,
            entry.size,
            expected_len,
        )?;
        let plain = match decrypt_xchacha(content_key, &blob, &aad) {
            Ok(plain) => plain,
            Err(UprivError::WrongPassword) => {
                return Err(UprivError::VaultStoreInvalid {
                    path,
                    detail: "chunk tag failed".into(),
                });
            }
            Err(error) => return Err(error),
        };
        if plain.len() != expected_len as usize {
            return Err(UprivError::VaultStoreInvalid {
                path,
                detail: "chunk length mismatch".into(),
            });
        }
        out.extend_from_slice(&plain);
    }
    if out.len() as u64 != entry.size {
        return Err(UprivError::VaultStoreInvalid {
            path: PathBuf::from(logical_path),
            detail: "reassembled file size mismatch".into(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contents::{
        create_empty_store, flush_index, open_store, KdfUnlockPreset, CHUNK_SIZE,
    };

    const PW: &[u8] = b"chunk-round-trip-ok";

    fn seeded_two_chunk() -> (tempfile::TempDir, std::path::PathBuf, Vec<u8>, String) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        let mut data = vec![0u8; CHUNK_SIZE as usize + 13];
        for (i, byte) in data.iter_mut().enumerate() {
            *byte = (i % 251) as u8;
        }
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "wide.bin",
            &data,
        )
        .unwrap();
        flush_index(&dir, &opened).unwrap();
        let file_id = opened.index.entries[0].file_id.clone();
        (tmp, dir, data, file_id)
    }

    #[test]
    fn empty_file_has_no_chunk_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("contents");
        create_empty_store(&dir, PW, KdfUnlockPreset::M32).unwrap();
        let mut opened = open_store(&dir, PW).unwrap();
        write_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &mut opened.index,
            "empty.txt",
            b"",
        )
        .unwrap();
        flush_index(&dir, &opened).unwrap();
        let data = dir.join(DATA_DIR_NAME);
        assert_eq!(std::fs::read_dir(&data).unwrap().count(), 0);
        let got = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "empty.txt",
        )
        .unwrap();
        assert!(got.is_empty());
    }

    #[test]
    fn two_chunks_round_trip_and_unique_nonces() {
        let (_tmp, dir, data, file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let got = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "wide.bin",
        )
        .unwrap();
        assert_eq!(got, data);
        let a = std::fs::read(chunk_file_path(&dir, &file_id, 0).unwrap()).unwrap();
        let b = std::fs::read(chunk_file_path(&dir, &file_id, 1).unwrap()).unwrap();
        assert_ne!(
            &a[..24],
            &b[..24],
            "each chunk must have its own CSPRNG nonce"
        );
        assert!(
            !std::fs::read(dir.join("index/root.idx.enc"))
                .unwrap()
                .windows(b"wide.bin".len())
                .any(|w| w == b"wide.bin"),
            "logical name must not appear in the sealed index blob"
        );
    }

    #[test]
    fn swap_chunks_fails_closed() {
        let (_tmp, dir, _data, file_id) = seeded_two_chunk();
        let p0 = chunk_file_path(&dir, &file_id, 0).unwrap();
        let p1 = chunk_file_path(&dir, &file_id, 1).unwrap();
        let tmp = dir.join("data").join("swap.tmp");
        std::fs::rename(&p0, &tmp).unwrap();
        std::fs::rename(&p1, &p0).unwrap();
        std::fs::rename(&tmp, &p1).unwrap();
        let opened = open_store(&dir, PW).expect("vault still opens; one file is torn");
        let err = read_logical_file(
            &dir,
            &opened.header,
            &opened.content_key,
            &opened.index,
            "wide.bin",
        )
        .unwrap_err();
        assert!(
            matches!(err, UprivError::VaultStoreInvalid { .. }),
            "swapped chunk_index AAD must fail: {err:?}"
        );
    }

    #[test]
    fn flip_or_truncate_chunk_fails_closed() {
        let (_tmp, dir, _data, file_id) = seeded_two_chunk();
        let path = chunk_file_path(&dir, &file_id, 0).unwrap();
        let mut raw = std::fs::read(&path).unwrap();
        raw[24] ^= 0x01;
        std::fs::write(&path, &raw).unwrap();
        let opened = open_store(&dir, PW).unwrap();
        assert!(matches!(
            read_logical_file(
                &dir,
                &opened.header,
                &opened.content_key,
                &opened.index,
                "wide.bin",
            ),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
        raw[24] ^= 0x01;
        raw.truncate(raw.len() - 4);
        std::fs::write(&path, &raw).unwrap();
        assert!(matches!(
            read_logical_file(
                &dir,
                &opened.header,
                &opened.content_key,
                &opened.index,
                "wide.bin",
            ),
            Err(UprivError::VaultStoreInvalid { .. })
        ));
    }

    #[test]
    fn chunk_rejects_wrap_aad() {
        use super::super::aead::decrypt_xchacha;
        use super::super::header::chunk_aad;

        let (_tmp, dir, _data, file_id) = seeded_two_chunk();
        let opened = open_store(&dir, PW).unwrap();
        let blob = std::fs::read(chunk_file_path(&dir, &file_id, 0).unwrap()).unwrap();
        let wrap = opened.header.wrap_aad().unwrap();
        assert!(decrypt_xchacha(&opened.content_key, &blob, &wrap).is_err());
        let aad = chunk_aad(
            &opened.header,
            &file_id,
            0,
            opened.index.entries[0].size,
            CHUNK_SIZE,
        )
        .unwrap();
        decrypt_xchacha(&opened.content_key, &blob, &aad).expect("correct chunk AAD");
    }
}
