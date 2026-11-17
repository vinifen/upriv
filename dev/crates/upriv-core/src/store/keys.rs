//! The keys of one header block: a keyring.
//!
//! A vault's chunks, index, and recovery records are sealed with keys of a
//! keyring. Each key is 32 random bytes with an id: the generation of the
//! header write that first held it ([`super::header::HeaderBlock`]), so ids
//! only grow and are never reused. Key id 0 is never a key; in the index it
//! marks a chunk that has no key. The keys are listed in id order, so the
//! last one, the write key, is always the newest: new data is sealed with it.
//! Each key gives its own content, index, and record keys
//! ([`super::aead::derive_layer_keys`]).
//!
//! A header block locks a keyring under a KEK the password derives
//! ([`super::kdf::derive_kek`]). The wrap opens to
//!
//! ```text
//! generation u32 LE | since u32 LE | (id u32 LE | key 32 bytes)*
//! ```
//!
//! and its AAD is [`super::header::wrap_aad`] of the block's own unlock
//! settings. The block repeats the generation, the key ids, and `since` in
//! the clear, so code with no password can compare two blocks; the unwrap
//! checks that they match what the wrap holds.
//!
//! A keyring keeps the sealed block it came from: every blob's key copy is
//! that block ([`super::key_copy`]), and the index is sealed under the pair of
//! that block (the write key's index key and the block's AAD).

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::aead::{
    decrypt_xchacha, derive_layer_keys, encrypt_xchacha, random_key, LayerKeys, CONTENT_KEY_LEN,
    INDEX_KEY_LEN, KEY_LEN, RECORD_KEY_LEN, XCHACHA_NONCE_LEN, XCHACHA_TAG_LEN,
};
use super::header::{wrap_aad, HeaderBlock, HeaderKdf};
use super::kdf::Kek;
use crate::error::{Result, UprivError};

/// Most keys one header block holds. A steady vault holds one; each stopped
/// password change adds up to two until a change finishes.
pub const MAX_KEYS: usize = 8;

/// Bytes of the wrap's plaintext before its keys: generation and `since`.
const PLAIN_HEAD_LEN: usize = 8;
/// Bytes of one key in the wrap's plaintext: its id and the key.
const PLAIN_KEY_LEN: usize = 4 + KEY_LEN;

/// Bytes of a block's sealed keyring holding `keys` keys.
pub(crate) fn wrapped_len(keys: usize) -> usize {
    XCHACHA_NONCE_LEN + PLAIN_HEAD_LEN + PLAIN_KEY_LEN * keys + XCHACHA_TAG_LEN
}

/// The id of a key of a keyring: the generation of the header write that
/// first held it. [`KeyId::NONE`] is never a key.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct KeyId(u32);

impl KeyId {
    /// No key: in the index, a chunk whose key left the vault.
    pub const NONE: Self = Self(0);

    pub const fn new(id: u32) -> Self {
        Self(id)
    }

    pub const fn get(self) -> u32 {
        self.0
    }

    pub const fn is_none(self) -> bool {
        self.0 == 0
    }
}

impl std::fmt::Display for KeyId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// One key of a keyring, with its layer keys.
#[derive(Clone)]
struct RingKey {
    id: KeyId,
    key: Zeroizing<[u8; KEY_LEN]>,
    layers: LayerKeys,
}

impl RingKey {
    fn new(id: KeyId, key: Zeroizing<[u8; KEY_LEN]>) -> Result<Self> {
        let layers = derive_layer_keys(&key)?;
        Ok(Self { id, key, layers })
    }
}

/// The keys of one header block, and that block. Every key is wiped when the
/// keyring drops. Keys never leave `upriv-core`.
#[derive(Clone)]
pub struct Keyring {
    /// The vault these keys belong to: its content identity.
    identity: Uuid,
    /// In id order; never empty. The last is the write key.
    keys: Vec<RingKey>,
    since: KeyId,
    /// The sealed block these keys came from.
    block: HeaderBlock,
}

