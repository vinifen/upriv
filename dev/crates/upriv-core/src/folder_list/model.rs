//! The model every folder list shares: device groups of numbered rows, a
//! selection per group, and the changes a save carries. Pure: no I/O.
//!
//! A list keeps one group per device under its feature's table. On the
//! current device one choice is selected: a row, a fixed choice of that list,
//! or nothing. Rows come first in the person's order, then the fixed
//! choices, which never move. A row's number is given when it is made and is
//! never reused while its group exists.
//!
//! A group is made the first time a device's list differs from the defaults
//! and stays until another device removes it (Remove device): deleting its
//! rows or selecting the default again keeps it. Removing it takes only that
//! list's setting for the device, which then uses the list's default.

use std::collections::BTreeMap;
use std::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::chain::ChoiceName;
use super::path_rules::{path_issue, same_path, ListKind};
use crate::device::{DeviceId, DeviceSystem, ThisDevice};
use crate::error::{Result, UprivError};

/// Longest row name, in characters.
pub const ROW_NAME_MAX_CHARS: usize = 80;

/// The fixed choices of one list. Each list has its own enum.
pub trait FixedChoice: Copy + Eq + fmt::Debug + Send + Sync + 'static {
    /// Which paths the list's rows may hold.
    const LIST: ListKind;
    /// The list's fixed choices, in priority order after the rows.
    const ALL: &'static [Self];
    /// What a device group that sets nothing uses.
    const DEFAULT: Selection<Self>;
    /// Whether "nothing selected" is a state the list can hold.
    const ALLOWS_NOTHING: bool;

    fn as_str(self) -> &'static str;

    fn parse(text: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|choice| choice.as_str() == text)
    }
}

/// The choice a device uses: a row by number, a fixed choice, or nothing.
/// Stored as the row number, the fixed choice's name, or `none`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Selection<F> {
    Nothing,
    Fixed(F),
    Row(u32),
}

/// Spelling of [`Selection::Nothing`] on disk and on the wire.
const NOTHING: &str = "none";

impl<F: FixedChoice> Default for Selection<F> {
    fn default() -> Self {
        F::DEFAULT
    }
}

impl<F: FixedChoice> Selection<F> {
    pub fn is_default(&self) -> bool {
        *self == F::DEFAULT
    }
}

impl<F: FixedChoice> Serialize for Selection<F> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Self::Nothing => serializer.serialize_str(NOTHING),
            Self::Fixed(choice) => serializer.serialize_str(choice.as_str()),
            Self::Row(number) => serializer.serialize_u32(*number),
        }
    }
}

impl<'de, F: FixedChoice> Deserialize<'de> for Selection<F> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct SelectionVisitor<F>(std::marker::PhantomData<F>);

        impl<F: FixedChoice> Visitor<'_> for SelectionVisitor<F> {
            type Value = Selection<F>;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a row number or the name of a fixed choice")
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> std::result::Result<Self::Value, E> {
                u32::try_from(value)
                    .ok()
                    .filter(|number| *number > 0)
                    .map(Selection::Row)
                    .ok_or_else(|| E::custom(format!("{value} is not a row number")))
            }

            fn visit_i64<E: de::Error>(self, value: i64) -> std::result::Result<Self::Value, E> {
                u64::try_from(value)
                    .map_err(|_| E::custom(format!("{value} is not a row number")))
                    .and_then(|value| self.visit_u64(value))
            }

            fn visit_str<E: de::Error>(self, value: &str) -> std::result::Result<Self::Value, E> {
                if value == NOTHING && F::ALLOWS_NOTHING {
                    return Ok(Selection::Nothing);
                }
                F::parse(value)
                    .map(Selection::Fixed)
                    .ok_or_else(|| E::custom(format!("{value} is not a choice of this list")))
            }
        }

        deserializer.deserialize_any(SelectionVisitor(std::marker::PhantomData))
    }
}

/// A folder the person added to a device group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub number: u32,
    #[serde(default)]
    pub name: String,
    pub path: String,
}

/// What one list keeps for one device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    deny_unknown_fields,
    bound(serialize = "F: FixedChoice", deserialize = "F: FixedChoice")
)]
pub struct DeviceGroup<F: FixedChoice> {
    pub system: DeviceSystem,
    #[serde(default, skip_serializing_if = "Selection::is_default")]
    pub selected: Selection<F>,
    pub next_number: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<Row>,
}

