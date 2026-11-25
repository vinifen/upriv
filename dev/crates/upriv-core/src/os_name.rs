//! The name this device's OS gives itself ("Ubuntu 24.04.5 LTS", "Windows 11
//! Pro", "macOS 15.1", "Android 15 (One UI 7.0)"), and the table of the
//! names each device reported.
//!
//! The name comes from the OS's description of itself, never from the name
//! of the computer or phone. Each device writes only its own line: into a
//! data folder's `settings.toml` when that data folder comes into use, and
//! into the data folder list while the list holds its group. A save from the
//! UI never carries a line. The screen names a device by its line (or its
//! system when it has none) and the start of its ID.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use serde::de::IgnoredAny;
use serde::{Deserialize, Deserializer, Serialize};

use crate::device::{DeviceId, ThisDevice};

/// Longest OS name kept, in characters.
pub const OS_NAME_MAX_CHARS: usize = 64;

/// `name` as it is kept: every run of white space or control characters
/// becomes one space, the ends are trimmed, and at most
/// [`OS_NAME_MAX_CHARS`] characters stay. `None` when nothing is left.
pub fn clean_os_name(name: &str) -> Option<String> {
    let joined = name
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let kept: String = joined.chars().take(OS_NAME_MAX_CHARS).collect();
    let kept = kept.trim_end();
    (!kept.is_empty()).then(|| kept.to_string())
}

/// This device's OS name, read once per process. `None` when the OS gives
/// nothing usable: the device keeps the name it wrote before, or the screen
/// names it by its system.
pub fn this_os_name() -> Option<&'static str> {
    static NAME: OnceLock<Option<String>> = OnceLock::new();
    NAME.get_or_init(|| read_os_name().as_deref().and_then(clean_os_name))
        .as_deref()
}

/// The OS name each device reported, by device ID: `[os_names]` of a data
/// folder's `settings.toml` and of the data folder list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct OsNames(BTreeMap<DeviceId, String>);

impl OsNames {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn get(&self, id: &DeviceId) -> Option<&str> {
        self.0.get(id).map(String::as_str)
    }

    /// Set this device's line to `name`. True when the table changed. A read
    /// that gives no name keeps the line as it is, so a name read once stays
    /// through a run that could not read it. A device with no ID changes
    /// nothing.
    pub fn note_here(&mut self, device: &ThisDevice, name: Option<&str>) -> bool {
        let (Some(id), Some(name)) = (device.id.as_ref(), name.and_then(clean_os_name)) else {
            return false;
        };
        if self.0.get(id) == Some(&name) {
            return false;
        }
        self.0.insert(id.clone(), name);
        true
    }

    /// Keep only the lines of the devices `keep` names.
    pub fn retain_devices(&mut self, keep: impl Fn(&DeviceId) -> bool) {
        self.0.retain(|id, _| keep(id));
    }
}

/// A line that is not a device ID with a name, or a table that is not one,
/// reads as no line: a name only labels a device, so it never makes its file
/// unreadable.
impl<'de> Deserialize<'de> for OsNames {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Table {
            Lines(BTreeMap<String, Line>),
            Other(IgnoredAny),
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Line {
            Name(String),
            Other(IgnoredAny),
        }

        let Table::Lines(lines) = Table::deserialize(deserializer)? else {
            return Ok(Self::default());
        };
        Ok(Self(
            lines
                .into_iter()
                .filter_map(|(id, line)| match line {
                    Line::Name(name) => Some((DeviceId::parse(&id)?, clean_os_name(&name)?)),
                    Line::Other(_) => None,
                })
                .collect(),
        ))
    }
}

/// The data folder at `root` came into use: this device's OS name goes into
/// its `settings.toml`, and into the data folder list when that holds this
/// device's group. Each file is written only when its line says something
/// else. A name only labels the device, so a failure is logged and nothing
/// else stops.
pub fn note_os_name(root: &Path) {
    let noted = crate::config::note_os_name_in_settings(root).and_then(|()| {
        let home = crate::paths::app_home_dir()?;
        crate::folder_list::data_folder::note_os_name_in_list(&home)
    });
    if let Err(error) = noted {
        crate::logging::log_event(
            crate::logging::LogLevel::Warn,
            "os_name_not_noted",
            &[(
                "reason",
                crate::folder_probe::FolderState::of_failure(&error).as_str(),
            )],
        );
    }
}

