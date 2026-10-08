//! Per-system workspace folders (`[workspace.<os>]` / vault `[mount.<os>]`).
//!
//! Each system stores its own place because `settings.toml` travels with the data
//! folder. App `place` starts `unset`: nothing is created until the user chooses
//! `beside` (workspace next to `.upriv`) or `custom` (`path`). The app has one
//! `file_manager_folder`, not one per system. It starts off. A system whose place is unset
//! creates nothing even when that flag is on. Plain text uses the place as the
//! real folder and ignores the flag. Phones do not mount a file manager folder.
//! A vault stores `app_file_manager_folder` and `custom_file_manager_folder` once. A path, when set,
//! replaces the app place on that system. An empty vault path inherits it.

use std::ffi::OsStr;
use std::ops::{Deref, DerefMut};
use std::path::{Component, Path, PathBuf};

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};

use crate::error::{Result, UprivError};

/// Standard child directories created under `<vault-root>/.upriv/` (not a mount parent).
/// The reserved check rejects the **entire** `.upriv/` tree, not only these names.
pub const RESERVED_UPRIV_WORKSPACE_CHILDREN: &[&str] = &["vaults", "logs", "app", "runtime"];

/// True when `path` is an address this file may store for some system.
///
/// Unix, Windows, and Android SAF shapes are all absolute here. The file is shared,
/// so a phone `content://` path must survive a save on a computer, and a Windows
/// path must survive a save on Linux.
pub fn is_absolute_filesystem_path(path: &Path) -> bool {
    path.to_str().is_some_and(is_absolute_workspace_address) || path.is_absolute()
}

pub fn is_absolute_workspace_address(path: &str) -> bool {
    let path = path.trim();
    if path.starts_with("content://") || path.starts_with('/') || path.starts_with(r"\\") {
        return true;
    }
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// Which computer or phone a workspace row belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceSystem {
    Linux,
    Windows,
    Macos,
    Android,
    Ios,
}

impl WorkspaceSystem {
    pub fn current() -> Self {
        match std::env::consts::OS {
            "windows" => Self::Windows,
            "macos" => Self::Macos,
            "android" => Self::Android,
            "ios" => Self::Ios,
            _ => Self::Linux,
        }
    }

    /// Desktop rows can turn on the encrypted file manager folder.
    pub fn has_shortcut(self) -> bool {
        matches!(self, Self::Linux | Self::Windows | Self::Macos)
    }

    pub fn all() -> [Self; 5] {
        [
            Self::Linux,
            Self::Windows,
            Self::Macos,
            Self::Android,
            Self::Ios,
        ]
    }
}

/// Where this system's workspace folder is.
///
/// `Unset` is the start: no folder. `Beside` is the data folder, so `workspace`
/// sits next to `.upriv`. `Custom` uses [`WorkspaceOsEntry::path`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WorkspacePlace {
    #[default]
    Unset,
    Beside,
    Custom,
}

impl WorkspacePlace {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unset => "unset",
            Self::Beside => "beside",
            Self::Custom => "custom",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "unset" => Some(Self::Unset),
            "beside" => Some(Self::Beside),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }
}

/// File manager folder used when this vault follows the app folder.
/// `inherit` follows the app file manager folder. `on` and `off` are this vault only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VaultShortcut {
    #[default]
    Inherit,
    On,
    Off,
}

/// One system's folder. The file manager folder flags live on [`WorkspaceTable`], not on the row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceOsEntry {
    pub place: WorkspacePlace,
    pub path: String,
}

impl WorkspaceOsEntry {
    fn empty() -> Self {
        Self {
            place: WorkspacePlace::Unset,
            path: String::new(),
        }
    }
}

/// App row after read. `beside` and `unset` are kept. A missing `place` with a
/// path is `custom`. An empty path is `unset`, not beside `.upriv`.
pub fn app_workspace_place(entry: &WorkspaceOsEntry) -> WorkspacePlace {
    match entry.place {
        WorkspacePlace::Beside => WorkspacePlace::Beside,
        WorkspacePlace::Unset => WorkspacePlace::Unset,
        WorkspacePlace::Custom if entry.path.trim().is_empty() => WorkspacePlace::Unset,
        WorkspacePlace::Custom => WorkspacePlace::Custom,
    }
}

