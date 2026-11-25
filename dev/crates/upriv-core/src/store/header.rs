//! `store/header/vault.header` — JSON, versioned — and its twin
//! `vault.header.copy`. A header holds the vault's keys in one block (the top
//! block), or two while a password change is pending (`change`). `warning` is
//! human-only and is not part of any AAD.
//!
//! ```json
//! {
//!   "warning": "…", "format_version": 1, "content_identity": "…",
//!   "aead": "xchacha20poly1305", "name_cipher": "aes256-siv", "chunk_size": 262144,
//!   "generation": 7, "kdf": { … }, "key_ids": [3], "since": 3, "wrapped_keys_b64": "…",
//!   "change": { "generation": 8, "kdf": { … }, "key_ids": [3, 8], "since": 8, "wrapped_keys_b64": "…" }
//! }
//! ```
//!
//! A block is a keyring sealed under the KEK its own `kdf` derives
//! ([`super::keys`]). `generation` grows with every header write: a write
//! takes a number above every generation the file held, `change`'s included,
//! so it tells a newer header from an older one. `since` is a key id: a chunk
//! on a key below it waits for a password change to convert it.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::index::ChunkVersion;
use super::kdf::{derive_kek, KdfUnlockPreset, Kek, SALT_LEN};
use super::keys::{wrapped_len, KeyId, Keyring, MAX_KEYS};
use crate::error::{Result, UprivError};
use crate::paths;

pub const FORMAT_VERSION: u32 = 1;
pub const HEADER_DIR_NAME: &str = "header";
pub const HEADER_FILE_NAME: &str = "vault.header";
pub const HEADER_COPY_FILE_NAME: &str = "vault.header.copy";
pub const STORE_DANGER_FILE_NAME: &str = "DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md";
pub const HEADER_WARNING: &str = "DO NOT EDIT. Changing or deleting this file can permanently destroy the vault, even if you know the password.";
const DANGER_NOTICE: &str = include_str!("DANGER-DO-NOT-EDIT-PERMANENT-DATA-LOSS.md");
pub const AEAD_ID: &str = "xchacha20poly1305";
pub const NAME_CIPHER_ID: &str = "aes256-siv";
pub const KDF_ALG: &str = "argon2id";
pub const CHUNK_SIZE: u32 = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultHeader {
    pub warning: String,
    pub format_version: u32,
    pub content_identity: Uuid,
    pub aead: String,
    pub name_cipher: String,
    pub chunk_size: u32,
    /// The top block: the vault's keys under its password.
    #[serde(flatten)]
    pub top: HeaderBlock,
    /// A second block, under the new password, while a password change is
    /// pending: the current keys, then the change's new key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change: Option<HeaderBlock>,
}

/// One locked keyring of a header ([`super::keys`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeaderBlock {
    pub generation: u32,
    pub kdf: HeaderKdf,
    /// The ids of the keys the wrap holds, in the clear, oldest first.
    pub key_ids: Vec<KeyId>,
    pub since: KeyId,
    /// `nonce(24) || XChaCha20-Poly1305(keys) || tag(16)`.
    pub wrapped_keys_b64: String,
}

/// The unlock settings of one block: Argon2id cost and salt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeaderKdf {
    pub alg: String,
    pub memory_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
    pub salt_b64: String,
}

impl VaultHeader {
    /// A header of `identity` whose only block is `top`.
    pub(crate) fn new(identity: Uuid, top: HeaderBlock) -> Self {
        Self {
            warning: HEADER_WARNING.to_string(),
            format_version: FORMAT_VERSION,
            content_identity: identity,
            aead: AEAD_ID.to_string(),
            name_cipher: NAME_CIPHER_ID.to_string(),
            chunk_size: CHUNK_SIZE,
            top,
            change: None,
        }
    }

    pub fn path(store_dir: impl AsRef<Path>) -> PathBuf {
        header_dir(store_dir).join(HEADER_FILE_NAME)
    }

    pub fn copy_path(store_dir: impl AsRef<Path>) -> PathBuf {
        header_dir(store_dir).join(HEADER_COPY_FILE_NAME)
    }

    /// The unlock cost of the vault's password, from the top block.
    pub fn unlock_preset(&self) -> Option<KdfUnlockPreset> {
        self.top.kdf.unlock_preset()
    }