#[cfg(target_os = "linux")]
fn read_os_name() -> Option<String> {
    ["/etc/os-release", "/usr/lib/os-release"]
        .into_iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| os_release_name(&text))
}

/// The name an os-release(5) file gives: `PRETTY_NAME`, made for showing to
/// a person, or else `NAME` with `VERSION_ID`.
#[cfg(any(test, target_os = "linux"))]
fn os_release_name(text: &str) -> Option<String> {
    let fields: BTreeMap<&str, String> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim(), shell_unquote(value.trim())))
        .filter(|(_, value)| !value.is_empty())
        .collect();
    if let Some(pretty) = fields.get("PRETTY_NAME") {
        return Some(pretty.clone());
    }
    let name = fields.get("NAME")?;
    Some(match fields.get("VERSION_ID") {
        Some(version) => format!("{name} {version}"),
        None => name.clone(),
    })
}

/// An os-release value: bare, or in single or double quotes, where a
/// backslash keeps the next character.
#[cfg(any(test, target_os = "linux"))]
fn shell_unquote(value: &str) -> String {
    let quoted = |quote: char| {
        value
            .strip_prefix(quote)
            .and_then(|inner| inner.strip_suffix(quote))
    };
    if let Some(inner) = quoted('\'') {
        return inner.to_string();
    }
    let Some(inner) = quoted('"') else {
        return value.to_string();
    };
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.extend(chars.next()),
            c => out.push(c),
        }
    }
    out
}

#[cfg(windows)]
fn read_os_name() -> Option<String> {
    const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let product = crate::device::registry_string(KEY, "ProductName")?;
    let build = crate::device::registry_string(KEY, "CurrentBuildNumber")
        .and_then(|build| build.trim().parse().ok());
    Some(windows_name(&product, build))
}

/// First build of Windows 11.
#[cfg(any(test, windows))]
const FIRST_WINDOWS_11_BUILD: u32 = 22_000;

/// `ProductName` as the screen shows it. Windows 11 still names itself
/// "Windows 10" there; its build number tells it apart.
#[cfg(any(test, windows))]
fn windows_name(product: &str, build: Option<u32>) -> String {
    match product.strip_prefix("Windows 10") {
        Some(edition) if build.is_some_and(|build| build >= FIRST_WINDOWS_11_BUILD) => {
            format!("Windows 11{edition}")
        }
        _ => product.to_string(),
    }
}

#[cfg(target_os = "macos")]
fn read_os_name() -> Option<String> {
    std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist")
        .ok()
        .and_then(|plist| mac_os_name(&plist))
}

/// `ProductName` with `ProductVersion` of `SystemVersion.plist`.
#[cfg(any(test, target_os = "macos"))]
fn mac_os_name(plist: &str) -> Option<String> {
    let name = plist_string(plist, "ProductName")?;
    Some(match plist_string(plist, "ProductVersion") {
        Some(version) => format!("{name} {version}"),
        None => name,
    })
}

/// The `<string>` right after `<key>{key}</key>` in an XML property list.
#[cfg(any(test, target_os = "macos"))]
fn plist_string(plist: &str, key: &str) -> Option<String> {
    let (_, after) = plist.split_once(&format!("<key>{key}</key>"))?;
    let (value, _) = after
        .trim_start()
        .strip_prefix("<string>")?
        .split_once("</string>")?;
    let value = value
        .trim()
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&");
    (!value.is_empty()).then_some(value)
}

#[cfg(target_os = "android")]
fn read_os_name() -> Option<String> {
    android_name(
        &system_property("ro.build.version.release")?,
        system_property("ro.build.version.oneui").as_deref(),
        system_property("ro.product.manufacturer").as_deref(),
    )
}