/// Five workspace rows plus the file manager folder flags shared by every system.
///
/// `file_manager_folder` is the app flag. `app_file_manager_folder` and
/// `custom_file_manager_folder` belong to a vault. App rows leave the vault fields at
/// their defaults, and a vault leaves `file_manager_folder` false.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceTable {
    pub file_manager_folder: bool,
    pub app_file_manager_folder: VaultShortcut,
    pub custom_file_manager_folder: bool,
    pub linux: WorkspaceOsEntry,
    pub windows: WorkspaceOsEntry,
    pub macos: WorkspaceOsEntry,
    pub android: WorkspaceOsEntry,
    pub ios: WorkspaceOsEntry,
}

impl WorkspaceTable {
    /// Every path empty. App file manager folder off. Vault `app_file_manager_folder` is `inherit`.
    pub fn app() -> Self {
        Self::empty()
    }

    /// Same empty table as [`Self::app`].
    pub fn vault() -> Self {
        Self::empty()
    }

    fn empty() -> Self {
        Self {
            file_manager_folder: false,
            app_file_manager_folder: VaultShortcut::Inherit,
            custom_file_manager_folder: false,
            linux: WorkspaceOsEntry::empty(),
            windows: WorkspaceOsEntry::empty(),
            macos: WorkspaceOsEntry::empty(),
            android: WorkspaceOsEntry::empty(),
            ios: WorkspaceOsEntry::empty(),
        }
    }

    pub fn row(&self, system: WorkspaceSystem) -> &WorkspaceOsEntry {
        match system {
            WorkspaceSystem::Linux => &self.linux,
            WorkspaceSystem::Windows => &self.windows,
            WorkspaceSystem::Macos => &self.macos,
            WorkspaceSystem::Android => &self.android,
            WorkspaceSystem::Ios => &self.ios,
        }
    }

    pub fn row_mut(&mut self, system: WorkspaceSystem) -> &mut WorkspaceOsEntry {
        match system {
            WorkspaceSystem::Linux => &mut self.linux,
            WorkspaceSystem::Windows => &mut self.windows,
            WorkspaceSystem::Macos => &mut self.macos,
            WorkspaceSystem::Android => &mut self.android,
            WorkspaceSystem::Ios => &mut self.ios,
        }
    }
}

impl Default for WorkspaceTable {
    fn default() -> Self {
        Self::app()
    }
}

impl Serialize for WorkspaceTable {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("WorkspaceTable", 6)?;
        state.serialize_field("file_manager_folder", &self.file_manager_folder)?;
        serialize_app_row(&mut state, "linux", &self.linux)?;
        serialize_app_row(&mut state, "windows", &self.windows)?;
        serialize_app_row(&mut state, "macos", &self.macos)?;
        serialize_app_row(&mut state, "android", &self.android)?;
        serialize_app_row(&mut state, "ios", &self.ios)?;
        state.end()
    }
}

fn serialize_app_row<S: serde::ser::SerializeStruct>(
    state: &mut S,
    name: &'static str,
    entry: &WorkspaceOsEntry,
) -> std::result::Result<(), S::Error> {
    let place = app_workspace_place(entry);
    let path = if place == WorkspacePlace::Custom {
        entry.path.trim()
    } else {
        ""
    };
    state.serialize_field(
        name,
        &OsOut {
            place: place.as_str(),
            path,
        },
    )
}

#[derive(Serialize)]
struct OsOut<'a> {
    place: &'a str,
    path: &'a str,
}

/// App `[workspace]` table. `WorkspaceTable::default` is the app table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(transparent)]
pub struct WorkspaceSettings(pub WorkspaceTable);

impl Deref for WorkspaceSettings {
    type Target = WorkspaceTable;
    fn deref(&self) -> &WorkspaceTable {
        &self.0
    }
}

impl DerefMut for WorkspaceSettings {
    fn deref_mut(&mut self) -> &mut WorkspaceTable {
        &mut self.0
    }
}

impl<'de> Deserialize<'de> for WorkspaceSettings {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let raw = RawWorkspace::deserialize(deserializer)?;
        Ok(Self(table_from_raw(raw)))
    }
}