impl<F: FixedChoice> DeviceGroup<F> {
    /// A group of this device with nothing in it yet.
    pub fn for_device(device: &ThisDevice) -> Self {
        Self {
            system: device.system,
            selected: F::DEFAULT,
            next_number: 1,
            rows: Vec::new(),
        }
    }

    pub fn row(&self, number: u32) -> Option<&Row> {
        self.rows.iter().find(|row| row.number == number)
    }

    /// A group holds something while it has rows or selects other than the
    /// list's default. A group is made only to hold something.
    pub fn holds_something(&self) -> bool {
        !self.rows.is_empty() || !self.selected.is_default()
    }
}

/// One list's device groups, keyed by device ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    transparent,
    bound(serialize = "F: FixedChoice", deserialize = "F: FixedChoice")
)]
pub struct DeviceGroups<F: FixedChoice>(pub BTreeMap<DeviceId, DeviceGroup<F>>);

impl<F: FixedChoice> Default for DeviceGroups<F> {
    fn default() -> Self {
        Self(BTreeMap::new())
    }
}

impl<F: FixedChoice> DeviceGroups<F> {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn group(&self, id: &DeviceId) -> Option<&DeviceGroup<F>> {
        self.0.get(id)
    }

    /// This device's group, or `None` for an unknown device or one with no group.
    pub fn here(&self, device: &ThisDevice) -> Option<&DeviceGroup<F>> {
        self.group(device.id.as_ref()?)
    }

    /// This device's rows, top first.
    pub fn rows_here(&self, device: &ThisDevice) -> &[Row] {
        self.here(device).map_or(&[], |group| group.rows.as_slice())
    }

    /// This device's row `number`.
    pub fn row_here(&self, device: &ThisDevice, number: u32) -> Option<&Row> {
        self.here(device)?.row(number)
    }

    /// `selection` as a switch names it on this device.
    pub fn choice_name(&self, device: &ThisDevice, selection: Selection<F>) -> ChoiceName {
        match selection {
            Selection::Row(number) => ChoiceName::Row {
                number,
                name: self
                    .row_here(device, number)
                    .map(|row| row.name.clone())
                    .unwrap_or_default(),
            },
            Selection::Fixed(choice) => ChoiceName::Fixed {
                choice: choice.as_str(),
            },
            Selection::Nothing => ChoiceName::Nothing,
        }
    }

    /// What this device uses: its group's selection, or the list's default.
    pub fn selection_here(&self, device: &ThisDevice) -> Selection<F> {
        self.here(device).map_or(F::DEFAULT, |group| group.selected)
    }

    /// Set this device's selection, making its group when it has none and
    /// the selection is not the default. An unknown device changes nothing.
    pub fn select_here(&mut self, device: &ThisDevice, selection: Selection<F>) {
        let Some(id) = device.id.clone() else {
            return;
        };
        match self.0.get_mut(&id) {
            Some(group) => group.selected = selection,
            None if selection.is_default() => {}
            None => {
                self.0.insert(
                    id,
                    DeviceGroup {
                        selected: selection,
                        ..DeviceGroup::for_device(device)
                    },
                );
            }
        }
    }

    /// The groups of the other devices.
    pub fn others<'a>(
        &'a self,
        device: &'a ThisDevice,
    ) -> impl Iterator<Item = (&'a DeviceId, &'a DeviceGroup<F>)> + 'a {
        self.0
            .iter()
            .filter(move |(id, _)| device.id.as_ref() != Some(*id))
    }

    /// Why a list read from a file cannot be used: a row number used twice
    /// or zero, a name that is too long, or a selection that names no row.
    /// A next number at or below a row's is raised.
    pub fn check(&mut self) -> std::result::Result<(), String> {
        for (id, group) in &mut self.0 {
            let device = id.as_str();
            check_rows(&group.rows).map_err(|detail| format!("device {device}: {detail}"))?;
            check_selection(group).map_err(|detail| format!("device {device}: {detail}"))?;
            group.next_number = group.next_number.max(highest_number(&group.rows) + 1);
        }
        Ok(())
    }
}

fn highest_number(rows: &[Row]) -> u32 {
    rows.iter().map(|row| row.number).max().unwrap_or(0)
}

