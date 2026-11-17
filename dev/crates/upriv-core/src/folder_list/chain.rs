//! The order Upriv tries a list's choices in when the folder in use fails,
//! and the walk down it. Pure: the caller tries each folder.
//!
//! Each list builds its own chain (rows first, then what its fixed choices
//! lead to). Only a failure of the folder itself moves the walk on; anything
//! else stops it where it is, and the selection stays.

use serde::Serialize;

use crate::folder_probe::FolderState;
use crate::logging::{log_event, LogLevel};

/// Which list a switch happened in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ListName {
    DataFolder,
    UnlockedFolder,
    Backup,
}

impl ListName {
    fn as_str(self) -> &'static str {
        match self {
            Self::DataFolder => "data_folder",
            Self::UnlockedFolder => "unlocked_folder",
            Self::Backup => "backup",
        }
    }
}

/// Whose selection a switch changes: the app's list or a vault's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    App,
    Vault,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Vault => "vault",
        }
    }
}

/// A choice as a switch names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChoiceName {
    Row { number: u32, name: String },
    Fixed { choice: &'static str },
    Nothing,
}

impl ChoiceName {
    /// The row number or the fixed choice, as the log names it: names are
    /// the person's words and stay out of the log.
    fn log_value(&self) -> String {
        match self {
            Self::Row { number, .. } => number.to_string(),
            Self::Fixed { choice } => (*choice).to_string(),
            Self::Nothing => "none".to_string(),
        }
    }
}

/// A selection that changed because its folder failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Switch {
    pub list: ListName,
    pub level: Level,
    /// The vault, for a vault's list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault: Option<String>,
    pub from: ChoiceName,
    pub to: ChoiceName,
    pub reason: FolderState,
    /// False when the switch holds for this run only: its file could not be
    /// written.
    pub saved: bool,
}

impl Switch {
    /// `folder_switched`, one line per selection that changed.
    pub(crate) fn log(&self) {
        let from = self.from.log_value();
        let to = self.to.log_value();
        let mut fields = vec![("list", self.list.as_str()), ("level", self.level.as_str())];
        if let Some(vault) = self.vault.as_deref() {
            fields.push(("id", vault));
        }
        fields.extend([
            ("from", from.as_str()),
            ("to", to.as_str()),
            ("reason", self.reason.as_str()),
            ("saved", if self.saved { "true" } else { "false" }),
        ]);
        log_event(LogLevel::Warn, "folder_switched", &fields);
    }
}

/// What trying one folder of a chain gave.
pub enum Try<T, E> {
    /// The folder works, and this is what using it produced.
    Works(T),
    /// The folder itself failed: the walk goes on.
    Fails(FolderState),
    /// Something that is not the folder's failed (a vault read error, a
    /// missing driver, a stop): the walk ends and nothing switches.
    Stop(E),
}

/// Where a failover ended.
pub enum Failover<'a, L, T, E> {
    /// The selected folder works.
    Kept(T),
    /// The selected folder failed for `reason`, and `link` works.
    Switched {
        link: &'a L,
        value: T,
        reason: FolderState,
    },
    Stopped(E),
    /// No folder of the chain works. `reason` is the selected folder's.
    Unavailable(FolderState),
}

/// Try `selected`, then walk `chain` from the top, skipping `selected`, until
/// one folder works.
pub fn fail_over<'a, L: PartialEq, T, E>(
    selected: &'a L,
    chain: &'a [L],
    mut attempt: impl FnMut(&L) -> Try<T, E>,
) -> Failover<'a, L, T, E> {
    let reason = match attempt(selected) {
        Try::Works(value) => return Failover::Kept(value),
        Try::Stop(error) => return Failover::Stopped(error),
        Try::Fails(reason) => reason,
    };
    for link in chain.iter().filter(|link| *link != selected) {
        match attempt(link) {
            Try::Works(value) => {
                return Failover::Switched {
                    link,
                    value,
                    reason,
                }
            }
            Try::Fails(_) => {}
            Try::Stop(error) => return Failover::Stopped(error),
        }
    }
    Failover::Unavailable(reason)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answers(
        tried: &mut Vec<u32>,
        works: &[u32],
        stops: &[u32],
        link: u32,
    ) -> Try<u32, &'static str> {
        tried.push(link);
        if stops.contains(&link) {
            Try::Stop("driver")
        } else if works.contains(&link) {
            Try::Works(link * 10)
        } else {
            Try::Fails(FolderState::Missing)
        }
    }

    #[test]
    fn a_selected_folder_that_works_is_kept() {
        let mut tried = Vec::new();
        let chain = [1, 2, 3];
        let outcome = fail_over(&2, &chain, |link| answers(&mut tried, &[2], &[], *link));
        assert!(matches!(outcome, Failover::Kept(20)));
        assert_eq!(tried, vec![2]);
    }

    #[test]
    fn the_walk_starts_at_the_top_and_skips_the_selected_folder() {
        let mut tried = Vec::new();
        let chain = [1, 2, 3];
        let outcome = fail_over(&2, &chain, |link| answers(&mut tried, &[3], &[], *link));
        match outcome {
            Failover::Switched {
                link,
                value,
                reason,
            } => {
                assert_eq!((*link, value, reason), (3, 30, FolderState::Missing));
            }
            _ => panic!("expected a switch"),
        }
        assert_eq!(tried, vec![2, 1, 3]);
    }

    #[test]
    fn a_failure_that_is_not_the_folders_switches_nothing() {
        let mut tried = Vec::new();
        let chain = [1, 2, 3];
        let outcome = fail_over(&1, &chain, |link| answers(&mut tried, &[3], &[2], *link));
        assert!(matches!(outcome, Failover::Stopped("driver")));
        assert_eq!(tried, vec![1, 2]);
    }

    #[test]
    fn nothing_that_works_keeps_the_selection_with_its_reason() {
        let mut tried = Vec::new();
        let chain = [1, 2];
        let outcome = fail_over(&1, &chain, |link| answers(&mut tried, &[], &[], *link));
        assert!(matches!(
            outcome,
            Failover::Unavailable(FolderState::Missing)
        ));
        assert_eq!(tried, vec![1, 2]);
    }
}