/// Vault `[mount]` table. Empty path follows the app place. `app_file_manager_folder` and
/// `custom_file_manager_folder` are stored once for every system. `app_file_manager_folder` is
/// `inherit`, `on`, or `off` for Use the app folder and starts `inherit`.
/// `custom_file_manager_folder` is the on/off switch for Another folder and starts off.
/// Rows store `path` only.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VaultMountSection(pub WorkspaceTable);

impl Serialize for VaultMountSection {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("VaultMountSection", 7)?;
        state.serialize_field("app_file_manager_folder", &self.app_file_manager_folder)?;
        state.serialize_field(
            "custom_file_manager_folder",
            &self.custom_file_manager_folder,
        )?;
        serialize_vault_row(&mut state, "linux", &self.linux)?;
        serialize_vault_row(&mut state, "windows", &self.windows)?;
        serialize_vault_row(&mut state, "macos", &self.macos)?;
        serialize_vault_row(&mut state, "android", &self.android)?;
        serialize_vault_row(&mut state, "ios", &self.ios)?;
        state.end()
    }
}

fn serialize_vault_row<S: serde::ser::SerializeStruct>(
    state: &mut S,
    name: &'static str,
    entry: &WorkspaceOsEntry,
) -> std::result::Result<(), S::Error> {
    state.serialize_field(
        name,
        &VaultOsOut {
            path: entry.path.trim(),
        },
    )
}

#[derive(Serialize)]
struct VaultOsOut<'a> {
    path: &'a str,
}

impl Deref for VaultMountSection {
    type Target = WorkspaceTable;
    fn deref(&self) -> &WorkspaceTable {
        &self.0
    }
}

impl DerefMut for VaultMountSection {
    fn deref_mut(&mut self) -> &mut WorkspaceTable {
        &mut self.0
    }
}

impl<'de> Deserialize<'de> for VaultMountSection {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let raw = VaultRawWorkspace::deserialize(deserializer)?;
        Ok(Self(table_from_vault_raw(raw)))
    }
}

#[derive(Deserialize)]
struct RawWorkspace {
    #[serde(default)]
    file_manager_folder: bool,
    #[serde(default)]
    linux: RawOs,
    #[serde(default)]
    windows: RawOs,
    #[serde(default)]
    macos: RawOs,
    #[serde(default)]
    android: RawOs,
    #[serde(default)]
    ios: RawOs,
}

#[derive(Deserialize, Default)]
struct RawOs {
    #[serde(default)]
    place: String,
    #[serde(default)]
    path: String,
}

#[derive(Deserialize)]
struct VaultRawWorkspace {
    #[serde(default)]
    app_file_manager_folder: VaultShortcut,
    #[serde(default)]
    custom_file_manager_folder: bool,
    #[serde(default)]
    linux: VaultRawOs,
    #[serde(default)]
    windows: VaultRawOs,
    #[serde(default)]
    macos: VaultRawOs,
    #[serde(default)]
    android: VaultRawOs,
    #[serde(default)]
    ios: VaultRawOs,
}

#[derive(Deserialize, Default)]
struct VaultRawOs {
    #[serde(default)]
    path: String,
}

fn table_from_vault_raw(raw: VaultRawWorkspace) -> WorkspaceTable {
    let mut table = WorkspaceTable::empty();
    table.app_file_manager_folder = raw.app_file_manager_folder;
    table.custom_file_manager_folder = raw.custom_file_manager_folder;
    let rows = [
        (WorkspaceSystem::Linux, raw.linux),
        (WorkspaceSystem::Windows, raw.windows),
        (WorkspaceSystem::Macos, raw.macos),
        (WorkspaceSystem::Android, raw.android),
        (WorkspaceSystem::Ios, raw.ios),
    ];
    for (system, row) in rows {
        let entry = table.row_mut(system);
        entry.path = row.path.trim().to_string();
        entry.place = WorkspacePlace::Unset;
    }
    table
}

fn table_from_raw(raw: RawWorkspace) -> WorkspaceTable {
    let mut table = WorkspaceTable::empty();
    let rows = [
        (WorkspaceSystem::Linux, raw.linux),
        (WorkspaceSystem::Windows, raw.windows),
        (WorkspaceSystem::Macos, raw.macos),
        (WorkspaceSystem::Android, raw.android),
        (WorkspaceSystem::Ios, raw.ios),
    ];
    table.file_manager_folder = raw.file_manager_folder;
    for (system, row) in rows {
        let entry = table.row_mut(system);
        let path = row.path.trim().to_string();
        let place = match WorkspacePlace::parse(&row.place) {
            Some(WorkspacePlace::Beside) => WorkspacePlace::Beside,
            Some(WorkspacePlace::Custom) | None if !path.is_empty() => WorkspacePlace::Custom,
            _ => WorkspacePlace::Unset,
        };
        entry.place = place;
        entry.path = if place == WorkspacePlace::Custom {
            path
        } else {
            String::new()
        };
    }
    table
}

