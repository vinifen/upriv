//! This device's identity: the ID that names this machine or phone in every
//! folder list and record, and its system. No name of the computer or phone
//! is read or kept: the UI names a device by its system and the start of its
//! ID.
//!
//! The ID is the first 16 bytes of HMAC-SHA256 keyed by the OS machine ID over
//! [`DEVICE_ID_LABEL`], in lowercase hex: the app-specific hash machine-id(5)
//! asks for, so the stored ID cannot be matched with the machine ID other apps
//! see. Only the ID is ever stored. When the OS gives no machine ID, a random
//! ID kept in a file of the per-user app folder stands in. When neither is
//! available the device is unknown for that run: its lists are neither used
//! nor edited, and records and locks name the run instead.
//!
//! Phones pass the machine ID source once, when the platform module starts
//! ([`set_platform_identity`]).

use std::path::Path;
use std::sync::OnceLock;

use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// HMAC message that makes the ID Upriv's own.
pub const DEVICE_ID_LABEL: &[u8] = b"upriv-device-v1";
/// The fallback ID's file in the per-user app folder.
pub const DEVICE_ID_FILE: &str = "device-id";
/// Bytes of an ID; its text is twice as many hex characters.
const DEVICE_ID_BYTES: usize = 16;

/// The system a device runs. It decides which paths are valid for a device
/// group's rows, and whether the device can mount an encrypted vault's folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceSystem {
    Linux,
    Windows,
    Macos,
    Android,
    Ios,
}

impl DeviceSystem {
    /// The system this build runs on.
    pub fn current() -> Self {
        if cfg!(target_os = "android") {
            Self::Android
        } else if cfg!(target_os = "ios") {
            Self::Ios
        } else if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else {
            Self::Linux
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Linux => "linux",
            Self::Windows => "windows",
            Self::Macos => "macos",
            Self::Android => "android",
            Self::Ios => "ios",
        }
    }

    /// Desktop systems can show an encrypted vault as a folder; phones cannot
    /// mount one.
    pub fn mounts_folders(self) -> bool {
        matches!(self, Self::Linux | Self::Windows | Self::Macos)
    }
}

/// A device ID: 32 lowercase hex characters.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct DeviceId(String);

impl DeviceId {
    /// The ID a machine ID gives.
    pub fn from_machine_id(machine_id: &[u8]) -> Self {
        let (prk, _) = Hkdf::<Sha256>::extract(Some(machine_id), DEVICE_ID_LABEL);
        Self::from_bytes(&prk[..DEVICE_ID_BYTES])
    }

    /// A random ID, for a device whose OS gives no machine ID.
    fn random() -> Self {
        use rand::RngCore;
        let mut bytes = [0u8; DEVICE_ID_BYTES];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        Self::from_bytes(&bytes)
    }