fn check_rows(rows: &[Row]) -> std::result::Result<(), String> {
    let mut seen = std::collections::BTreeSet::new();
    for row in rows {
        if row.number == 0 || !seen.insert(row.number) {
            return Err("row numbers are unique and start at 1".into());
        }
        if row.name.trim().chars().count() > ROW_NAME_MAX_CHARS {
            return Err(format!(
                "a row name has at most {ROW_NAME_MAX_CHARS} characters"
            ));
        }
    }
    Ok(())
}

fn check_selection<F: FixedChoice>(group: &DeviceGroup<F>) -> std::result::Result<(), String> {
    match group.selected {
        Selection::Row(number) if group.row(number).is_none() => {
            Err("the selection names no row of the group".into())
        }
        Selection::Nothing if !F::ALLOWS_NOTHING => Err("this list always has a choice".into()),
        _ => Ok(()),
    }
}

/// What a save changes in one device group. A part left out did not change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    deny_unknown_fields,
    bound(serialize = "F: FixedChoice", deserialize = "F: FixedChoice")
)]
pub struct GroupChange<F: FixedChoice> {
    /// Remove another device's group. The current device's group is never
    /// removed from the current device.
    #[serde(default)]
    pub remove: bool,
    /// Every row of the group, in order. The group's next number follows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Row>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_number: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected: Option<Selection<F>>,
}

/// What a save changes in one list, per device group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    deny_unknown_fields,
    bound(serialize = "F: FixedChoice", deserialize = "F: FixedChoice")
)]
pub struct ListChanges<F: FixedChoice> {
    #[serde(default)]
    pub groups: BTreeMap<DeviceId, GroupChange<F>>,
}

impl<F: FixedChoice> Default for ListChanges<F> {
    fn default() -> Self {
        Self {
            groups: BTreeMap::new(),
        }
    }
}

impl<F: FixedChoice> ListChanges<F> {
    pub fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    /// True when the change touches the current device's group.
    pub fn touches_here(&self, device: &ThisDevice) -> bool {
        device
            .id
            .as_ref()
            .is_some_and(|id| self.groups.contains_key(id))
    }
}

fn invalid(detail: impl Into<String>) -> UprivError {
    UprivError::FolderListInvalid {
        detail: detail.into(),
    }
}

/// Apply `changes` to `groups`, read again from disk. Only the parts a change
/// carries are written, so what core switched meanwhile in another part
/// stays. A group of this device is made when a change leaves it holding
/// something; a group goes only by its `remove`.
///
/// A row whose path is new or changed is checked against its group's system;
/// paths may not repeat in a group, and this device's rows may not name the
/// folder of one of the list's fixed choices here (`fixed_here`).
pub fn apply_changes<F: FixedChoice>(
    groups: &mut DeviceGroups<F>,
    changes: &ListChanges<F>,
    device: &ThisDevice,
    fixed_here: &[String],
) -> Result<()> {
    if !changes.is_empty() && device.id.is_none() {
        return Err(UprivError::DeviceUnknown);
    }
    for (id, change) in &changes.groups {
        let here = device.id.as_ref() == Some(id);
        if change.remove {
            if here {
                return Err(invalid(
                    "this device's group is removed only from another device",
                ));
            }
            groups.0.remove(id);
            continue;
        }
        let made = here && !groups.0.contains_key(id);
        let group = match groups.0.get_mut(id) {
            Some(group) => group,
            None if here => groups
                .0
                .entry(id.clone())
                .or_insert_with(|| DeviceGroup::for_device(device)),
            None => return Err(invalid("no such device group")),
        };
        let fixed: &[String] = if here { fixed_here } else { &[] };
        apply_group_change(group, change, fixed)?;
        if made && !group.holds_something() {
            groups.0.remove(id);
        }
    }
    Ok(())
}

