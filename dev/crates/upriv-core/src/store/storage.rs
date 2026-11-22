//! A vault's storage value: where its files appear while it is open.
//!
//! The sealed index holds it ([`super::VaultIndex::storage`]), and only that
//! sealed value lets an open write plain text to disk. `config.toml` holds a
//! copy for what runs before the password: the list, the unlock window, and
//! the attach of an encrypted vault's unlocked folder.
//!
//! A missing or unknown value reads as the default, field by field: the
//! default of each field is the one that writes the least plain text, so a
//! value nobody can read never stops a vault from listing or opening.

use serde::{Deserialize, Deserializer, Serialize};

/// `mode` (TS `StorageMode`).
///
/// - `encrypted_dir`: the default. While open, plaintext lives in RAM only
///   (FUSE or WinFsp on desktop, the in-app file manager on mobile).
/// - `upriv_plain`: while open, plaintext in the vault's unlocked folder on
///   this device, wiped on close.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultStorageMode {
    #[default]
    EncryptedDir,
    UprivPlain,
}

impl VaultStorageMode {
    /// The name `config.toml`, the index, and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::EncryptedDir => "encrypted_dir",
            Self::UprivPlain => "upriv_plain",
        }
    }
}

/// `plain_files` (TS `PlainFiles`): what an `upriv_plain` vault puts in its
/// folder while open. The in-app file manager always holds every file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultPlainFiles {
    /// Only what the person sends from the file manager. The folder starts empty.
    #[default]
    Chosen,
    /// Every file, written at open.
    Whole,
}

impl VaultPlainFiles {
    /// The name `config.toml`, the index, and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chosen => "chosen",
            Self::Whole => "whole",
        }
    }
}

/// The storage value: `mode` and `plain_files` (TS `VaultSettingsConfig["storage"]`).
/// The default is encrypted, with only the chosen files for plain text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub struct VaultStorage {
    pub mode: VaultStorageMode,
    pub plain_files: VaultPlainFiles,
}

impl VaultStorage {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// An open writes plain text to disk.
    pub fn is_plain(&self) -> bool {
        self.mode == VaultStorageMode::UprivPlain
    }
}

/// A field, or the whole value, that holds something Upriv does not know
/// reads as its default; any other key beside the two is passed over.
impl<'de> Deserialize<'de> for VaultStorage {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Fields {
            #[serde(default, deserialize_with = "known_or_default")]
            mode: VaultStorageMode,
            #[serde(default, deserialize_with = "known_or_default")]
            plain_files: VaultPlainFiles,
        }
        Ok(match KnownOrOther::<Fields>::deserialize(deserializer)? {
            KnownOrOther::Known(fields) => Self {
                mode: fields.mode,
                plain_files: fields.plain_files,
            },
            KnownOrOther::Other(_) => Self::default(),
        })
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum KnownOrOther<T> {
    Known(T),
    Other(serde::de::IgnoredAny),
}

fn known_or_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(match KnownOrOther::<T>::deserialize(deserializer)? {
        KnownOrOther::Known(value) => value,
        KnownOrOther::Other(_) => T::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN_WHOLE: VaultStorage = VaultStorage {
        mode: VaultStorageMode::UprivPlain,
        plain_files: VaultPlainFiles::Whole,
    };

    #[test]
    fn the_default_is_encrypted_with_only_the_chosen_files() {
        let storage = VaultStorage::default();
        assert_eq!(storage.mode, VaultStorageMode::EncryptedDir);
        assert_eq!(storage.plain_files, VaultPlainFiles::Chosen);
        assert!(storage.is_default());
        assert!(!storage.is_plain());
        assert!(PLAIN_WHOLE.is_plain());
    }

    #[test]
    fn every_value_round_trips_in_toml_and_json() {
        for mode in [VaultStorageMode::EncryptedDir, VaultStorageMode::UprivPlain] {
            for plain_files in [VaultPlainFiles::Chosen, VaultPlainFiles::Whole] {
                let storage = VaultStorage { mode, plain_files };
                let toml_text = toml::to_string(&storage).unwrap();
                assert_eq!(toml::from_str::<VaultStorage>(&toml_text).unwrap(), storage);
                let json = serde_json::to_string(&storage).unwrap();
                assert_eq!(
                    serde_json::from_str::<VaultStorage>(&json).unwrap(),
                    storage
                );
            }
        }
        let toml_text = toml::to_string(&PLAIN_WHOLE).unwrap();
        assert!(toml_text.contains("mode = \"upriv_plain\""), "{toml_text}");
        assert!(toml_text.contains("plain_files = \"whole\""), "{toml_text}");
    }

    #[test]
    fn each_name_is_the_one_serde_writes() {
        for mode in [VaultStorageMode::EncryptedDir, VaultStorageMode::UprivPlain] {
            let json = serde_json::to_string(&mode).unwrap();
            assert_eq!(json, format!("\"{}\"", mode.as_str()));
        }
        for files in [VaultPlainFiles::Chosen, VaultPlainFiles::Whole] {
            let json = serde_json::to_string(&files).unwrap();
            assert_eq!(json, format!("\"{}\"", files.as_str()));
        }
    }

    #[test]
    fn a_missing_field_reads_as_its_default() {
        let storage: VaultStorage = toml::from_str("mode = \"upriv_plain\"").unwrap();
        assert_eq!(storage.mode, VaultStorageMode::UprivPlain);
        assert_eq!(storage.plain_files, VaultPlainFiles::Chosen);
        assert_eq!(
            toml::from_str::<VaultStorage>("").unwrap(),
            VaultStorage::default()
        );
    }

    #[test]
    fn an_unknown_value_reads_as_the_default_of_its_field() {
        let storage: VaultStorage =
            toml::from_str("mode = \"future_mode\"\nplain_files = \"whole\"").unwrap();
        assert_eq!(storage.mode, VaultStorageMode::EncryptedDir);
        assert_eq!(storage.plain_files, VaultPlainFiles::Whole);

        let storage: VaultStorage =
            serde_json::from_str(r#"{"mode":"upriv_plain","plain_files":7}"#).unwrap();
        assert_eq!(storage.mode, VaultStorageMode::UprivPlain);
        assert_eq!(storage.plain_files, VaultPlainFiles::Chosen);
    }

    #[test]
    fn a_value_of_the_wrong_shape_reads_as_the_default() {
        assert_eq!(
            serde_json::from_str::<VaultStorage>("\"upriv_plain\"").unwrap(),
            VaultStorage::default()
        );
        assert_eq!(
            serde_json::from_str::<VaultStorage>("[1, 2]").unwrap(),
            VaultStorage::default()
        );
    }

    #[test]
    fn other_keys_beside_the_two_are_passed_over() {
        let storage: VaultStorage = toml::from_str("mode = \"upriv_plain\"\nlater = true").unwrap();
        assert_eq!(storage.mode, VaultStorageMode::UprivPlain);
    }
}