impl std::fmt::Debug for Keyring {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keyring")
            .field("identity", &self.identity)
            .field("ids", &self.block.key_ids)
            .field("since", &self.since)
            .field("generation", &self.block.generation)
            .finish()
    }
}

impl Keyring {
    /// The keyring of a new vault: one fresh key, id 1, in a block of
    /// generation 1 sealed under `kek`, which `kdf` derives.
    pub(crate) fn create(identity: Uuid, kdf: HeaderKdf, kek: &Kek) -> Result<Self> {
        KeyringDraft {
            identity,
            keys: vec![RingKey::new(KeyId::new(1), random_key())?],
            since: KeyId::new(1),
        }
        .seal(1, kdf, kek)
    }

    /// Open `block` of the vault `identity` with `kek`. Fails with
    /// [`UprivError::WrongPassword`] when the tag does not check out, and
    /// refuses a wrap whose keys do not match what the block says in the clear.
    pub(crate) fn open(identity: Uuid, block: &HeaderBlock, kek: &Kek) -> Result<Self> {
        let (generation, since, keys) = unwrap_keys(identity, &block.kdf, &block.wrapped()?, kek)?;
        let ids: Vec<KeyId> = keys.iter().map(|key| key.id).collect();
        if generation != block.generation || since != block.since || ids != block.key_ids {
            return Err(block_mismatch());
        }
        Ok(Self {
            identity,
            keys,
            since,
            block: block.clone(),
        })
    }

    /// Open a block that names its generation and unlock settings but not its
    /// keys, as a blob's key copy does ([`super::key_copy`]): the keys and
    /// `since` come from the wrap, and the generation must match it.
    pub(crate) fn open_unlisted(
        identity: Uuid,
        generation: u32,
        kdf: HeaderKdf,
        wrapped: &[u8],
        kek: &Kek,
    ) -> Result<Self> {
        let (sealed_generation, since, keys) = unwrap_keys(identity, &kdf, wrapped, kek)?;
        if sealed_generation != generation {
            return Err(block_mismatch());
        }
        let block = HeaderBlock {
            generation,
            kdf,
            key_ids: keys.iter().map(|key| key.id).collect(),
            since,
            wrapped_keys_b64: B64.encode(wrapped),
        };
        Ok(Self {
            identity,
            keys,
            since,
            block,
        })
    }

    /// A draft that starts as this keyring's keys and `since`, for a header
    /// write that changes them ([`KeyringDraft::seal`]).
    pub(crate) fn draft(&self) -> KeyringDraft {
        KeyringDraft {
            identity: self.identity,
            keys: self.keys.clone(),
            since: self.since,
        }
    }

    /// The vault's content identity.
    pub fn identity(&self) -> Uuid {
        self.identity
    }

    /// The sealed block these keys came from.
    pub fn block(&self) -> &HeaderBlock {
        &self.block
    }

    pub fn since(&self) -> KeyId {
        self.since
    }

    /// The key new data is sealed with: the newest.
    pub fn write_id(&self) -> KeyId {
        self.write().id
    }