/// A system property, through the NDK's `__system_property_get`.
#[cfg(target_os = "android")]
fn system_property(name: &str) -> Option<String> {
    let name = std::ffi::CString::new(name).ok()?;
    let mut value = [0 as libc::c_char; libc::PROP_VALUE_MAX as usize];
    let len = unsafe { libc::__system_property_get(name.as_ptr(), value.as_mut_ptr()) };
    if len <= 0 {
        return None;
    }
    // The value ends with a NUL inside the buffer, which starts zeroed.
    let text = unsafe { std::ffi::CStr::from_ptr(value.as_ptr()) }
        .to_str()
        .ok()?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// "Android 15 (One UI 7.0)" on a phone that gives its One UI version
/// (`ro.build.version.oneui`, `70000` for 7.0), "Android 15 (Xiaomi)" from
/// the maker on any other, "Android 15" with neither.
#[cfg(any(test, target_os = "android"))]
fn android_name(release: &str, one_ui: Option<&str>, maker: Option<&str>) -> Option<String> {
    let release = release.trim();
    if release.is_empty() {
        return None;
    }
    let skin = one_ui
        .and_then(one_ui_version)
        .or_else(|| maker.and_then(maker_name));
    Some(match skin {
        Some(skin) => format!("Android {release} ({skin})"),
        None => format!("Android {release}"),
    })
}

/// `70000` → "One UI 7.0", `60100` → "One UI 6.1".
#[cfg(any(test, target_os = "android"))]
fn one_ui_version(code: &str) -> Option<String> {
    let code: u32 = code.trim().parse().ok()?;
    let (major, minor) = (code / 10_000, code / 100 % 100);
    (major > 0).then(|| format!("One UI {major}.{minor}"))
}

/// The maker as a name: "samsung" → "Samsung", "OnePlus" stays.
#[cfg(any(test, target_os = "android"))]
fn maker_name(maker: &str) -> Option<String> {
    let mut chars = maker.trim().chars();
    let first = chars.next()?;
    Some(first.to_uppercase().chain(chars).collect())
}

/// iOS is not built yet; any other system gives no name.
#[cfg(not(any(
    target_os = "linux",
    windows,
    target_os = "macos",
    target_os = "android"
)))]
fn read_os_name() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::DeviceSystem;

    fn device(machine: &[u8]) -> ThisDevice {
        ThisDevice {
            id: Some(DeviceId::from_machine_id(machine)),
            run_id: "run".into(),
            system: DeviceSystem::Linux,
        }
    }

    #[test]
    fn a_name_is_one_line_of_at_most_64_characters() {
        assert_eq!(
            clean_os_name("  Ubuntu\t24.04.5\nLTS \u{7}"),
            Some("Ubuntu 24.04.5 LTS".to_string())
        );
        assert_eq!(clean_os_name(" \n\t"), None);
        let long = "x".repeat(OS_NAME_MAX_CHARS + 10);
        assert_eq!(
            clean_os_name(&long).map(|name| name.chars().count()),
            Some(OS_NAME_MAX_CHARS)
        );
        // A cut that ends on a space leaves none at the end.
        let spaced = format!("{} tail", "y".repeat(OS_NAME_MAX_CHARS - 1));
        assert_eq!(
            clean_os_name(&spaced),
            Some("y".repeat(OS_NAME_MAX_CHARS - 1))
        );
    }

    #[test]
    fn os_release_gives_its_pretty_name_or_its_name_and_version() {
        let ubuntu = "PRETTY_NAME=\"Ubuntu 24.04.5 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\n";
        assert_eq!(
            os_release_name(ubuntu),
            Some("Ubuntu 24.04.5 LTS".to_string())
        );
        let plain = "# comment\nNAME=Fedora\nVERSION_ID=41\nPRETTY_NAME=\n";
        assert_eq!(os_release_name(plain), Some("Fedora 41".to_string()));
        assert_eq!(
            os_release_name("NAME='Arch Linux'\n"),
            Some("Arch Linux".to_string())
        );
        assert_eq!(
            os_release_name("PRETTY_NAME=\"Say \\\"hi\\\" OS\"\n"),
            Some("Say \"hi\" OS".to_string())
        );
        assert_eq!(os_release_name("ID=ubuntu\n"), None);
    }

    #[test]
    fn windows_11_is_told_apart_by_its_build() {
        assert_eq!(
            windows_name("Windows 10 Pro", Some(22631)),
            "Windows 11 Pro"
        );
        assert_eq!(
            windows_name("Windows 10 Home", Some(19045)),
            "Windows 10 Home"
        );
        assert_eq!(windows_name("Windows 10 Pro", None), "Windows 10 Pro");
        assert_eq!(
            windows_name("Windows Server 2025 Standard", Some(26100)),
            "Windows Server 2025 Standard"
        );
    }

    #[test]
    fn macos_names_its_product_and_version() {
        let plist = "<?xml version=\"1.0\"?><plist><dict>\n\
            <key>ProductBuildVersion</key>\n<string>24B83</string>\n\
            <key>ProductName</key>\n\t<string>macOS</string>\n\
            <key>ProductVersion</key>\n<string>15.1</string>\n</dict></plist>";
        assert_eq!(mac_os_name(plist), Some("macOS 15.1".to_string()));
        assert_eq!(
            mac_os_name("<key>ProductName</key><string>A &amp; B</string>"),
            Some("A & B".to_string())
        );
        assert_eq!(
            mac_os_name("<key>ProductVersion</key><string>15</string>"),
            None
        );
    }

    #[test]
    fn android_names_its_release_and_one_ui_or_its_maker() {
        assert_eq!(
            android_name("15", Some("70000"), Some("samsung")),
            Some("Android 15 (One UI 7.0)".to_string())
        );
        assert_eq!(
            android_name("14", Some("60100"), None),
            Some("Android 14 (One UI 6.1)".to_string())
        );
        assert_eq!(
            android_name("15", None, Some("Xiaomi")),
            Some("Android 15 (Xiaomi)".to_string())
        );
        assert_eq!(
            android_name("15", Some("garbage"), Some("motorola")),
            Some("Android 15 (Motorola)".to_string())
        );
        assert_eq!(
            android_name("15", None, None),
            Some("Android 15".to_string())
        );
        assert_eq!(android_name(" ", Some("70000"), None), None);
    }

    #[test]
    fn a_device_writes_only_its_own_line_and_keeps_it_through_a_failed_read() {
        let here = device(b"desk");
        let mut names = OsNames::default();
        assert!(names.note_here(&here, Some("Ubuntu 24.04.5 LTS")));
        assert!(!names.note_here(&here, Some(" Ubuntu  24.04.5 LTS ")));
        assert_eq!(
            names.get(here.id.as_ref().unwrap()),
            Some("Ubuntu 24.04.5 LTS")
        );
        // A run that reads no name keeps the one written before.
        assert!(!names.note_here(&here, None));
        assert!(!names.note_here(&here, Some(" \n ")));
        assert_eq!(
            names.get(here.id.as_ref().unwrap()),
            Some("Ubuntu 24.04.5 LTS")
        );
        assert!(names.note_here(&here, Some("Ubuntu 26.04 LTS")));
        assert_eq!(
            names.get(here.id.as_ref().unwrap()),
            Some("Ubuntu 26.04 LTS")
        );

        let unknown = ThisDevice {
            id: None,
            ..device(b"desk")
        };
        let before = names.clone();
        assert!(!names.note_here(&unknown, Some("Windows 11 Pro")));
        assert_eq!(names, before);
    }

    #[test]
    fn a_line_that_is_no_name_reads_as_none() {
        let desk = device(b"desk").id.unwrap();
        let raw = format!(
            "[os_names]\n{desk} = \"Windows 11 Pro\"\nnot-an-id = \"Ubuntu\"\n\
             {laptop} = 7\n{phone} = \"  \"\n",
            laptop = device(b"laptop").id.unwrap().as_str(),
            phone = device(b"phone").id.unwrap().as_str(),
            desk = desk.as_str(),
        );
        #[derive(Deserialize)]
        struct File {
            os_names: OsNames,
        }
        let file: File = toml::from_str(&raw).unwrap();
        assert_eq!(file.os_names.get(&desk), Some("Windows 11 Pro"));
        assert_eq!(file.os_names.0.len(), 1);

        let file: File = toml::from_str("os_names = 3\n").unwrap();
        assert!(file.os_names.is_empty());
    }

    #[test]
    fn this_device_reads_its_os_once() {
        let first = this_os_name();
        assert_eq!(first, this_os_name());
        if let Some(name) = first {
            assert_eq!(clean_os_name(name).as_deref(), Some(name));
        }
    }
}