/// Parent directory.
///
/// A vault path wins, and that file manager folder sits at the parent's root. Otherwise
/// `beside` is the data folder and `custom` is the app path, and the file manager folder
/// sits in `workspace` there. `unset` returns an empty string.
pub fn resolved_workspace_parent(
    app: &WorkspaceTable,
    vault: &WorkspaceTable,
    system: WorkspaceSystem,
    vault_root: &Path,
) -> String {
    let vault_path = vault.row(system).path.trim().trim_end_matches(['/', '\\']);
    if !vault_path.is_empty() {
        return vault_path.to_string();
    }
    match app_workspace_place(app.row(system)) {
        WorkspacePlace::Unset => String::new(),
        WorkspacePlace::Beside => vault_root
            .to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .to_string(),
        WorkspacePlace::Custom => app
            .row(system)
            .path
            .trim()
            .trim_end_matches(['/', '\\'])
            .to_string(),
    }
}

/// Encrypted file manager folder for this system.
///
/// The app flag and the two vault flags are shared. This system's place and
/// path decide whether they apply. An empty vault path follows the app file manager folder
/// unless this vault set `on` or `off`. `on` still needs a chosen app place.
/// A vault path of its own uses `custom_file_manager_folder` alone. Unset creates nothing.
pub fn encrypted_shortcut_active(
    app: &WorkspaceTable,
    vault: &WorkspaceTable,
    system: WorkspaceSystem,
) -> bool {
    if !system.has_shortcut() {
        return false;
    }
    let app_row = app.row(system);
    let vault_row = vault.row(system);
    if !vault_row.path.trim().is_empty() {
        return vault.custom_file_manager_folder;
    }
    if matches!(app_workspace_place(app_row), WorkspacePlace::Unset) {
        return false;
    }
    match vault.app_file_manager_folder {
        VaultShortcut::Off => false,
        VaultShortcut::On => true,
        VaultShortcut::Inherit => app.file_manager_folder,
    }
}

/// Whether `candidate` contains a `.upriv` path segment (case-insensitive),
/// independent of vault-root.
///
/// The entire `.upriv/` tree is reserved. A storage-access address is checked
/// after percent-decoding, so `…%2F.upriv` is the same reserved tree.
pub fn path_is_under_reserved_upriv_tree(candidate: &Path) -> bool {
    if let Some(text) = candidate.to_str() {
        let text = text.trim();
        if text.len() >= "content://".len()
            && text[.."content://".len()].eq_ignore_ascii_case("content://")
        {
            return content_uri_has_reserved_upriv_segment(text);
        }
        return text
            .split(['/', '\\'])
            .any(|part| part.eq_ignore_ascii_case(".upriv"));
    }
    candidate
        .components()
        .any(|c| matches!(c, Component::Normal(n) if os_str_eq_ignore_ascii_case(n, ".upriv")))
}

/// Decoded tree and document ids. `primary:Upriv` is the data folder.
/// `primary:.upriv` and `…/.upriv` are the ciphertext tree.
fn content_uri_has_reserved_upriv_segment(uri: &str) -> bool {
    let mut decoded = uri.to_string();
    for _ in 0..2 {
        let next = percent_decode_once(&decoded);
        if next == decoded {
            break;
        }
        decoded = next;
    }
    decoded.split(['/', '\\']).any(segment_is_reserved_upriv)
}

fn segment_is_reserved_upriv(segment: &str) -> bool {
    if segment.eq_ignore_ascii_case(".upriv") {
        return true;
    }
    segment
        .rsplit(':')
        .next()
        .is_some_and(|tail| tail.eq_ignore_ascii_case(".upriv"))
}