fn apply_group_change<F: FixedChoice>(
    group: &mut DeviceGroup<F>,
    change: &GroupChange<F>,
    fixed: &[String],
) -> Result<()> {
    if let Some(rows) = &change.rows {
        check_rows(rows).map_err(invalid)?;
        let rows: Vec<Row> = rows
            .iter()
            .map(|row| Row {
                number: row.number,
                name: row.name.trim().to_string(),
                path: row.path.trim().to_string(),
            })
            .collect();
        for row in &rows {
            let unchanged = group
                .row(row.number)
                .is_some_and(|before| before.path == row.path);
            if unchanged {
                continue;
            }
            if let Some(issue) = path_issue(group.system, F::LIST, &row.path) {
                return Err(UprivError::FolderPathRefused {
                    path: row.path.clone(),
                    issue,
                });
            }
        }
        refuse_duplicates(group.system, &rows, fixed)?;
        group.rows = rows;
    }
    let asked = change.next_number.unwrap_or(group.next_number);
    group.next_number = asked
        .max(group.next_number)
        .max(highest_number(&group.rows) + 1);
    if let Some(selected) = change.selected {
        group.selected = selected;
    }
    check_selection(group).map_err(invalid)
}

/// Paths repeat neither inside a group nor against a fixed choice's folder.
fn refuse_duplicates(system: DeviceSystem, rows: &[Row], fixed: &[String]) -> Result<()> {
    for (index, row) in rows.iter().enumerate() {
        let repeated = rows[..index]
            .iter()
            .map(|other| other.path.as_str())
            .chain(fixed.iter().map(String::as_str))
            .any(|other| same_path(system, &row.path, other));
        if repeated {
            return Err(UprivError::FolderPathDuplicate {
                path: row.path.clone(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A list with one fixed choice and nothing as its default.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum Spot {
        Beside,
    }

    impl FixedChoice for Spot {
        const LIST: ListKind = ListKind::Unlocked;
        const ALL: &'static [Self] = &[Self::Beside];
        const DEFAULT: Selection<Self> = Selection::Nothing;
        const ALLOWS_NOTHING: bool = true;

        fn as_str(self) -> &'static str {
            "beside"
        }
    }

    pub(crate) fn device(machine: &[u8]) -> ThisDevice {
        ThisDevice {
            id: Some(DeviceId::from_machine_id(machine)),
            run_id: "run".into(),
            system: DeviceSystem::Linux,
        }
    }

    fn row(number: u32, path: &str) -> Row {
        Row {
            number,
            name: String::new(),
            path: path.into(),
        }
    }

    fn rows_change(rows: Vec<Row>, selected: Option<Selection<Spot>>) -> GroupChange<Spot> {
        GroupChange {
            remove: false,
            rows: Some(rows),
            next_number: None,
            selected,
        }
    }

    fn changes_for(id: &ThisDevice, change: GroupChange<Spot>) -> ListChanges<Spot> {
        let mut changes = ListChanges::default();
        changes.groups.insert(id.id.clone().unwrap(), change);
        changes
    }

    #[test]
    fn a_selection_is_a_row_number_a_fixed_name_or_none() {
        let groups: DeviceGroup<Spot> = toml::from_str(
            "system = \"linux\"\nselected = 2\nnext_number = 3\n\
             [[rows]]\nnumber = 2\npath = \"/mnt/a\"\n",
        )
        .unwrap();
        assert_eq!(groups.selected, Selection::Row(2));
        let fixed: Selection<Spot> = serde_json::from_str("\"beside\"").unwrap();
        assert_eq!(fixed, Selection::Fixed(Spot::Beside));
        let nothing: Selection<Spot> = serde_json::from_str("\"none\"").unwrap();
        assert_eq!(nothing, Selection::Nothing);
        assert!(serde_json::from_str::<Selection<Spot>>("\"elsewhere\"").is_err());
        assert!(serde_json::from_str::<Selection<Spot>>("0").is_err());
    }

    #[test]
    fn the_default_selection_is_not_written() {
        let group = DeviceGroup::<Spot>::for_device(&device(b"desk"));
        let text = toml::to_string(&group).unwrap();
        assert!(!text.contains("selected"), "{text}");
        assert!(!text.contains("rows"), "{text}");
    }

    #[test]
    fn a_group_keeps_its_devices_system_and_no_name() {
        let group = DeviceGroup::<Spot>::for_device(&device(b"desk"));
        assert_eq!(
            toml::to_string(&group).unwrap(),
            "system = \"linux\"\nnext_number = 1\n"
        );
    }

    #[test]
    fn a_change_makes_this_devices_group_and_keeps_other_parts() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        apply_changes(
            &mut groups,
            &changes_for(
                &here,
                rows_change(vec![row(1, "/mnt/a")], Some(Selection::Row(1))),
            ),
            &here,
            &[],
        )
        .unwrap();
        let group = groups.here(&here).unwrap();
        assert_eq!(group.system, DeviceSystem::Linux);
        assert_eq!(group.next_number, 2);
        assert_eq!(group.selected, Selection::Row(1));

        // Core switched the selection meanwhile; a save of the rows keeps it.
        groups.select_here(&here, Selection::Fixed(Spot::Beside));
        apply_changes(
            &mut groups,
            &changes_for(
                &here,
                rows_change(vec![row(1, "/mnt/a"), row(2, "/mnt/b")], None),
            ),
            &here,
            &[],
        )
        .unwrap();
        let group = groups.here(&here).unwrap();
        assert_eq!(group.selected, Selection::Fixed(Spot::Beside));
        assert_eq!(group.next_number, 3);
    }

    #[test]
    fn numbers_are_never_reused_while_the_group_exists() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        apply_changes(
            &mut groups,
            &changes_for(
                &here,
                rows_change(vec![row(1, "/a"), row(2, "/b")], Some(Selection::Row(2))),
            ),
            &here,
            &[],
        )
        .unwrap();
        apply_changes(
            &mut groups,
            &changes_for(&here, rows_change(vec![row(2, "/b")], None)),
            &here,
            &[],
        )
        .unwrap();
        assert_eq!(groups.here(&here).unwrap().next_number, 3);
    }

    #[test]
    fn a_group_stays_once_its_rows_are_deleted() {
        let here = device(b"desk");
        let other = device(b"laptop");
        let mut groups = DeviceGroups::<Spot>::default();
        for owner in [&here, &other] {
            groups.0.insert(
                owner.id.clone().unwrap(),
                DeviceGroup {
                    rows: vec![row(1, "/a")],
                    selected: Selection::Row(1),
                    next_number: 2,
                    ..DeviceGroup::for_device(owner)
                },
            );
        }
        for owner in [&here, &other] {
            apply_changes(
                &mut groups,
                &changes_for(owner, rows_change(Vec::new(), Some(Selection::Nothing))),
                &here,
                &[],
            )
            .unwrap();
            let group = groups.group(owner.id.as_ref().unwrap()).unwrap();
            assert!(group.rows.is_empty());
            assert_eq!(group.next_number, 2);
        }
        groups.check().unwrap();
        assert_eq!(groups.0.len(), 2);
    }

    #[test]
    fn a_group_is_made_only_to_hold_something() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        apply_changes(
            &mut groups,
            &changes_for(&here, rows_change(Vec::new(), Some(Selection::Nothing))),
            &here,
            &[],
        )
        .unwrap();
        assert!(groups.is_empty());
        groups.select_here(&here, Selection::Nothing);
        assert!(groups.is_empty());
        groups.select_here(&here, Selection::Fixed(Spot::Beside));
        groups.select_here(&here, Selection::Nothing);
        assert_eq!(groups.selection_here(&here), Selection::Nothing);
        assert!(groups.here(&here).is_some());
    }

    #[test]
    fn a_selection_must_name_a_row_of_the_group() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        let refused = apply_changes(
            &mut groups,
            &changes_for(
                &here,
                rows_change(vec![row(1, "/a")], Some(Selection::Row(7))),
            ),
            &here,
            &[],
        );
        assert!(matches!(refused, Err(UprivError::FolderListInvalid { .. })));
    }

    #[test]
    fn another_devices_group_can_be_removed_and_this_ones_cannot() {
        let here = device(b"desk");
        let other = device(b"laptop");
        let mut groups = DeviceGroups::<Spot>::default();
        for owner in [&here, &other] {
            groups.0.insert(
                owner.id.clone().unwrap(),
                DeviceGroup {
                    rows: vec![row(1, "/a")],
                    ..DeviceGroup::for_device(owner)
                },
            );
        }
        let remove = GroupChange {
            remove: true,
            rows: None,
            next_number: None,
            selected: None,
        };
        assert!(
            apply_changes(&mut groups, &changes_for(&here, remove.clone()), &here, &[]).is_err()
        );
        apply_changes(&mut groups, &changes_for(&other, remove), &here, &[]).unwrap();
        assert!(groups.group(other.id.as_ref().unwrap()).is_none());
        assert!(groups.here(&here).is_some());
    }

    #[test]
    fn an_unknown_device_changes_nothing() {
        let unknown = ThisDevice {
            id: None,
            ..device(b"desk")
        };
        let mut groups = DeviceGroups::<Spot>::default();
        groups.select_here(&unknown, Selection::Fixed(Spot::Beside));
        assert!(groups.is_empty());
        let mut changes = ListChanges::default();
        changes.groups.insert(
            DeviceId::from_machine_id(b"x"),
            rows_change(Vec::new(), None),
        );
        assert!(matches!(
            apply_changes(&mut groups, &changes, &unknown, &[]),
            Err(UprivError::DeviceUnknown)
        ));
    }

    #[test]
    fn a_new_path_is_checked_against_the_groups_system() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        let refused = apply_changes(
            &mut groups,
            &changes_for(&here, rows_change(vec![row(1, r"D:\Folder")], None)),
            &here,
            &[],
        );
        assert!(matches!(
            refused,
            Err(UprivError::FolderPathRefused {
                issue: crate::folder_list::PathIssue::NotAbsolute,
                ..
            })
        ));
        let inside = apply_changes(
            &mut groups,
            &changes_for(
                &here,
                rows_change(vec![row(1, "/mnt/a/upriv-backups/notes")], None),
            ),
            &here,
            &[],
        );
        assert!(matches!(
            inside,
            Err(UprivError::FolderPathRefused {
                issue: crate::folder_list::PathIssue::Overlap,
                ..
            })
        ));
    }

    #[test]
    fn a_path_already_in_the_group_or_a_fixed_folder_is_a_duplicate() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        let twice = apply_changes(
            &mut groups,
            &changes_for(
                &here,
                rows_change(vec![row(1, "/mnt/a"), row(2, "/mnt/a/")], None),
            ),
            &here,
            &[],
        );
        assert!(matches!(twice, Err(UprivError::FolderPathDuplicate { .. })));
        let beside = apply_changes(
            &mut groups,
            &changes_for(&here, rows_change(vec![row(1, "/data")], None)),
            &here,
            &["/data/".to_string()],
        );
        assert!(matches!(
            beside,
            Err(UprivError::FolderPathDuplicate { .. })
        ));
    }

    #[test]
    fn a_row_kept_as_it_was_is_not_checked_again() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        groups.0.insert(
            here.id.clone().unwrap(),
            DeviceGroup {
                rows: vec![row(1, "relative")],
                next_number: 2,
                ..DeviceGroup::for_device(&here)
            },
        );
        apply_changes(
            &mut groups,
            &changes_for(
                &here,
                rows_change(vec![row(1, "relative"), row(2, "/mnt/b")], None),
            ),
            &here,
            &[],
        )
        .unwrap();
        assert_eq!(groups.here(&here).unwrap().rows.len(), 2);
    }

    #[test]
    fn a_list_read_from_a_file_is_checked() {
        let here = device(b"desk");
        let mut groups = DeviceGroups::<Spot>::default();
        groups.0.insert(
            here.id.clone().unwrap(),
            DeviceGroup {
                rows: vec![row(4, "/mnt/a")],
                next_number: 1,
                selected: Selection::Row(4),
                ..DeviceGroup::for_device(&here)
            },
        );
        groups.check().unwrap();
        assert_eq!(groups.here(&here).unwrap().next_number, 5);

        groups
            .0
            .get_mut(here.id.as_ref().unwrap())
            .unwrap()
            .selected = Selection::Row(9);
        assert!(groups.check().is_err());
    }

    #[test]
    fn other_devices_are_listed_apart_from_this_one() {
        let here = device(b"desk");
        let other = device(b"laptop");
        let mut groups = DeviceGroups::<Spot>::default();
        for owner in [&here, &other] {
            groups.0.insert(
                owner.id.clone().unwrap(),
                DeviceGroup {
                    rows: vec![row(1, "/a")],
                    ..DeviceGroup::for_device(owner)
                },
            );
        }
        let others: Vec<_> = groups.others(&here).map(|(id, _)| id.clone()).collect();
        assert_eq!(others, vec![other.id.clone().unwrap()]);
    }
}
