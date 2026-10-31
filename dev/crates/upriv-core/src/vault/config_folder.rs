//! `.upriv-config/`: the folder a `.7z` or a plain-text `.zip` keeps at the vault
//! root, beside the vault's files.
//!
//! An export writes it only when a toggle asks for what it carries: `config.toml`
//! (the same bytes a store zip carries) and `workspace.json` (the file-manager
//! layout), with a `README.md` that explains the folder. Importing works with
//! any of these missing. The settings reach the new vault through the create
//! wizard, the layout goes to `.upriv-workspace.json`, and the folder itself is
//! never stored.

use std::io::Read;
use std::path::Path;

use zeroize::Zeroizing;

use crate::error::Result;
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::store::{
    read_logical_file, VaultIndex, EXPORT_CONFIG_DIR, INTERNAL_WORKSPACE_FILE,
    VAULT_FS_MAX_INLINE_BYTES,
};

use super::embedded_settings::{
    parse_embedded_settings, snapshot_settings_bytes, EmbeddedVaultSettings,
};
use super::fs::fs_write_file;
use super::seven_zip_pack::LogicalSource;
use super::welcome::{seal_welcome_if_absent, VaultWelcome};

const SETTINGS_FILE: &str = "config.toml";
const WORKSPACE_FILE: &str = "workspace.json";
const README_FILE: &str = "README.md";
const README_TEXT: &str = include_str!("CONFIG-FOLDER-README.md");

/// Far above any real `config.toml`. Only this much of a carried one is read.
const SETTINGS_MAX_BYTES: u64 = 1024 * 1024;

/// What an export puts in `.upriv-config/` beside the vault's files.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ExportInclude {
    pub workspace: bool,
    pub settings: bool,
}

/// One file of `.upriv-config/`, held in RAM until it is packed.
pub(crate) struct ConfigFile {
    name: &'static str,
    pub(crate) bytes: Zeroizing<Vec<u8>>,
}

impl ConfigFile {
    /// Its path from the vault root.
    pub(crate) fn path(&self) -> String {
        format!("{EXPORT_CONFIG_DIR}/{}", self.name)
    }
}

/// The files `include` asks for, settings first: a `.7z` password test reads
/// only the first member. Empty when there is nothing to carry, so the export
/// holds the vault's files and no folder.
pub(crate) fn config_folder_files(
    vault_dir: &Path,
    source: LogicalSource<'_>,
    index: &VaultIndex,
    include: ExportInclude,
) -> Result<Vec<ConfigFile>> {
    let mut files = Vec::new();
    if include.settings {
        files.push(ConfigFile {
            name: SETTINGS_FILE,
            bytes: Zeroizing::new(snapshot_settings_bytes(vault_dir, source.store_dir)?),
        });
    }
    if include.workspace && index.find(INTERNAL_WORKSPACE_FILE).is_some() {
        let layout = Zeroizing::new(read_logical_file(
            source.store_dir,
            source.header,
            source.content_key,
            index,
            INTERNAL_WORKSPACE_FILE,
        )?);
        if !layout.is_empty() {
            files.push(ConfigFile {
                name: WORKSPACE_FILE,
                bytes: layout,
            });
        }
    }
    if !files.is_empty() {
        files.push(ConfigFile {
            name: README_FILE,
            bytes: Zeroizing::new(README_TEXT.as_bytes().to_vec()),
        });
    }
    Ok(files)
}

/// A path inside `.upriv-config/` at the vault root, as an import reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfigMember {
    Settings,
    Workspace,
    /// The `README.md`, or a file this app does not read.
    Other,
}

/// What `logical` is, when it sits inside `.upriv-config/` at the vault root.
pub(crate) fn config_member(logical: &str) -> Option<ConfigMember> {
    let name = logical
        .strip_prefix(EXPORT_CONFIG_DIR)?
        .strip_prefix('/')
        .filter(|name| !name.is_empty())?;
    Some(match name {
        SETTINGS_FILE => ConfigMember::Settings,
        WORKSPACE_FILE => ConfigMember::Workspace,
        _ => ConfigMember::Other,
    })
}

/// Up to `cap` bytes of `reader`, read to its end so a checksum behind it is
/// verified. `None` when it holds more; nothing past `cap` is kept.
fn read_capped(reader: &mut dyn Read, cap: u64) -> std::io::Result<Option<Zeroizing<Vec<u8>>>> {
    let mut bytes = Zeroizing::new(Vec::new());
    (&mut *reader).take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        std::io::copy(reader, &mut std::io::sink())?;
        return Ok(None);
    }
    Ok(Some(bytes))
}