fn percent_decode_once(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(decoded) = hex_byte(bytes[index + 1], bytes[index + 2]) {
                out.push(decoded);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_byte(hi: u8, lo: u8) -> Option<u8> {
    Some(from_hex(hi)? << 4 | from_hex(lo)?)
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Whether `candidate` is `<vault_root>/.upriv` or anything under it.
pub fn is_reserved_upriv_workspace_path(candidate: &Path, vault_root: &Path) -> bool {
    let Ok(upriv) = vault_root.join(".upriv").canonicalize() else {
        // Fall back to lexical compare when paths do not exist yet.
        return is_reserved_upriv_workspace_path_lexical(candidate, vault_root);
    };
    let Ok(cand) = candidate.canonicalize() else {
        return is_reserved_upriv_workspace_path_lexical(candidate, vault_root);
    };
    cand == upriv || cand.starts_with(&upriv)
}

fn is_reserved_upriv_workspace_path_lexical(candidate: &Path, vault_root: &Path) -> bool {
    paths_equal_or_under_casefold(candidate, &vault_root.join(".upriv"))
}

/// Lexical prefix match with ASCII casefold on `Normal` components (parity with TS
/// `toLowerCase()` when canonicalize is unavailable — Windows/macOS volumes).
fn paths_equal_or_under_casefold(candidate: &Path, prefix: &Path) -> bool {
    let c: Vec<_> = candidate.components().collect();
    let p: Vec<_> = prefix.components().collect();
    if c.len() < p.len() {
        return false;
    }
    c.iter()
        .zip(p.iter())
        .all(|(a, b)| components_eq_ignore_ascii_case(a, b))
}

fn components_eq_ignore_ascii_case(a: &Component<'_>, b: &Component<'_>) -> bool {
    match (a, b) {
        (Component::Normal(a), Component::Normal(b)) => a.eq_ignore_ascii_case(b),
        _ => a == b,
    }
}

fn os_str_eq_ignore_ascii_case(os: &OsStr, ascii: &str) -> bool {
    os.eq_ignore_ascii_case(OsStr::new(ascii))
}

/// Validate app `[workspace].path`. Empty is allowed (unset).
pub fn validate_workspace_global_path(path: &str, vault_root: Option<&Path>) -> Result<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(trimmed);
    if !is_absolute_filesystem_path(&path) {
        return Err(UprivError::WorkspacePathInvalid {
            path,
            detail: "workspace path must be absolute".into(),
        });
    }
    // Always reject absolute paths under any `.upriv/` tree
    // (default_root serialize / SAF without a resolvable FS root).
    if path_is_under_reserved_upriv_tree(&path) {
        return Err(UprivError::WorkspacePathReserved(path));
    }
    if let Some(root) = vault_root {
        if is_reserved_upriv_workspace_path(&path, root) {
            return Err(UprivError::WorkspacePathReserved(path));
        }
    }
    Ok(())
}

/// Validate every path in a workspace table. Empty is unset.
pub fn validate_workspace_table(table: &WorkspaceTable, vault_root: Option<&Path>) -> Result<()> {
    for system in WorkspaceSystem::all() {
        validate_workspace_global_path(&table.row(system).path, vault_root)?;
    }
    Ok(())
}

/// Full mount point when `parent` is set.
///
/// The app folder puts the file manager folder in `{parent}/workspace/{display_name}`.
/// A vault's own folder puts it at the root: `{parent}/{display_name}`.
pub fn resolve_vault_mount_point(
    parent: &str,
    display_name: &str,
    own_folder: bool,
) -> Option<PathBuf> {
    let parent = parent.trim().trim_end_matches(['/', '\\']);
    if parent.is_empty() {
        return None;
    }
    let leaf = crate::paths::sanitize_display_leaf(display_name);
    let base = PathBuf::from(parent);
    Some(if own_folder {
        base.join(leaf)
    } else {
        base.join("workspace").join(leaf)
    })
}

/// Suggested default for `[workspace].path`: `<vault_root>/workspace`.
pub fn suggested_default_workspace_path(vault_root: &Path) -> PathBuf {
    vault_root.join("workspace")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_global_ok() {
        validate_workspace_global_path("", None).unwrap();
        validate_workspace_global_path("  ", None).unwrap();
    }

    #[test]
    fn relative_global_rejected() {
        let err = validate_workspace_global_path("workspace", None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathInvalid { .. }));
    }

    #[test]
    fn reserved_under_upriv() {
        let root = Path::new("/data/root");
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv/vaults"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv/logs/x"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv/workspace"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.upriv"),
            root
        ));
        assert!(!is_reserved_upriv_workspace_path(
            Path::new("/data/root/workspace"),
            root
        ));
    }

    #[test]
    fn reserved_lexical_casefold() {
        let root = Path::new("/data/Root");
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/root/.Upriv/Vaults"),
            root
        ));
        assert!(is_reserved_upriv_workspace_path(
            Path::new("/data/ROOT/.upriv/LOGS/x"),
            root
        ));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.Upriv/Vaults/x"
        )));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.upriv/workspace"
        )));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "/tmp/foo/.upriv"
        )));
        let err = validate_workspace_global_path("/tmp/foo/.upriv/vaults/x", None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathReserved(_)));
        let err = validate_workspace_global_path("/tmp/foo/.upriv", None).unwrap_err();
        assert!(matches!(err, UprivError::WorkspacePathReserved(_)));
    }

    #[test]
    fn resolve_parent_and_point() {
        assert!(resolve_vault_mount_point("", "Notes", false).is_none());
        assert_eq!(
            resolve_vault_mount_point("/home/me/Documents", "test", true).unwrap(),
            PathBuf::from("/home/me/Documents/test")
        );
        assert_eq!(
            resolve_vault_mount_point("/global", "Notes", false).unwrap(),
            PathBuf::from("/global/workspace/Notes")
        );
        assert_eq!(
            suggested_default_workspace_path(Path::new("/data/root")),
            PathBuf::from("/data/root/workspace")
        );
        assert!(
            validate_workspace_global_path("content://com.android/tree/primary%3AUpriv", None)
                .is_ok()
        );
        assert!(validate_workspace_global_path(r"C:\Users\me\workspace", None).is_ok());
        assert!(validate_workspace_global_path(
            "content://com.android/tree/primary%3AUpriv%2F.upriv",
            None
        )
        .is_err());
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "content://com.android/tree/primary%3A.upriv"
        )));
        assert!(path_is_under_reserved_upriv_tree(Path::new(
            "content://com.android/tree/primary%253A%252Eupriv"
        )));
        assert!(!path_is_under_reserved_upriv_tree(Path::new(
            "content://com.android/tree/primary%3AUpriv"
        )));
    }

    #[test]
    fn effective_path_and_shortcut_gate() {
        let mut app = WorkspaceTable::app();
        app.linux.place = WorkspacePlace::Custom;
        app.linux.path = "/app".into();
        app.file_manager_folder = true;
        let mut vault = WorkspaceTable::vault();
        assert!(encrypted_shortcut_active(
            &app,
            &vault,
            WorkspaceSystem::Linux
        ));
        vault.app_file_manager_folder = VaultShortcut::Off;
        assert!(!encrypted_shortcut_active(
            &app,
            &vault,
            WorkspaceSystem::Linux
        ));
        vault.app_file_manager_folder = VaultShortcut::On;
        app.file_manager_folder = false;
        assert!(encrypted_shortcut_active(
            &app,
            &vault,
            WorkspaceSystem::Linux
        ));
        app.file_manager_folder = true;
        assert_eq!(
            resolved_workspace_parent(
                &app,
                &vault,
                WorkspaceSystem::Linux,
                Path::new("/data/root"),
            ),
            "/app"
        );
        vault.linux.path = "/vault".into();
        assert_eq!(
            resolved_workspace_parent(
                &app,
                &vault,
                WorkspaceSystem::Linux,
                Path::new("/data/root"),
            ),
            "/vault"
        );
        let inherited: VaultMountSection =
            toml::from_str("app_file_manager_folder = \"inherit\"\n").unwrap();
        assert_eq!(inherited.app_file_manager_folder, VaultShortcut::Inherit);
        let forced_off: VaultMountSection =
            toml::from_str("app_file_manager_folder = \"off\"\n").unwrap();
        assert_eq!(forced_off.app_file_manager_folder, VaultShortcut::Off);
        vault.linux.path = "/vault".into();
        vault.custom_file_manager_folder = false;
        assert!(!encrypted_shortcut_active(
            &app,
            &vault,
            WorkspaceSystem::Linux
        ));
        vault.custom_file_manager_folder = true;
        app.file_manager_folder = false;
        assert!(encrypted_shortcut_active(
            &app,
            &vault,
            WorkspaceSystem::Linux
        ));
        app.file_manager_folder = true;
        assert!(encrypted_shortcut_active(
            &app,
            &vault,
            WorkspaceSystem::Linux
        ));
        let both: VaultMountSection = toml::from_str(
            "app_file_manager_folder = \"inherit\"\ncustom_file_manager_folder = true\n\n[linux]\npath = \"/vault\"\n",
        )
        .unwrap();
        assert_eq!(both.app_file_manager_folder, VaultShortcut::Inherit);
        assert!(both.custom_file_manager_folder);
        assert_eq!(both.linux.path, "/vault");
        let written = toml::to_string(&both).unwrap();
        assert!(written.contains("app_file_manager_folder = \"inherit\""));
        assert!(written.contains("custom_file_manager_folder = true"));
        assert!(written.contains("path = \"/vault\""));
        app.file_manager_folder = true;
        let mut beside = WorkspaceTable::app();
        beside.linux.place = WorkspacePlace::Beside;
        beside.file_manager_folder = true;
        assert!(encrypted_shortcut_active(
            &beside,
            &WorkspaceTable::vault(),
            WorkspaceSystem::Linux
        ));
        assert_eq!(
            resolved_workspace_parent(
                &beside,
                &WorkspaceTable::vault(),
                WorkspaceSystem::Linux,
                Path::new("/data/root"),
            ),
            "/data/root"
        );
        let mut unset = WorkspaceTable::app();
        unset.file_manager_folder = true;
        assert!(!encrypted_shortcut_active(
            &unset,
            &WorkspaceTable::vault(),
            WorkspaceSystem::Linux
        ));
        assert_eq!(
            resolved_workspace_parent(
                &unset,
                &WorkspaceTable::vault(),
                WorkspaceSystem::Linux,
                Path::new("/data/root"),
            ),
            ""
        );
        assert_eq!(
            resolved_workspace_parent(
                &app,
                &WorkspaceTable::vault(),
                WorkspaceSystem::Linux,
                Path::new("/data/root"),
            ),
            "/app"
        );
        assert!(!encrypted_shortcut_active(
            &app,
            &vault,
            WorkspaceSystem::Android
        ));
    }

    #[test]
    fn place_roundtrip_and_shortcut_starts_off() {
        let settings: WorkspaceSettings = toml::from_str(
            "file_manager_folder = false\n\n[linux]\nplace = \"custom\"\npath = \"/home/me/workspace\"\n",
        )
        .unwrap();
        assert_eq!(settings.linux.path, "/home/me/workspace");
        assert_eq!(settings.linux.place, WorkspacePlace::Custom);
        assert!(!settings.file_manager_folder);
        let body = toml::to_string(&settings).unwrap();
        let again: WorkspaceSettings = toml::from_str(&body).unwrap();
        assert_eq!(again.linux.path, "/home/me/workspace");
        assert_eq!(again.linux.place, WorkspacePlace::Custom);
        assert!(body.contains("place = \"custom\""));
        assert!(body.contains("file_manager_folder = false"));
        let fresh = toml::to_string(&WorkspaceSettings::default()).unwrap();
        assert!(fresh.contains("place = \"unset\""));
        let beside: WorkspaceSettings = toml::from_str(
            "file_manager_folder = true\n\n[linux]\nplace = \"beside\"\npath = \"/stale\"\n",
        )
        .unwrap();
        assert_eq!(beside.linux.place, WorkspacePlace::Beside);
        assert!(beside.linux.path.is_empty());
        assert!(beside.file_manager_folder);
        let explicit_unset: WorkspaceSettings = toml::from_str(
            "file_manager_folder = true\n\n[linux]\nplace = \"unset\"\npath = \"/stale\"\n",
        )
        .unwrap();
        assert_eq!(explicit_unset.linux.place, WorkspacePlace::Unset);
        assert!(explicit_unset.linux.path.is_empty());
        assert!(explicit_unset.file_manager_folder);
        let ignored: WorkspaceSettings = toml::from_str("path = \"/home/me/workspace\"\n").unwrap();
        assert!(ignored.linux.path.is_empty());
        assert_eq!(ignored.linux.place, WorkspacePlace::Unset);
    }
}