    fn from_bytes(bytes: &[u8]) -> Self {
        Self(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
    }

    /// `text` when it is a well-formed ID.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let well_formed = text.len() == DEVICE_ID_BYTES * 2
            && text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        well_formed.then(|| Self(text.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for DeviceId {
    type Error = String;

    fn try_from(text: String) -> std::result::Result<Self, Self::Error> {
        Self::parse(&text).ok_or_else(|| format!("not a device ID: {text}"))
    }
}

impl From<DeviceId> for String {
    fn from(id: DeviceId) -> Self {
        id.0
    }
}

/// This device as the running process knows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThisDevice {
    /// `None` when neither the OS nor the fallback file gives an ID.
    pub id: Option<DeviceId>,
    /// Names this run in a record or a lock while the ID is unknown.
    pub run_id: String,
    pub system: DeviceSystem,
}

impl ThisDevice {
    fn new(id: Option<DeviceId>) -> Self {
        Self {
            id,
            run_id: uuid::Uuid::new_v4().simple().to_string(),
            system: DeviceSystem::current(),
        }
    }

    /// What a record or a lock body names: the ID, or this run while the ID
    /// is unknown.
    pub fn record_key(&self) -> String {
        match &self.id {
            Some(id) => id.as_str().to_string(),
            None => format!("run-{}", self.run_id),
        }
    }

    /// The fields of the log lines that name the device: `device` (the ID, or
    /// `unknown` with the run) and `system`.
    pub fn log_fields(&self) -> Vec<(&'static str, String)> {
        let mut fields = Vec::with_capacity(3);
        match &self.id {
            Some(id) => fields.push(("device", id.as_str().to_string())),
            None => {
                fields.push(("device", "unknown".to_string()));
                fields.push(("run", self.run_id.clone()));
            }
        }
        fields.push(("system", self.system.as_str().to_string()));
        fields
    }
}

static THIS_DEVICE: OnceLock<ThisDevice> = OnceLock::new();

/// Phones learn their identity from the platform module, never on their own.
const PLATFORM_SETS_IDENTITY: bool = cfg!(any(target_os = "android", target_os = "ios"));

/// This device. Desktop computes it on first use, once per process. A phone
/// reports an unknown device until the platform module set its identity,
/// which it does before anything else runs.
pub fn this_device() -> &'static ThisDevice {
    if let Some(device) = THIS_DEVICE.get() {
        return device;
    }
    if PLATFORM_SETS_IDENTITY {
        static NOT_SET: OnceLock<ThisDevice> = OnceLock::new();
        return NOT_SET.get_or_init(|| ThisDevice::new(None));
    }
    THIS_DEVICE.get_or_init(detect)
}

/// A phone's identity, from the platform module when it starts: the OS
/// machine ID source (`ANDROID_ID`). An empty one leaves the device unknown.
/// Set once per process; a later call (a reload of the JavaScript side)
/// changes nothing. False on a desktop, which reads its own identity.
pub fn set_platform_identity(machine_id: &str) -> bool {
    if !PLATFORM_SETS_IDENTITY {
        return false;
    }
    let machine_id = machine_id.trim();
    let id = (!machine_id.is_empty()).then(|| DeviceId::from_machine_id(machine_id.as_bytes()));
    let _ = THIS_DEVICE.set(ThisDevice::new(id));
    true
}

fn detect() -> ThisDevice {
    let id = match os_machine_id() {
        Some(machine_id) => Some(DeviceId::from_machine_id(&machine_id)),
        None => crate::paths::resolve_user_data_app_home()
            .ok()
            .and_then(|home| fallback_id(&home)),
    };
    ThisDevice::new(id)
}

/// The fallback ID kept in `home`, made on first use. `None` when the file
/// can be neither read nor written.
fn fallback_id(home: &Path) -> Option<DeviceId> {
    let path = home.join(DEVICE_ID_FILE);
    if let Ok(text) = crate::host_fs::read_to_string(&path) {
        if let Some(id) = DeviceId::parse(&text) {
            return Some(id);
        }
    }
    let id = DeviceId::random();
    crate::host_fs::create_dir_all(home).ok()?;
    crate::paths::write_bytes_atomic(&path, id.as_str().as_bytes()).ok()?;
    Some(id)
}

/// The OS machine ID, or `None` when this system gives none.
#[cfg(target_os = "linux")]
fn os_machine_id() -> Option<Vec<u8>> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .into_iter()
        .find_map(|path| linux_machine_id(Path::new(path)))
}

/// A systemd machine ID file: 32 hex characters. An empty file, or
/// `uninitialized` on a first boot, gives none.
#[cfg(any(test, target_os = "linux"))]
fn linux_machine_id(path: &Path) -> Option<Vec<u8>> {
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim();
    let well_formed = text.len() == 32 && text.bytes().all(|byte| byte.is_ascii_hexdigit());
    well_formed.then(|| text.to_ascii_lowercase().into_bytes())
}

/// `MachineGuid` under `HKLM\SOFTWARE\Microsoft\Cryptography`, read from the
/// 64-bit view also by a 32-bit process.
#[cfg(windows)]
fn os_machine_id() -> Option<Vec<u8>> {
    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            key: *mut core::ffi::c_void,
            sub_key: *const u16,
            value: *const u16,
            flags: u32,
            kind: *mut u32,
            data: *mut core::ffi::c_void,
            data_len: *mut u32,
        ) -> i32;
    }
    const HKEY_LOCAL_MACHINE: isize = 0x8000_0002_u32 as i32 as isize;
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;
    const RRF_SUBKEY_WOW6464KEY: u32 = 0x0001_0000;
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let sub_key = wide(r"SOFTWARE\Microsoft\Cryptography");
    let value = wide("MachineGuid");
    let mut buf = [0u16; 128];
    let mut len = std::mem::size_of_val(&buf) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE as *mut core::ffi::c_void,
            sub_key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut core::ffi::c_void,
            &mut len,
        )
    };
    if status != 0 {
        return None;
    }
    let units = (len as usize / 2).min(buf.len());
    let text = String::from_utf16_lossy(&buf[..units]);
    let text = text.trim_end_matches('\0').trim();
    (!text.is_empty()).then(|| text.to_ascii_lowercase().into_bytes())
}