    /// The highest generation this header holds, `change`'s included.
    pub fn newest_generation(&self) -> u32 {
        self.change.as_ref().map_or(self.top.generation, |change| {
            change.generation.max(self.top.generation)
        })
    }
}

impl HeaderBlock {
    /// The sealed keyring, decoded from base64.
    pub(crate) fn wrapped(&self) -> Result<Vec<u8>> {
        B64.decode(self.wrapped_keys_b64.as_bytes())
            .map_err(|_| invalid_header(Path::new(HEADER_FILE_NAME), "invalid wrapped keys"))
    }

    /// The write key's id: the last key of the block.
    pub fn write_id(&self) -> KeyId {
        self.key_ids.last().copied().unwrap_or(KeyId::NONE)
    }
}

impl HeaderKdf {
    /// Settings at `preset` with a fresh random salt.
    pub(crate) fn fresh(preset: KdfUnlockPreset) -> Self {
        Self {
            alg: KDF_ALG.to_string(),
            memory_kib: preset.memory_kib(),
            time_cost: preset.time_cost(),
            parallelism: preset.parallelism(),
            salt_b64: B64.encode(super::aead::random_bytes::<SALT_LEN>()),
        }
    }

    /// The same cost with a fresh random salt.
    pub(crate) fn with_new_salt(&self) -> Self {
        Self {
            salt_b64: B64.encode(super::aead::random_bytes::<SALT_LEN>()),
            ..self.clone()
        }
    }

    pub fn unlock_preset(&self) -> Option<KdfUnlockPreset> {
        KdfUnlockPreset::from_params(self.memory_kib, self.time_cost, self.parallelism)
    }

    /// True when one derive serves both: the same salt and cost.
    pub(crate) fn same_lock(&self, other: &Self) -> bool {
        self.salt_b64 == other.salt_b64
            && self.memory_kib == other.memory_kib
            && self.time_cost == other.time_cost
            && self.parallelism == other.parallelism
    }

    pub(crate) fn salt(&self) -> Option<[u8; SALT_LEN]> {
        B64.decode(self.salt_b64.as_bytes()).ok()?.try_into().ok()
    }

    /// The KEK `password` derives under these settings. Password bytes are
    /// used exactly as given.
    pub(crate) fn derive_kek(&self, password: &[u8]) -> Result<Kek> {
        let salt = self.salt().ok_or(UprivError::WrongPassword)?;
        derive_kek(
            password,
            &salt,
            self.memory_kib,
            self.time_cost,
            self.parallelism,
        )
    }

    fn in_bounds(&self) -> bool {
        self.alg == KDF_ALG
            && super::kdf::kdf_params_in_bounds(self.memory_kib, self.time_cost, self.parallelism)
            && self.salt().is_some()
    }
}

/// Compact serde_json of this struct's field order. This is NOT RFC 8785
/// sorted JSON and NOT the pretty-printed vault.header on disk. Do not
/// reorder fields, rename keys, or switch to BTreeMap/sorted maps without a
/// format_version bump (existing wrap/index tags would fail). Golden:
/// `aad_bytes_are_struct_field_order`.
///
/// Covers `wrap` and `index`, each built from one block's unlock settings:
/// a keyring opens only under the settings it was sealed with, and an index
/// opens only under the pair of the block it was sealed for (its write key's
/// index key and this AAD).
#[derive(Serialize)]
struct HeaderAad<'a> {
    v: u32,
    cid: String,
    kdf: &'a str,
    m: u32,
    t: u32,
    p: u32,
    salt: &'a str,
    aead: &'a str,
    names: &'a str,
    chunk: u32,
    kind: &'static str,
}

/// Chunk AAD — deliberately narrower than [`HeaderAad`]. Same serialization
/// freeze applies: field order is the byte order.
///
/// Three fields are absent by design, and each omission is load-bearing:
///
/// - **No `salt`/`m`/`t`/`p`.** An unlock-RAM change keeps the keys and seals
///   them under a new salt and cost; binding those here would rewrite every
///   chunk for nothing. Which key opens a chunk is the index's to say
///   (`chunk_keys`), not the unlock settings'.
/// - **No `file_size`.** Appending to a file changes its size, which would
///   change the AAD of every chunk already written and force a full rewrite —
///   O(file) per write, and unusable for random-access writes through a mount.
///   The sealed index is the authenticated authority on length, so a truncated
///   file still fails closed via a missing chunk or a `chunk_len` mismatch.
/// - **No `names`.** The name cipher governs the index, not content blobs.
///
/// `version` replaces the rollback protection that `file_size` incidentally
/// provided: it is derived from the chunk's fresh random nonce, so each write
/// has its own, and it is recorded in the index, so a stale chunk cannot be
/// replayed at the same `(file_id, chunk_index)` without the index key.
#[derive(Serialize)]
struct ChunkAad<'a> {
    v: u32,
    cid: String,
    aead: &'a str,
    chunk: u32,
    kind: &'static str,
    file_id: &'a str,
    chunk_index: u32,
    chunk_len: u32,
    version: ChunkVersion,
}

