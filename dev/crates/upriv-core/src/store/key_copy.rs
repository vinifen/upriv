//! Every blob's key copy: the first 4096 bytes of `store/data/<hh>/<id>.blob`,
//! a copy of the header block it was written under.
//!
//! ```text
//! 0     magic "UPRK"                                        4
//! 4     content identity                                   16
//! 20    file id                                            16
//! 36    memory_kib, time_cost, parallelism (u32 LE each)   12
//! 48    salt                                               16
//! 64    generation (u32 LE)                                 4
//! 68    key count n (u32 LE, 1..=8)                         4
//! 72    wrap nonce                                         24
//! 96    wrap ciphertext and tag            8 + 36·n + 16  (at most 312)
//! …     zeros up to 4096
//! ```
//!
//! Bytes 72 onward are the header block's `wrapped_keys_b64`, byte for byte.
//! With bytes 4 to 63 they rebuild the wrap AAD (the cipher names and the
//! chunk size are fixed by the format), so the password opens a key copy
//! exactly as it opens that block, and a blob whose header is lost still opens
//! ([`super::keys::Keyring::open_unlisted`]). Writing one needs no password:
//! it is copied from the block. The file id is there so a blob whose name was
//! lost still opens; the chunk and record AADs authenticate it, so a wrong id
//! opens nothing. The key ids and `since` are inside the wrap.
//!
//! The block fills a storage page of its own: a write of it cut short on flash
//! storage spoils only the key copy, which the header restores, never the
//! start of the file's first chunk. Chunks start at [`KEY_COPY_LEN`].
//!
//! A key copy is **good** when its generation equals the header's top block:
//! then it is that block, byte for byte. Only a failed unlock, the pass that
//! makes key copies good again, the rebuild, and a recovery tool read one; an
//! open, a read, a write, or an export of a vault that opens never does.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use uuid::Uuid;

use super::header::{HeaderKdf, KDF_ALG};
use super::kdf::{Kek, SALT_LEN};
use super::keys::{wrapped_len, Keyring, MAX_KEYS};
use crate::error::Result;

/// Bytes of the key copy at the start of every blob; its first chunk starts
/// here.
pub const KEY_COPY_LEN: u64 = 4096;
/// Bytes of a key copy before its wrap: all a failed unlock reads of a blob.
pub(crate) const KEY_COPY_PREFIX_LEN: usize = 72;
const MAGIC: [u8; 4] = *b"UPRK";

/// What a key copy says before its wrap, readable with no password.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyCopyPrefix {
    pub identity: Uuid,
    pub file_id: Uuid,
    pub kdf: HeaderKdf,
    pub generation: u32,
    /// How many keys the wrap holds.
    pub keys: usize,
}

/// A whole key copy as read from a blob.
#[derive(Debug, Clone)]
pub(crate) struct KeyCopy {
    pub prefix: KeyCopyPrefix,
    wrapped: Vec<u8>,
}

impl KeyCopy {
    /// Open the keyring this key copy holds with `kek`, derived from the
    /// password under [`KeyCopyPrefix::kdf`].
    pub(crate) fn open(&self, kek: &Kek) -> Result<Keyring> {
        Keyring::open_unlisted(
            self.prefix.identity,
            self.prefix.generation,
            self.prefix.kdf.clone(),
            &self.wrapped,
            kek,
        )
    }
}

/// The key copy of the blob of `file_id`, from the block `keys` came from.
pub(crate) fn encode(keys: &Keyring, file_id: Uuid) -> Result<Box<[u8; KEY_COPY_LEN as usize]>> {
    let block = keys.block();
    let wrapped = block.wrapped()?;
    let salt = block.kdf.salt().unwrap_or([0u8; SALT_LEN]);
    let mut out = Box::new([0u8; KEY_COPY_LEN as usize]);
    out[0..4].copy_from_slice(&MAGIC);
    out[4..20].copy_from_slice(keys.identity().as_bytes());
    out[20..36].copy_from_slice(file_id.as_bytes());
    out[36..40].copy_from_slice(&block.kdf.memory_kib.to_le_bytes());
    out[40..44].copy_from_slice(&block.kdf.time_cost.to_le_bytes());
    out[44..48].copy_from_slice(&block.kdf.parallelism.to_le_bytes());
    out[48..64].copy_from_slice(&salt);
    out[64..68].copy_from_slice(&block.generation.to_le_bytes());
    out[68..72].copy_from_slice(&(block.key_ids.len() as u32).to_le_bytes());
    out[KEY_COPY_PREFIX_LEN..KEY_COPY_PREFIX_LEN + wrapped.len()].copy_from_slice(&wrapped);
    Ok(out)
}

/// Write the key copy of the blob of `file_id` over its first
/// [`KEY_COPY_LEN`] bytes. The caller flushes the blob.
pub(crate) fn write_key_copy(
    file: &mut crate::host_fs::File,
    keys: &Keyring,
    file_id: Uuid,
) -> Result<()> {
    let bytes = encode(keys, file_id)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(bytes.as_slice())?;
    Ok(())
}