    /// Every key id, oldest first.
    pub fn ids(&self) -> impl Iterator<Item = KeyId> + '_ {
        self.keys.iter().map(|key| key.id)
    }

    pub fn contains(&self, id: KeyId) -> bool {
        self.find(id).is_some()
    }

    /// True while a key below `since` is here: the files on it wait for a
    /// password change to convert them ([`super::header::HeaderBlock`]).
    pub fn holds_key_below_since(&self) -> bool {
        self.keys.iter().any(|key| key.id < self.since)
    }

    /// The content key of `id`; `None` for [`KeyId::NONE`] or a key this
    /// keyring does not hold.
    pub(crate) fn content(&self, id: KeyId) -> Option<&[u8; CONTENT_KEY_LEN]> {
        self.find(id).map(|key| &*key.layers.content)
    }

    pub(crate) fn write_content(&self) -> &[u8; CONTENT_KEY_LEN] {
        &self.write().layers.content
    }

    /// The index key of `id`, when this keyring holds it.
    pub(crate) fn index_key(&self, id: KeyId) -> Option<&[u8; INDEX_KEY_LEN]> {
        self.find(id).map(|key| &*key.layers.index)
    }

    pub(crate) fn write_index(&self) -> &[u8; INDEX_KEY_LEN] {
        &self.write().layers.index
    }

    pub(crate) fn write_record(&self) -> &[u8; RECORD_KEY_LEN] {
        &self.write().layers.record
    }

    /// The record key of every key, newest first: a record is read by trying
    /// them in this order ([`super::record`]).
    pub(crate) fn records_newest_first(&self) -> impl Iterator<Item = &[u8; RECORD_KEY_LEN]> {
        self.keys.iter().rev().map(|key| &*key.layers.record)
    }

    fn write(&self) -> &RingKey {
        self.keys.last().expect("a keyring holds a key")
    }

    fn find(&self, id: KeyId) -> Option<&RingKey> {
        if id.is_none() {
            return None;
        }
        self.keys.iter().find(|key| key.id == id)
    }
}

/// Keys and `since` on their way to a new block. Keys stay in id order, so
/// one added last is the write key.
pub(crate) struct KeyringDraft {
    identity: Uuid,
    keys: Vec<RingKey>,
    since: KeyId,
}

impl KeyringDraft {
    /// Keep only the keys `keep` returns true for.
    pub(crate) fn retain(mut self, keep: impl Fn(KeyId) -> bool) -> Self {
        self.keys.retain(|key| keep(key.id));
        self
    }

    /// Add the key `id` of `other`, a keyring of the same vault.
    pub(crate) fn take(mut self, other: &Keyring, id: KeyId) -> Result<Self> {
        let key = other.find(id).ok_or_else(block_mismatch)?.clone();
        self.insert(key);
        Ok(self)
    }

    /// Add a fresh key with id `id`, above every key held.
    pub(crate) fn fresh(mut self, id: KeyId) -> Result<Self> {
        self.insert(RingKey::new(id, random_key())?);
        Ok(self)
    }

    pub(crate) fn since(mut self, since: KeyId) -> Self {
        self.since = since;
        self
    }

    fn insert(&mut self, key: RingKey) {
        if self.keys.iter().any(|held| held.id == key.id) {
            return;
        }
        let at = self.keys.partition_point(|held| held.id < key.id);
        self.keys.insert(at, key);
    }

    /// Seal these keys in a block of `generation` under `kek`, which `kdf`
    /// derives. Refused when no key is left, more than [`MAX_KEYS`] are, or
    /// a key is not below the block's generation.
    pub(crate) fn seal(self, generation: u32, kdf: HeaderKdf, kek: &Kek) -> Result<Keyring> {
        let fits = !self.keys.is_empty()
            && self.keys.len() <= MAX_KEYS
            && self
                .keys
                .last()
                .is_some_and(|key| key.id.get() <= generation)
            && !self.since.is_none();
        if !fits {
            return Err(UprivError::VaultStoreInvalid {
                path: std::path::PathBuf::from(super::header::HEADER_FILE_NAME),
                detail: "a keyring that no header block can hold".into(),
            });
        }
        let plain = encode_plain(generation, self.since, &self.keys);
        let aad = wrap_aad(self.identity, &kdf)?;
        let wrapped = encrypt_xchacha(kek, &plain, &aad)?;
        let block = HeaderBlock {
            generation,
            kdf,
            key_ids: self.keys.iter().map(|key| key.id).collect(),
            since: self.since,
            wrapped_keys_b64: B64.encode(wrapped),
        };
        Ok(Keyring {
            identity: self.identity,
            keys: self.keys,
            since: self.since,
            block,
        })
    }
}