/// The settings a carried `config.toml` holds. One that cannot be read counts
/// as missing: the wizard then shows its own defaults.
pub(crate) fn read_carried_settings(
    reader: &mut dyn Read,
) -> std::io::Result<Option<EmbeddedVaultSettings>> {
    let Some(bytes) = read_capped(reader, SETTINGS_MAX_BYTES)? else {
        log_event(LogLevel::Warn, "import_settings_unreadable", &[]);
        return Ok(None);
    };
    match parse_embedded_settings(&bytes) {
        Ok(settings) => Ok(Some(settings)),
        Err(_) => {
            log_event(LogLevel::Warn, "import_settings_unreadable", &[]);
            Ok(None)
        }
    }
}

/// A carried layout, if it fits a file the session can write. `None` starts the
/// new vault with a clean layout.
pub(crate) fn read_carried_layout(
    reader: &mut dyn Read,
) -> std::io::Result<Option<Zeroizing<Vec<u8>>>> {
    Ok(read_capped(reader, VAULT_FS_MAX_INLINE_BYTES)?.filter(|bytes| !bytes.is_empty()))
}

/// What a new vault takes from an import besides the archive's files.
#[derive(Debug, Clone, Copy, Default)]
pub struct ImportExtras<'a> {
    /// Added when the archive has no `README.md` and no layout was kept.
    pub welcome: Option<VaultWelcome<'a>>,
    /// Keep the file-manager layout the archive carries.
    pub keep_workspace: bool,
}

impl ImportExtras<'_> {
    /// Refuse a welcome over its cap before a vault exists.
    pub(crate) fn check(&self) -> Result<()> {
        if let Some(welcome) = self.welcome {
            welcome.files()?;
        }
        Ok(())
    }

    /// After an import sealed its files: the layout it kept, or the welcome
    /// note. A kept layout is the person's own, so no welcome goes over it.
    pub(crate) fn seal(
        &self,
        root: &VaultRoot,
        vault_id: &str,
        layout: Option<Zeroizing<Vec<u8>>>,
    ) -> Result<()> {
        if let Some(layout) = layout {
            let path = format!("/{INTERNAL_WORKSPACE_FILE}");
            fs_write_file(root, vault_id, &path, &layout)?;
        } else if let Some(welcome) = self.welcome {
            seal_welcome_if_absent(root, vault_id, welcome)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_paths_inside_the_root_folder_are_its_members() {
        let member = |name: &str| config_member(&format!(".upriv-config/{name}"));
        assert_eq!(member("config.toml"), Some(ConfigMember::Settings));
        assert_eq!(member("workspace.json"), Some(ConfigMember::Workspace));
        assert_eq!(member("README.md"), Some(ConfigMember::Other));
        assert_eq!(member("extra/config.toml"), Some(ConfigMember::Other));
        assert_eq!(config_member(".upriv-config"), None);
        assert_eq!(config_member(".upriv-config/"), None);
        assert_eq!(config_member("docs/.upriv-config/config.toml"), None);
        assert_eq!(config_member(".upriv-config-notes/config.toml"), None);
    }

    #[test]
    fn a_read_stops_keeping_bytes_past_the_cap_but_reaches_the_end() {
        let mut exact: &[u8] = b"abc";
        assert_eq!(
            read_capped(&mut exact, 3).unwrap().unwrap().as_slice(),
            b"abc"
        );
        let mut over: &[u8] = b"abcd";
        assert!(read_capped(&mut over, 3).unwrap().is_none());
        assert!(over.is_empty());
    }

    #[test]
    fn carried_settings_that_cannot_be_read_count_as_missing() {
        let mut broken: &[u8] = b"not = [valid";
        assert!(read_carried_settings(&mut broken).unwrap().is_none());
        let mut settings: &[u8] = b"[vault]\nid = \"notes\"\ndisplay_name = \"Notes\"\n";
        let parsed = read_carried_settings(&mut settings).unwrap().unwrap();
        assert_eq!(parsed.config.vault.display_name, "Notes");
    }

    #[test]
    fn an_empty_layout_is_not_carried() {
        let mut empty: &[u8] = b"";
        assert!(read_carried_layout(&mut empty).unwrap().is_none());
    }
}