/// Read the first [`KEY_COPY_PREFIX_LEN`] bytes as a key copy's prefix:
/// `None` when they are not one (no magic, settings out of bounds, no keys).
pub(crate) fn decode_prefix(bytes: &[u8; KEY_COPY_PREFIX_LEN]) -> Option<KeyCopyPrefix> {
    if bytes[0..4] != MAGIC {
        return None;
    }
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("four bytes"));
    let keys = word(68) as usize;
    if !(1..=MAX_KEYS).contains(&keys) {
        return None;
    }
    let kdf = HeaderKdf {
        alg: KDF_ALG.to_string(),
        memory_kib: word(36),
        time_cost: word(40),
        parallelism: word(44),
        salt_b64: B64.encode(&bytes[48..64]),
    };
    if !super::kdf::kdf_params_in_bounds(kdf.memory_kib, kdf.time_cost, kdf.parallelism) {
        return None;
    }
    Some(KeyCopyPrefix {
        identity: Uuid::from_slice(&bytes[4..20]).ok()?,
        file_id: Uuid::from_slice(&bytes[20..36]).ok()?,
        kdf,
        generation: word(64),
        keys,
    })
}

/// The prefix of the key copy of the blob at `path`, when it holds one.
pub(crate) fn read_prefix(path: &Path) -> Option<KeyCopyPrefix> {
    let mut file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read).ok()?;
    let mut bytes = [0u8; KEY_COPY_PREFIX_LEN];
    file.read_exact(&mut bytes).ok()?;
    decode_prefix(&bytes)
}

/// The whole key copy of the blob at `path`, when it holds one.
pub(crate) fn read_key_copy(path: &Path) -> Option<KeyCopy> {
    let mut file = crate::paths::open_nofollow(path, crate::paths::NofollowMode::Read).ok()?;
    let mut bytes = [0u8; KEY_COPY_PREFIX_LEN];
    file.read_exact(&mut bytes).ok()?;
    let prefix = decode_prefix(&bytes)?;
    let mut wrapped = vec![0u8; wrapped_len(prefix.keys)];
    file.read_exact(&mut wrapped).ok()?;
    Some(KeyCopy { prefix, wrapped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::header::HeaderKdf;
    use crate::store::keys::KeyId;
    use crate::store::KdfUnlockPreset;
    use zeroize::Zeroizing;

    fn keyring() -> (Keyring, Kek) {
        let kdf = HeaderKdf::fresh(KdfUnlockPreset::M32);
        let kek = Zeroizing::new([3u8; 32]);
        (Keyring::create(Uuid::new_v4(), kdf, &kek).unwrap(), kek)
    }

    #[test]
    fn a_key_copy_is_its_block_byte_for_byte_after_the_prefix() {
        let (keys, _) = keyring();
        let file_id = Uuid::new_v4();
        let bytes = encode(&keys, file_id).unwrap();
        assert_eq!(bytes.len(), 4096);
        assert_eq!(&bytes[0..4], b"UPRK");
        assert_eq!(&bytes[4..20], keys.identity().as_bytes());
        assert_eq!(&bytes[20..36], file_id.as_bytes());
        let block = keys.block();
        assert_eq!(
            &bytes[36..48],
            [
                block.kdf.memory_kib.to_le_bytes(),
                block.kdf.time_cost.to_le_bytes(),
                block.kdf.parallelism.to_le_bytes(),
            ]
            .concat()
            .as_slice()
        );
        assert_eq!(&bytes[48..64], block.kdf.salt().unwrap().as_slice());
        assert_eq!(&bytes[64..68], 1u32.to_le_bytes().as_slice());
        assert_eq!(&bytes[68..72], 1u32.to_le_bytes().as_slice());
        let wrapped = block.wrapped().unwrap();
        assert_eq!(&bytes[72..72 + wrapped.len()], wrapped.as_slice());
        assert!(bytes[72 + wrapped.len()..].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn a_key_copy_opens_with_the_password_as_its_block_does() {
        let (keys, kek) = keyring();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("a.blob");
        let file_id = Uuid::new_v4();
        crate::host_fs::write(&path, encode(&keys, file_id).unwrap().as_slice()).unwrap();

        let prefix = read_prefix(&path).unwrap();
        assert_eq!(prefix.identity, keys.identity());
        assert_eq!(prefix.file_id, file_id);
        assert_eq!(prefix.generation, 1);
        assert_eq!(prefix.kdf, keys.block().kdf);

        let copy = read_key_copy(&path).unwrap();
        let opened = copy.open(&kek).unwrap();
        assert_eq!(opened.write_id(), KeyId::new(1));
        assert_eq!(opened.write_content(), keys.write_content());
        assert_eq!(opened.block(), keys.block());
        assert!(copy.open(&Zeroizing::new([4u8; 32])).is_err());
    }

    #[test]
    fn bytes_that_are_no_key_copy_have_no_prefix() {
        let (keys, _) = keyring();
        let good = encode(&keys, Uuid::new_v4()).unwrap();
        let prefix = |edit: &dyn Fn(&mut [u8; KEY_COPY_PREFIX_LEN])| {
            let mut bytes: [u8; KEY_COPY_PREFIX_LEN] =
                good[..KEY_COPY_PREFIX_LEN].try_into().unwrap();
            edit(&mut bytes);
            decode_prefix(&bytes)
        };
        assert!(prefix(&|_| {}).is_some());
        assert!(prefix(&|bytes| bytes[0] = b'X').is_none());
        assert!(prefix(&|bytes| bytes[68..72].copy_from_slice(&0u32.to_le_bytes())).is_none());
        assert!(prefix(&|bytes| bytes[68..72].copy_from_slice(&9u32.to_le_bytes())).is_none());
        assert!(prefix(&|bytes| bytes[36..40].copy_from_slice(&1u32.to_le_bytes())).is_none());
    }
}
