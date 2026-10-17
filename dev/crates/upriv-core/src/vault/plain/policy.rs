//! `.upriv-plain-policy.json` inside the store: the place the user agreed to
//! for this vault's plain files, per system. It is sealed with the vault, so
//! a copy of the data folder, a changed setting, or a moved vault cannot point
//! the files somewhere new without the user confirming it first.
//!
//! An unlock in encrypted mode forgets it: switching back to plain text asks
//! again.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::dest::PlaceSource;
use crate::error::Result;
use crate::paths::WorkspaceSystem;
use crate::session::OpenSession;
use crate::store::PLAIN_POLICY_FILE;
use crate::vault::fs::{read_internal, remove_internal, write_internal};

const POLICY_FORMAT: u32 = 1;
const POLICY_MAX_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "place", rename_all = "snake_case")]
enum ConfirmedPlace {
    /// `workspace/` in the data folder, wherever the data folder is mounted.
    DataFolder,
    /// The app's workspace path.
    App { path: String },
    /// This vault's own path.
    Vault { path: String },
}

impl From<&PlaceSource> for ConfirmedPlace {
    fn from(source: &PlaceSource) -> Self {
        match source {
            PlaceSource::DataFolder => Self::DataFolder,
            PlaceSource::App(path) => Self::App { path: path.clone() },
            PlaceSource::Vault(path) => Self::Vault { path: path.clone() },
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PolicyFile {
    format_version: u32,
    #[serde(default)]
    systems: BTreeMap<String, ConfirmedPlace>,
}

fn system_key(system: WorkspaceSystem) -> &'static str {
    match system {
        WorkspaceSystem::Linux => "linux",
        WorkspaceSystem::Windows => "windows",
        WorkspaceSystem::Macos => "macos",
        WorkspaceSystem::Android => "android",
        WorkspaceSystem::Ios => "ios",
    }
}

/// The stored policy. A missing, unreadable, or foreign file confirms nothing.
fn load(session: &OpenSession) -> PolicyFile {
    let Ok(Some(bytes)) = read_internal(session, PLAIN_POLICY_FILE) else {
        return PolicyFile::default();
    };
    if bytes.len() > POLICY_MAX_BYTES {
        return PolicyFile::default();
    }
    match serde_json::from_slice::<PolicyFile>(&bytes) {
        Ok(file) if file.format_version == POLICY_FORMAT => file,
        _ => PolicyFile::default(),
    }
}

/// True when the user already agreed to `source` on this system.
pub(super) fn is_confirmed(session: &OpenSession, source: &PlaceSource) -> bool {
    load(session)
        .systems
        .get(system_key(WorkspaceSystem::current()))
        .is_some_and(|confirmed| *confirmed == ConfirmedPlace::from(source))
}

/// Record `source` for this system. Nothing is written when it is already there.
pub(super) fn confirm(session: &mut OpenSession, source: &PlaceSource) -> Result<()> {
    let mut file = load(session);
    let key = system_key(WorkspaceSystem::current()).to_string();
    let wanted = ConfirmedPlace::from(source);
    if file.systems.get(&key) == Some(&wanted) && file.format_version == POLICY_FORMAT {
        return Ok(());
    }
    file.format_version = POLICY_FORMAT;
    file.systems.insert(key, wanted);
    let bytes =
        serde_json::to_vec(&file).map_err(|error| crate::error::UprivError::VaultStoreInvalid {
            path: PLAIN_POLICY_FILE.into(),
            detail: error.to_string(),
        })?;
    write_internal(session, PLAIN_POLICY_FILE, &bytes)
}

/// Drop every confirmed place.
pub(crate) fn forget(session: &mut OpenSession) -> Result<()> {
    remove_internal(session, PLAIN_POLICY_FILE)
}