fn aad_error(error: serde_json::Error) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: PathBuf::from(HEADER_FILE_NAME),
        detail: format!("AAD serialize: {error}"),
    }
}

/// The algorithm ids, the format version, and the chunk size are fixed by the
/// format, and a header that names others does not parse
/// ([`parse_header_bytes`]), so every AAD builds them from the constants.
fn header_aad_bytes(identity: Uuid, kdf: &HeaderKdf, kind: &'static str) -> Result<Vec<u8>> {
    serde_json::to_vec(&HeaderAad {
        v: FORMAT_VERSION,
        cid: identity.to_string(),
        kdf: &kdf.alg,
        m: kdf.memory_kib,
        t: kdf.time_cost,
        p: kdf.parallelism,
        salt: &kdf.salt_b64,
        aead: AEAD_ID,
        names: NAME_CIPHER_ID,
        chunk: CHUNK_SIZE,
        kind,
    })
    .map_err(aad_error)
}

/// The AAD of a block's sealed keyring.
pub fn wrap_aad(identity: Uuid, kdf: &HeaderKdf) -> Result<Vec<u8>> {
    header_aad_bytes(identity, kdf, "wrap")
}

/// The AAD of an index sealed under a block with these unlock settings.
pub fn index_aad(identity: Uuid, kdf: &HeaderKdf) -> Result<Vec<u8>> {
    header_aad_bytes(identity, kdf, "index")
}

pub fn chunk_aad(
    identity: Uuid,
    file_id: &str,
    chunk_index: u32,
    chunk_len: u32,
    version: ChunkVersion,
) -> Result<Vec<u8>> {
    serde_json::to_vec(&ChunkAad {
        v: FORMAT_VERSION,
        cid: identity.to_string(),
        aead: AEAD_ID,
        chunk: CHUNK_SIZE,
        kind: "chunk",
        file_id,
        chunk_index,
        chunk_len,
        version,
    })
    .map_err(aad_error)
}

/// Recovery record AAD ([`super::record`]). Same serialization freeze: field
/// order is the byte order.
///
/// `cid` keeps a record in its vault, `file_id` in its blob, and `seq` in its
/// place in that blob's chain of records, so a record copied anywhere else
/// does not open. Like [`ChunkAad`] it leaves out the unlock settings.
#[derive(Serialize)]
struct RecordAad<'a> {
    v: u32,
    cid: String,
    aead: &'a str,
    kind: &'static str,
    file_id: &'a str,
    seq: u32,
}

pub fn record_aad(identity: Uuid, file_id: &str, seq: u32) -> Result<Vec<u8>> {
    serde_json::to_vec(&RecordAad {
        v: FORMAT_VERSION,
        cid: identity.to_string(),
        aead: AEAD_ID,
        kind: "record",
        file_id,
        seq,
    })
    .map_err(aad_error)
}

fn header_dir(store_dir: impl AsRef<Path>) -> PathBuf {
    store_dir.as_ref().join(HEADER_DIR_NAME)
}

/// Which of the two header files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeaderSlot {
    Primary,
    Copy,
}

impl HeaderSlot {
    pub(crate) fn path(self, store_dir: &Path) -> PathBuf {
        match self {
            Self::Primary => VaultHeader::path(store_dir),
            Self::Copy => VaultHeader::copy_path(store_dir),
        }
    }

    pub(crate) fn file_name(self) -> &'static str {
        match self {
            Self::Primary => HEADER_FILE_NAME,
            Self::Copy => HEADER_COPY_FILE_NAME,
        }
    }
}

/// One header file as read: its bytes, and the header they parse to.
#[derive(Debug)]
pub(crate) struct HeaderFile {
    pub slot: HeaderSlot,
    pub raw: Vec<u8>,
    pub header: Result<VaultHeader>,
}