/// The hardware UUID (`IOPlatformUUID`), through `gethostuuid`.
#[cfg(target_os = "macos")]
fn os_machine_id() -> Option<Vec<u8>> {
    let mut uuid = [0u8; 16];
    let wait = libc::timespec {
        tv_sec: 5,
        tv_nsec: 0,
    };
    let rc = unsafe { libc::gethostuuid(uuid.as_mut_ptr(), &wait) };
    (rc == 0 && uuid.iter().any(|&byte| byte != 0)).then(|| uuid.to_vec())
}

/// Phones get theirs from the platform module ([`set_platform_identity`]).
#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
fn os_machine_id() -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_id_is_the_keyed_hash_of_the_machine_id() {
        // HMAC-SHA256(key = machine ID, message = "upriv-device-v1"), first 16 bytes.
        let id = DeviceId::from_machine_id(b"0f3a9c2e7d1b4a6c8e5f7a9b1c3d5e7f");
        assert_eq!(id.as_str(), "3e301fc022fc5185e12822bc2a251f64");
        let id = DeviceId::from_machine_id(b"4C4C4544-0035-3010-8052-B4C04F563033");
        assert_eq!(id.as_str(), "ea3e15d6856f514a97717e530ff60723");
    }

    #[test]
    fn only_32_lowercase_hex_characters_are_an_id() {
        assert!(DeviceId::parse("3e301fc022fc5185e12822bc2a251f64").is_some());
        assert!(DeviceId::parse(" 3e301fc022fc5185e12822bc2a251f64\n").is_some());
        assert!(DeviceId::parse("3E301FC022FC5185E12822BC2A251F64").is_none());
        assert!(DeviceId::parse("3e301fc022fc5185e12822bc2a251f6").is_none());
        assert!(DeviceId::parse("3e301fc022fc5185e12822bc2a251f6g").is_none());
        assert!(serde_json::from_str::<DeviceId>("\"not-an-id\"").is_err());
    }

    #[test]
    fn the_fallback_id_is_made_once_and_then_read_back() {
        let home = tempfile::tempdir().unwrap();
        let first = fallback_id(home.path()).expect("made");
        let second = fallback_id(home.path()).expect("read back");
        assert_eq!(first, second);
        let text = std::fs::read_to_string(home.path().join(DEVICE_ID_FILE)).unwrap();
        assert_eq!(text, first.as_str());
    }

    #[test]
    fn a_damaged_fallback_file_is_made_again() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join(DEVICE_ID_FILE), "garbage").unwrap();
        let id = fallback_id(home.path()).expect("made again");
        let text = std::fs::read_to_string(home.path().join(DEVICE_ID_FILE)).unwrap();
        assert_eq!(text, id.as_str());
    }

    #[test]
    fn a_fallback_that_cannot_be_written_leaves_the_device_unknown() {
        let home = tempfile::tempdir().unwrap();
        let blocked = home.path().join("file");
        std::fs::write(&blocked, b"a file, not a folder").unwrap();
        assert!(fallback_id(&blocked).is_none());
    }

    #[test]
    fn a_systemd_machine_id_is_32_hex_characters() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("machine-id");
        std::fs::write(&path, "0F3A9C2E7D1B4A6C8E5F7A9B1C3D5E7F\n").unwrap();
        assert_eq!(
            linux_machine_id(&path).unwrap(),
            b"0f3a9c2e7d1b4a6c8e5f7a9b1c3d5e7f"
        );
        std::fs::write(&path, "uninitialized\n").unwrap();
        assert!(linux_machine_id(&path).is_none());
        std::fs::write(&path, "").unwrap();
        assert!(linux_machine_id(&path).is_none());
    }

    #[test]
    fn an_unknown_device_names_its_run() {
        let device = ThisDevice::new(None);
        assert_eq!(device.record_key(), format!("run-{}", device.run_id));
        let fields = device.log_fields();
        assert_eq!(fields[0], ("device", "unknown".to_string()));
        assert_eq!(fields[1].0, "run");
        assert_eq!(fields[2].0, "system");

        let id = DeviceId::from_machine_id(b"machine");
        let known = ThisDevice::new(Some(id.clone()));
        assert_eq!(known.record_key(), id.as_str());
        // The ID and the system name the device; no name of the computer is kept.
        assert_eq!(
            known.log_fields(),
            vec![
                ("device", id.as_str().to_string()),
                ("system", known.system.as_str().to_string()),
            ]
        );
    }

    #[test]
    fn this_desktop_has_one_identity_per_process() {
        let first = this_device();
        assert_eq!(first.system, DeviceSystem::current());
        assert!(std::ptr::eq(first, this_device()));
        assert!(!set_platform_identity("anything"));
    }
}