/// The generation, `since`, and keys `wrapped` holds, sealed for the vault
/// `identity` under `kdf`'s settings. [`UprivError::WrongPassword`] when the
/// tag does not check out.
fn unwrap_keys(
    identity: Uuid,
    kdf: &HeaderKdf,
    wrapped: &[u8],
    kek: &Kek,
) -> Result<(u32, KeyId, Vec<RingKey>)> {
    let aad = wrap_aad(identity, kdf)?;
    let plain = Zeroizing::new(decrypt_xchacha(kek, wrapped, &aad)?);
    decode_plain(&plain).ok_or_else(block_mismatch)
}

fn encode_plain(generation: u32, since: KeyId, keys: &[RingKey]) -> Zeroizing<Vec<u8>> {
    let mut plain = Zeroizing::new(Vec::with_capacity(
        PLAIN_HEAD_LEN + PLAIN_KEY_LEN * keys.len(),
    ));
    plain.extend_from_slice(&generation.to_le_bytes());
    plain.extend_from_slice(&since.get().to_le_bytes());
    for key in keys {
        plain.extend_from_slice(&key.id.get().to_le_bytes());
        plain.extend_from_slice(key.key.as_ref());
    }
    plain
}

/// The generation, `since`, and keys of a wrap's plaintext, when it is one:
/// 1 to [`MAX_KEYS`] keys, ids above zero in rising order.
fn decode_plain(plain: &[u8]) -> Option<(u32, KeyId, Vec<RingKey>)> {
    let body = plain.get(PLAIN_HEAD_LEN..)?;
    if body.is_empty() || body.len() % PLAIN_KEY_LEN != 0 || body.len() / PLAIN_KEY_LEN > MAX_KEYS {
        return None;
    }
    let generation = u32::from_le_bytes(plain[0..4].try_into().ok()?);
    let since = KeyId::new(u32::from_le_bytes(plain[4..8].try_into().ok()?));
    let mut keys: Vec<RingKey> = Vec::with_capacity(body.len() / PLAIN_KEY_LEN);
    for entry in body.chunks_exact(PLAIN_KEY_LEN) {
        let id = KeyId::new(u32::from_le_bytes(entry[0..4].try_into().ok()?));
        if id.is_none() || keys.last().is_some_and(|last| last.id >= id) {
            return None;
        }
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(&entry[4..]);
        keys.push(RingKey::new(id, key).ok()?);
    }
    Some((generation, since, keys))
}