/// Both header files of `store_dir`, primary first: `None` for one that is
/// not there. A read error other than a missing file fails.
pub(crate) fn read_header_files(store_dir: &Path) -> Result<[Option<HeaderFile>; 2]> {
    let read = |slot: HeaderSlot| -> Result<Option<HeaderFile>> {
        let path = slot.path(store_dir);
        Ok(read_bytes(&path)?.map(|raw| HeaderFile {
            slot,
            header: parse_structural(&path, &raw),
            raw,
        }))
    };
    Ok([read(HeaderSlot::Primary)?, read(HeaderSlot::Copy)?])
}

/// The header of `store_dir` for code with no password: the newer of the two
/// files that parse (the primary on a tie). Nothing is unwrapped or written.
pub fn load_header(store_dir: impl AsRef<Path>) -> Result<VaultHeader> {
    let store_dir = store_dir.as_ref();
    let files = read_header_files(store_dir)?;
    let mut newest: Option<VaultHeader> = None;
    let mut first_error = None;
    for file in files.into_iter().flatten() {
        match file.header {
            Ok(header) => {
                if newest
                    .as_ref()
                    .is_none_or(|kept| header.newest_generation() > kept.newest_generation())
                {
                    newest = Some(header);
                }
            }
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    newest.ok_or_else(|| {
        first_error.unwrap_or_else(|| UprivError::VaultStoreInvalid {
            path: VaultHeader::path(store_dir),
            detail: "missing vault.header".into(),
        })
    })
}

fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>> {
    match crate::host_fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Read `raw` as the header of a copy of a store held elsewhere, such as a
/// backup zip. Nothing is unwrapped.
pub(crate) fn parse_header_bytes(raw: &[u8]) -> Result<VaultHeader> {
    parse_structural(Path::new(HEADER_FILE_NAME), raw)
}

fn invalid_header(path: &Path, detail: &str) -> UprivError {
    UprivError::VaultStoreInvalid {
        path: path.to_path_buf(),
        detail: detail.to_string(),
    }
}

fn parse_structural(path: &Path, raw: &[u8]) -> Result<VaultHeader> {
    let text =
        std::str::from_utf8(raw).map_err(|_| invalid_header(path, "invalid vault.header"))?;
    let header: VaultHeader = serde_json::from_str(text)
        .map_err(|error| invalid_header(path, &format!("invalid vault.header: {error}")))?;
    if header.format_version != FORMAT_VERSION {
        return Err(invalid_header(
            path,
            &format!(
                "unsupported format_version {} (this build writes {FORMAT_VERSION})",
                header.format_version
            ),
        ));
    }
    if header.aead != AEAD_ID
        || header.name_cipher != NAME_CIPHER_ID
        || header.chunk_size != CHUNK_SIZE
    {
        return Err(invalid_header(path, "unsupported algorithms or chunk size"));
    }
    if !block_well_formed(&header.top) {
        return Err(invalid_header(path, "invalid header block"));
    }
    if let Some(change) = &header.change {
        // A change is written above the top block it starts from.
        if !block_well_formed(change) || change.generation <= header.top.generation {
            return Err(invalid_header(path, "invalid change block"));
        }
    }
    Ok(header)
}

/// What a block must be before its wrap is tried: unlock settings in bounds,
/// one to [`MAX_KEYS`] key ids above zero, rising, none above the block's
/// generation, `since` a key id no higher than the write key, and a wrap of
/// the length those keys take.
fn block_well_formed(block: &HeaderBlock) -> bool {
    let ids = &block.key_ids;
    let rising = ids.windows(2).all(|pair| pair[0] < pair[1]);
    block.kdf.in_bounds()
        && (1..=MAX_KEYS).contains(&ids.len())
        && rising
        && ids.first().is_some_and(|first| !first.is_none())
        && block.write_id().get() <= block.generation
        && !block.since.is_none()
        && block.since <= block.write_id()
        && block
            .wrapped()
            .is_ok_and(|wrapped| wrapped.len() == wrapped_len(ids.len()))
}

pub fn ensure_danger_notice(store_dir: &Path) -> Result<()> {
    let path = store_dir.join(STORE_DANGER_FILE_NAME);
    if crate::host_fs::read(&path).ok().as_deref() == Some(DANGER_NOTICE.as_bytes()) {
        return Ok(());
    }
    paths::write_bytes_atomic(&path, DANGER_NOTICE.as_bytes())
}

pub fn header_bytes(header: &VaultHeader) -> Result<Vec<u8>> {
    let body = serde_json::to_string_pretty(header).map_err(|error| {
        invalid_header(
            Path::new(HEADER_FILE_NAME),
            &format!("serialize vault.header: {error}"),
        )
    })?;
    Ok(body.into_bytes())
}

/// Write `header` into both header files of a store being made.
pub fn save_header(store_dir: impl AsRef<Path>, header: &VaultHeader) -> Result<()> {
    let store_dir = store_dir.as_ref();
    let bytes = header_bytes(header)?;
    paths::write_bytes_atomic(&VaultHeader::path(store_dir), &bytes)?;
    paths::write_bytes_atomic(&VaultHeader::copy_path(store_dir), &bytes)?;
    ensure_danger_notice(store_dir)
}

/// The header of a new vault and its keyring: a new content identity, one
/// key, generation 1, at `preset` under `password`.
pub fn create_header(password: &[u8], preset: KdfUnlockPreset) -> Result<(VaultHeader, Keyring)> {
    let identity = Uuid::new_v4();
    let kdf = HeaderKdf::fresh(preset);
    let kek = kdf.derive_kek(password)?;
    let keys = Keyring::create(identity, kdf, &kek)?;
    Ok((VaultHeader::new(identity, keys.block().clone()), keys))
}

#[cfg(test)]
mod aad_golden_tests {
    use super::*;
    use uuid::Uuid;

    /// `a1b2c3d4e5f60718`, the version every golden AAD below carries.
    const VERSION: ChunkVersion =
        ChunkVersion::from_bytes([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18]);

    fn identity() -> Uuid {
        Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap()
    }

    fn fixture_kdf() -> HeaderKdf {
        HeaderKdf {
            alg: KDF_ALG.into(),
            memory_kib: 32 * 1024,
            time_cost: 3,
            parallelism: 1,
            salt_b64: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
        }
    }

    #[test]
    fn aad_bytes_are_struct_field_order() {
        let wrap = wrap_aad(identity(), &fixture_kdf()).unwrap();
        let index = index_aad(identity(), &fixture_kdf()).unwrap();
        let chunk = chunk_aad(
            identity(),
            "11111111-1111-4111-8111-111111111111",
            2,
            37756,
            VERSION,
        )
        .unwrap();
        assert_eq!(
            wrap,
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","kdf":"argon2id","m":32768,"t":3,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","aead":"xchacha20poly1305","names":"aes256-siv","chunk":262144,"kind":"wrap"}"#
        );
        assert_eq!(
            index,
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","kdf":"argon2id","m":32768,"t":3,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","aead":"xchacha20poly1305","names":"aes256-siv","chunk":262144,"kind":"index"}"#
        );
        assert_eq!(
            chunk,
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","aead":"xchacha20poly1305","chunk":262144,"kind":"chunk","file_id":"11111111-1111-4111-8111-111111111111","chunk_index":2,"chunk_len":37756,"version":"a1b2c3d4e5f60718"}"#
        );
        let record = record_aad(identity(), "11111111-1111-4111-8111-111111111111", 3).unwrap();
        assert_eq!(
            record,
            br#"{"v":1,"cid":"00000000-0000-4000-8000-000000000001","aead":"xchacha20poly1305","kind":"record","file_id":"11111111-1111-4111-8111-111111111111","seq":3}"#
        );
    }

    /// The three omissions in [`ChunkAad`] are load-bearing for this format —
    /// assert them directly so a future "let's bind more context" edit fails
    /// here instead of silently making writes O(file) or every unlock-RAM
    /// change a rewrite of the vault.
    #[test]
    fn chunk_aad_omits_kdf_material_and_file_size() {
        let chunk = chunk_aad(
            identity(),
            "11111111-1111-4111-8111-111111111111",
            2,
            37756,
            VERSION,
        )
        .unwrap();
        let text = String::from_utf8(chunk).unwrap();
        for forbidden in ["\"salt\"", "\"m\":", "\"t\":", "\"p\":", "\"file_size\""] {
            assert!(
                !text.contains(forbidden),
                "chunk AAD must not bind {forbidden}: {text}"
            );
        }
        assert!(text.contains("\"version\":\"a1b2c3d4e5f60718\""));
    }

    #[test]
    fn chunk_version_changes_the_aad() {
        let fid = "11111111-1111-4111-8111-111111111111";
        let a = chunk_aad(identity(), fid, 0, 16, ChunkVersion::from_bytes([0xaa; 8])).unwrap();
        let b = chunk_aad(identity(), fid, 0, 16, ChunkVersion::from_bytes([0xbb; 8])).unwrap();
        assert_ne!(a, b, "a rewritten chunk must not accept the stale blob");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(generation: u32, ids: &[u32], since: u32) -> HeaderBlock {
        let wrapped = vec![0u8; wrapped_len(ids.len())];
        HeaderBlock {
            generation,
            kdf: HeaderKdf::fresh(KdfUnlockPreset::M32),
            key_ids: ids.iter().copied().map(KeyId::new).collect(),
            since: KeyId::new(since),
            wrapped_keys_b64: B64.encode(wrapped),
        }
    }

    fn header(top: HeaderBlock, change: Option<HeaderBlock>) -> VaultHeader {
        VaultHeader {
            change,
            ..VaultHeader::new(Uuid::new_v4(), top)
        }
    }

    fn parses(header: &VaultHeader) -> bool {
        parse_header_bytes(&header_bytes(header).unwrap()).is_ok()
    }

    #[test]
    fn a_header_file_lists_its_fields_in_the_documented_order() {
        let pending = header(block(7, &[3], 3), Some(block(8, &[3, 8], 8)));
        let text = String::from_utf8(header_bytes(&pending).unwrap()).unwrap();
        let order = [
            "\"warning\"",
            "\"format_version\"",
            "\"content_identity\"",
            "\"aead\"",
            "\"name_cipher\"",
            "\"chunk_size\"",
            "\"generation\": 7",
            "\"kdf\"",
            "\"key_ids\"",
            "\"since\": 3",
            "\"wrapped_keys_b64\"",
            "\"change\"",
            "\"generation\": 8",
        ];
        let places: Vec<usize> = order
            .iter()
            .map(|field| {
                text.find(field)
                    .unwrap_or_else(|| panic!("{field} in {text}"))
            })
            .collect();
        assert!(places.windows(2).all(|pair| pair[0] < pair[1]), "{text}");
        assert_eq!(parse_header_bytes(text.as_bytes()).unwrap(), pending);
        // A steady header has no `change` at all.
        let steady = header(block(7, &[3], 3), None);
        let text = String::from_utf8(header_bytes(&steady).unwrap()).unwrap();
        assert!(!text.contains("change"), "{text}");
    }

    #[test]
    fn a_block_that_no_keyring_fits_does_not_parse() {
        assert!(parses(&header(block(3, &[1, 3], 1), None)));
        let refused = [
            block(3, &[], 1),
            block(3, &[3, 1], 1),
            block(3, &[1, 1], 1),
            block(3, &[0, 2], 2),
            block(2, &[1, 3], 1),
            block(3, &[1, 3], 0),
            block(3, &[1, 2], 3),
            block(9, &[1, 2, 3, 4, 5, 6, 7, 8, 9], 1),
        ];
        for top in refused {
            assert!(!parses(&header(top.clone(), None)), "{top:?}");
        }
        let mut short = block(3, &[1, 3], 1);
        short.wrapped_keys_b64 = B64.encode([0u8; 20]);
        assert!(!parses(&header(short, None)));
        let mut cost = block(3, &[1], 1);
        cost.kdf.memory_kib = crate::store::kdf::MAX_KDF_MEMORY_KIB + 1024;
        assert!(!parses(&header(cost, None)));
    }

    #[test]
    fn a_change_is_written_above_its_top_block() {
        assert!(parses(&header(
            block(7, &[3], 3),
            Some(block(8, &[3, 8], 8))
        )));
        assert!(!parses(&header(
            block(8, &[3], 3),
            Some(block(8, &[3, 8], 8))
        )));
    }

    #[test]
    fn the_newest_generation_counts_the_change() {
        let pending = header(block(7, &[3], 3), Some(block(8, &[3, 8], 8)));
        assert_eq!(pending.newest_generation(), 8);
        assert_eq!(header(block(7, &[3], 3), None).newest_generation(), 7);
    }

    #[test]
    fn an_unknown_version_does_not_parse() {
        let mut other = header(block(1, &[1], 1), None);
        other.format_version = 99;
        assert!(!parses(&other));
    }
}