/// A wrap that opened but does not match its block: the clear fields were
/// changed, so the block is not the one sealed.
fn block_mismatch() -> UprivError {
    UprivError::VaultStoreInvalid {
        path: std::path::PathBuf::from(super::header::HEADER_FILE_NAME),
        detail: "a header block whose keys do not match its wrap".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::header::HeaderKdf;
    use crate::store::KdfUnlockPreset;

    fn kek(byte: u8) -> Kek {
        Zeroizing::new([byte; 32])
    }

    fn kdf() -> HeaderKdf {
        HeaderKdf::fresh(KdfUnlockPreset::M32)
    }

    #[test]
    fn a_new_keyring_holds_key_1_as_its_write_key() {
        let identity = Uuid::new_v4();
        let keys = Keyring::create(identity, kdf(), &kek(1)).unwrap();
        assert_eq!(keys.write_id(), KeyId::new(1));
        assert_eq!(keys.since(), KeyId::new(1));
        assert_eq!(keys.block().generation, 1);
        assert_eq!(keys.block().key_ids, [KeyId::new(1)]);
        assert_eq!(keys.block().wrapped().unwrap().len(), wrapped_len(1));
        assert!(!keys.holds_key_below_since());
        assert!(keys.content(KeyId::NONE).is_none());
    }

    #[test]
    fn a_block_opens_with_its_kek_and_holds_the_same_keys() {
        let identity = Uuid::new_v4();
        let keys = Keyring::create(identity, kdf(), &kek(1)).unwrap();
        let opened = Keyring::open(identity, keys.block(), &kek(1)).unwrap();
        assert_eq!(opened.write_content(), keys.write_content());
        assert_eq!(opened.write_index(), keys.write_index());
        assert!(matches!(
            Keyring::open(identity, keys.block(), &kek(2)),
            Err(UprivError::WrongPassword)
        ));
        // The wrap binds the vault: another identity does not open it.
        assert!(Keyring::open(Uuid::new_v4(), keys.block(), &kek(1)).is_err());
    }

    #[test]
    fn a_block_whose_clear_fields_were_changed_does_not_open() {
        let identity = Uuid::new_v4();
        let keys = Keyring::create(identity, kdf(), &kek(1)).unwrap();
        let edits: [&dyn Fn(&mut HeaderBlock); 3] = [
            &|block| block.generation = 9,
            &|block| block.since = KeyId::new(9),
            &|block| block.key_ids = vec![KeyId::new(9)],
        ];
        for edit in edits {
            let mut block = keys.block().clone();
            edit(&mut block);
            assert!(Keyring::open(identity, &block, &kek(1)).is_err());
        }
    }

    #[test]
    fn a_draft_keeps_keys_in_id_order_with_the_newest_as_write_key() {
        let identity = Uuid::new_v4();
        let first = Keyring::create(identity, kdf(), &kek(1)).unwrap();
        let second = first
            .draft()
            .fresh(KeyId::new(5))
            .unwrap()
            .seal(5, kdf(), &kek(2))
            .unwrap();
        assert_eq!(second.write_id(), KeyId::new(5));
        assert_eq!(second.content(KeyId::new(1)), first.content(KeyId::new(1)));
        // A key from another keyring lands in its place by id.
        let third = first
            .draft()
            .fresh(KeyId::new(7))
            .unwrap()
            .take(&second, KeyId::new(5))
            .unwrap()
            .seal(7, kdf(), &kek(1))
            .unwrap();
        let ids: Vec<u32> = third.ids().map(KeyId::get).collect();
        assert_eq!(ids, [1, 5, 7]);
        assert_eq!(third.write_id(), KeyId::new(7));
        assert_eq!(third.content(KeyId::new(5)), second.content(KeyId::new(5)));
        let records: Vec<_> = third.records_newest_first().collect();
        assert_eq!(records[0], third.write_record());
    }

    #[test]
    fn a_draft_no_block_can_hold_is_refused() {
        let identity = Uuid::new_v4();
        let keys = Keyring::create(identity, kdf(), &kek(1)).unwrap();
        // A key above the block's generation.
        let above = keys.draft().fresh(KeyId::new(4)).unwrap();
        assert!(above.seal(3, kdf(), &kek(1)).is_err());
        // No key left.
        assert!(keys
            .draft()
            .retain(|_| false)
            .seal(2, kdf(), &kek(1))
            .is_err());
        // More than eight.
        let mut many = keys.draft();
        for id in 2..=9 {
            many = many.fresh(KeyId::new(id)).unwrap();
        }
        assert!(many.seal(9, kdf(), &kek(1)).is_err());
    }

    #[test]
    fn the_wrap_plaintext_is_generation_since_then_id_and_key() {
        let key = RingKey::new(KeyId::new(3), Zeroizing::new([0xab; KEY_LEN])).unwrap();
        let plain = encode_plain(4, KeyId::new(3), std::slice::from_ref(&key));
        let mut expected = vec![4, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0];
        expected.extend_from_slice(&[0xab; KEY_LEN]);
        assert_eq!(plain.as_slice(), expected.as_slice());
        let (generation, since, keys) = decode_plain(&plain).unwrap();
        assert_eq!((generation, since, keys.len()), (4, KeyId::new(3), 1));
        // Ids must rise and never be zero.
        let mut twice = plain.to_vec();
        twice.extend_from_slice(&plain[8..]);
        assert!(decode_plain(&twice).is_none());
        let mut zero = plain.to_vec();
        zero[8..12].copy_from_slice(&0u32.to_le_bytes());
        assert!(decode_plain(&zero).is_none());
        assert!(decode_plain(&plain[..8]).is_none());
    }
}
