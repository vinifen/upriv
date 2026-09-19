//! `.upriv/vault_groups.toml` — optional vault organization registry.
//!
//! Groups are UI/list metadata only. Vault folders stay flat under `vaults/<id>/`.
//! Corrupt file → [`UprivError::VaultGroupsInvalid`] (never vault-root Gate A/B).
//! Missing group on mutate → [`UprivError::VaultGroupNotFound`].
//!
//! List sanitizes in memory (orphans = vault **directory** gone; first-group-wins).
//! Mutations that do not change membership persist the raw `grouped_vaults` list
//! (collapse / rename / order must not drop assignments).

mod types;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use crate::config::vault_config::set_vault_hidden;
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;

pub use types::{LoadedVaultGroups, VaultGroup, VaultGroupsFile};

pub const VAULT_GROUPS_FILE_NAME: &str = "vault_groups.toml";

const VAULT_GROUPS_TOML_HEADER: &str = "\
# Optional vault list organization (not a vault).
# Membership is grouped_vaults[] here — not settings.toml or vaults/<id>/config.toml.
# [[group]].display_name is the group title in the vault list.
# Missing file = no groups.

";

/// Serializes load-modify-save mutations (UniFFI may dispatch RPCs concurrently).
static GROUPS_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn lock_groups_write() -> MutexGuard<'static, ()> {
    GROUPS_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Absolute path to `.upriv/vault_groups.toml`.
pub fn vault_groups_path(root: &VaultRoot) -> PathBuf {
    root.root().join(".upriv").join(VAULT_GROUPS_FILE_NAME)
}

/// Parse + validate schema (no disk assignment check).
pub fn parse_vault_groups_toml_str(raw: &str) -> Result<VaultGroupsFile> {
    let mut parsed: VaultGroupsFile =
        toml::from_str(raw).map_err(|error| UprivError::VaultGroupsInvalid {
            path: PathBuf::from(VAULT_GROUPS_FILE_NAME),
            detail: format!("invalid vault_groups.toml: {error}"),
        })?;
    for group in &mut parsed.groups {
        group.resolve_identity();
    }
    validate_schema(&parsed, Path::new(VAULT_GROUPS_FILE_NAME))?;
    Ok(parsed)
}

fn validate_schema(file: &VaultGroupsFile, path: &Path) -> Result<()> {
    let mut seen_ids = HashSet::new();
    for group in &file.groups {
        let id = group.id.trim();
        if id.is_empty() {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.to_path_buf(),
                detail: "[[group]].id is empty".into(),
            });
        }
        if !seen_ids.insert(id.to_string()) {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.to_path_buf(),
                detail: format!("duplicate [[group]].id: {id}"),
            });
        }
    }
    Ok(())
}

fn groups_invalid(root: &VaultRoot, detail: impl Into<String>) -> UprivError {
    UprivError::VaultGroupsInvalid {
        path: vault_groups_path(root),
        detail: detail.into(),
    }
}

fn require_upriv_dir(root: &VaultRoot) -> Result<()> {
    let dir = root.root().join(".upriv");
    if !dir.is_dir() {
        return Err(UprivError::VaultRootNotFound(dir));
    }
    Ok(())
}

fn trim_vault_ids(ids: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(ids.len());
    let mut seen = HashSet::new();
    for id in ids {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        if seen.insert(id.to_string()) {
            out.push(id.to_string());
        }
    }
    out
}

fn require_assignable_vault(root: &VaultRoot, vault_id: &str) -> Result<()> {
    let dir = root.vault_dir(vault_id)?;
    if !dir.is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    crate::config::vault_config::load_vault_config(&dir)?;
    Ok(())
}

struct VaultHiddenRevert {
    dir: PathBuf,
    previous: bool,
}

fn unique_vault_ids(left: &[String], right: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in left.iter().chain(right.iter()) {
        if seen.insert(id.clone()) {
            out.push(id.clone());
        }
    }
    out
}

/// Load every existing member first so an invalid `config.toml` fails before any write.
fn plan_set_grouped_vaults_hidden(
    root: &VaultRoot,
    vault_ids: &[String],
    hidden: bool,
) -> Result<Vec<(PathBuf, bool)>> {
    let mut planned = Vec::new();
    for vault_id in vault_ids {
        let dir = match root.vault_dir(vault_id) {
            Ok(dir) => dir,
            Err(_) => continue,
        };
        if !dir.is_dir() {
            continue;
        }
        let config = crate::config::vault_config::load_vault_config_raw(&dir)?;
        if config.vault.hidden != hidden {
            planned.push((dir, config.vault.hidden));
        }
    }
    Ok(planned)
}

fn revert_vault_hidden(applied: &[VaultHiddenRevert]) {
    for entry in applied.iter().rev() {
        let _ = set_vault_hidden(&entry.dir, entry.previous);
    }
}

fn apply_vault_hidden_plan(
    plan: &[(PathBuf, bool)],
    hidden: bool,
) -> Result<Vec<VaultHiddenRevert>> {
    let mut applied = Vec::new();
    for (dir, previous) in plan {
        match set_vault_hidden(dir, hidden) {
            Ok(_) => applied.push(VaultHiddenRevert {
                dir: dir.clone(),
                previous: *previous,
            }),
            Err(error) => {
                revert_vault_hidden(&applied);
                return Err(error);
            }
        }
    }
    Ok(applied)
}

/// Cascade `[vault].hidden` on members. Skips missing dirs (orphans kept on
/// mutate). Invalid `config.toml` fails the op before any vault write.
fn set_grouped_vaults_hidden(
    root: &VaultRoot,
    vault_ids: &[String],
    hidden: bool,
) -> Result<Vec<VaultHiddenRevert>> {
    let plan = plan_set_grouped_vaults_hidden(root, vault_ids, hidden)?;
    apply_vault_hidden_plan(&plan, hidden)
}

fn find_group_index(groups: &[VaultGroup], group_id: &str) -> Option<usize> {
    let id = group_id.trim();
    groups.iter().position(|g| g.id == id)
}

/// Soft-sanitize for **list** (in memory only): drop vaults whose **directory** is gone,
/// dedup grouped vaults, first-group-wins for dual assignment. Invalid `config.toml`
/// does not count as an orphan.
pub fn sanitize_vault_groups(
    file: VaultGroupsFile,
    known_vault_ids: &HashSet<String>,
) -> LoadedVaultGroups {
    let mut dropped_orphans = 0usize;
    let mut dropped_duplicate_assignments = 0usize;
    let mut claimed: HashSet<String> = HashSet::new();
    let mut groups = Vec::with_capacity(file.groups.len());

    for mut group in file.groups {
        group.resolve_identity();

        let mut grouped_vaults = Vec::new();
        let mut seen_in_group = HashSet::new();
        for vault_id in group.grouped_vaults {
            let id = vault_id.trim().to_string();
            if id.is_empty() {
                continue;
            }
            if !seen_in_group.insert(id.clone()) {
                continue;
            }
            if !known_vault_ids.contains(&id) {
                dropped_orphans += 1;
                continue;
            }
            if claimed.contains(&id) {
                dropped_duplicate_assignments += 1;
                continue;
            }
            claimed.insert(id.clone());
            grouped_vaults.push(id);
        }
        group.grouped_vaults = grouped_vaults;
        group.grouped_vault_sort = normalize_grouped_vault_sort(&group.grouped_vault_sort)
            .unwrap_or("order")
            .to_string();
        group.grouped_vault_sort_direction =
            normalize_grouped_vault_sort_direction(&group.grouped_vault_sort_direction)
                .unwrap_or("asc")
                .to_string();
        groups.push(group);
    }

    LoadedVaultGroups {
        groups,
        dropped_orphans,
        dropped_duplicate_assignments,
    }
}

fn parse_file_from_disk(root: &VaultRoot) -> Result<Option<VaultGroupsFile>> {
    let path = vault_groups_path(root);
    if path.exists() && !path.is_file() {
        return Err(UprivError::VaultGroupsInvalid {
            path,
            detail: "vault_groups.toml exists but is not a file".into(),
        });
    }
    if !path.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(UprivError::from)?;
    let mut parsed: VaultGroupsFile =
        toml::from_str(&raw).map_err(|error| UprivError::VaultGroupsInvalid {
            path: path.clone(),
            detail: format!("invalid vault_groups.toml: {error}"),
        })?;
    for group in &mut parsed.groups {
        group.resolve_identity();
    }
    validate_schema(&parsed, &path)?;
    Ok(Some(parsed))
}

fn trim_group_headers(file: VaultGroupsFile) -> VaultGroupsFile {
    VaultGroupsFile {
        groups: file
            .groups
            .into_iter()
            .map(|mut group| {
                group.resolve_identity();
                group
            })
            .collect(),
    }
}

/// Load groups for a vault-root. Missing file → empty Ok.
///
/// Parse/schema failure → [`UprivError::VaultGroupsInvalid`].
/// List path: sanitizes in memory (does not write).
pub fn load_vault_groups(
    root: &VaultRoot,
    known_vault_ids: &HashSet<String>,
) -> Result<LoadedVaultGroups> {
    match parse_file_from_disk(root)? {
        None => Ok(LoadedVaultGroups {
            groups: Vec::new(),
            dropped_orphans: 0,
            dropped_duplicate_assignments: 0,
        }),
        Some(parsed) => Ok(sanitize_vault_groups(parsed, known_vault_ids)),
    }
}

/// Load without dropping orphans / dual assignment — used by mutations that must
/// not rewrite `grouped_vaults` as a side effect.
fn load_vault_groups_raw(root: &VaultRoot) -> Result<Vec<VaultGroup>> {
    Ok(match parse_file_from_disk(root)? {
        None => Vec::new(),
        Some(parsed) => trim_group_headers(parsed).groups,
    })
}

/// Soft-heal before mutate+save: normalize sort enums and first-wins dual
/// membership. Keeps orphan vault ids (collapse must not drop gone dirs).
fn soften_groups_for_mutate(groups: Vec<VaultGroup>) -> Vec<VaultGroup> {
    let mut claimed: HashSet<String> = HashSet::new();
    let mut out = Vec::with_capacity(groups.len());
    for mut group in groups {
        group.resolve_identity();
        group.grouped_vault_sort = normalize_grouped_vault_sort(&group.grouped_vault_sort)
            .unwrap_or("order")
            .to_string();
        group.grouped_vault_sort_direction =
            normalize_grouped_vault_sort_direction(&group.grouped_vault_sort_direction)
                .unwrap_or("asc")
                .to_string();
        let mut grouped_vaults = Vec::new();
        let mut seen_in_group: HashSet<String> = HashSet::new();
        for id in trim_vault_ids(&group.grouped_vaults) {
            if !seen_in_group.insert(id.clone()) {
                continue;
            }
            if claimed.contains(&id) {
                continue;
            }
            claimed.insert(id.clone());
            grouped_vaults.push(id);
        }
        group.grouped_vaults = grouped_vaults;
        out.push(group);
    }
    out
}

fn load_vault_groups_for_mutate(root: &VaultRoot) -> Result<Vec<VaultGroup>> {
    Ok(soften_groups_for_mutate(load_vault_groups_raw(root)?))
}

/// Serialize groups to TOML body.
fn serialize_vault_groups(groups: &[VaultGroup]) -> Result<String> {
    let file = VaultGroupsFile {
        groups: groups.to_vec(),
    };
    let body = toml::to_string_pretty(&file).map_err(|error| UprivError::VaultGroupsInvalid {
        path: PathBuf::from(VAULT_GROUPS_FILE_NAME),
        detail: format!("serialize vault_groups.toml failed: {error}"),
    })?;
    Ok(format!("{VAULT_GROUPS_TOML_HEADER}{body}"))
}

fn prepare_groups_for_write(root: &VaultRoot, groups: &[VaultGroup]) -> Result<Vec<VaultGroup>> {
    let path = vault_groups_path(root);
    let mut out = Vec::with_capacity(groups.len());
    let mut seen_ids = HashSet::new();
    let mut claimed = HashSet::new();

    for group in groups {
        let id = group.id.trim().to_string();
        let display_name = {
            let name = crate::paths::normalize_stored_name(&group.display_name);
            if name.is_empty() {
                id.clone()
            } else {
                name
            }
        };
        if !crate::paths::slug_id_is_valid(&id) {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.clone(),
                detail: format!("invalid [[group]].id: {id}"),
            });
        }
        if !seen_ids.insert(id.clone()) {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.clone(),
                detail: format!("duplicate [[group]].id: {id}"),
            });
        }
        let Some(sort) = normalize_grouped_vault_sort(&group.grouped_vault_sort) else {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.clone(),
                detail: format!("invalid grouped_vault_sort: {}", group.grouped_vault_sort),
            });
        };
        let Some(direction) =
            normalize_grouped_vault_sort_direction(&group.grouped_vault_sort_direction)
        else {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.clone(),
                detail: format!(
                    "invalid grouped_vault_sort_direction: {}",
                    group.grouped_vault_sort_direction
                ),
            });
        };
        let grouped_vaults = trim_vault_ids(&group.grouped_vaults);
        for vault_id in &grouped_vaults {
            if !claimed.insert(vault_id.clone()) {
                return Err(UprivError::VaultGroupsInvalid {
                    path: path.clone(),
                    detail: format!("vault already in a group: {vault_id}"),
                });
            }
        }
        out.push(VaultGroup {
            id,
            display_name,
            order: group.order,
            collapsed: group.collapsed,
            hidden: group.hidden,
            grouped_vaults,
            grouped_vault_sort: sort.to_string(),
            grouped_vault_sort_direction: direction.to_string(),
        });
    }
    Ok(out)
}

/// Atomic write via [`crate::paths::write_bytes_atomic_existing_parent`].
/// Never creates `.upriv/` (mid-session Case B must stay not-found).
fn save_vault_groups(root: &VaultRoot, groups: &[VaultGroup]) -> Result<()> {
    require_upriv_dir(root)?;
    let prepared = prepare_groups_for_write(root, groups)?;
    let body = serialize_vault_groups(&prepared)?;
    crate::paths::write_bytes_atomic_existing_parent(&vault_groups_path(root), body.as_bytes())
}

/// Backup broken file and write empty valid registry.
///
/// Atomic-replace with empty first so a failed write cannot leave the path missing.
pub fn repair_vault_groups(root: &VaultRoot) -> Result<()> {
    let _guard = lock_groups_write();
    repair_vault_groups_locked(root)
}

fn repair_vault_groups_locked(root: &VaultRoot) -> Result<()> {
    require_upriv_dir(root)?;
    let path = vault_groups_path(root);
    let backup_bytes = if path.is_file() {
        Some(std::fs::read(&path).map_err(UprivError::from)?)
    } else {
        None
    };
    save_vault_groups(root, &[])?;
    if let Some(bytes) = backup_bytes {
        let bak = path.with_extension("toml.bak");
        let bak = if bak.exists() {
            let stamp = crate::time::utc_filename_stamp();
            path.with_extension(format!("toml.bak.{stamp}"))
        } else {
            bak
        };
        let _ = std::fs::write(&bak, bytes);
    }
    Ok(())
}

/// Remap a vault id inside every group's `grouped_vaults` (deep rename).
pub fn remap_grouped_vault_id(root: &VaultRoot, old_id: &str, new_id: &str) -> Result<()> {
    let _guard = lock_groups_write();
    require_upriv_dir(root)?;
    let old_id = old_id.trim();
    let new_id = new_id.trim();
    if old_id.is_empty() || new_id.is_empty() || old_id == new_id {
        return Ok(());
    }
    let mut groups = load_vault_groups_for_mutate(root)?;
    let mut changed = false;
    for group in &mut groups {
        for id in &mut group.grouped_vaults {
            if id == old_id {
                *id = new_id.to_string();
                changed = true;
            }
        }
    }
    if changed {
        save_vault_groups(root, &groups)?;
    }
    Ok(())
}

/// Known vault ids from scanning `vaults/*/`. Invalid `config.toml` still counts
/// (directory name) so list sanitize does not treat a broken config as an orphan.
pub fn known_vault_ids(root: &VaultRoot) -> Result<HashSet<String>> {
    let vaults_dir = root.vaults_dir();
    let mut ids = HashSet::new();
    if !vaults_dir.is_dir() {
        return Ok(ids);
    }
    for entry in std::fs::read_dir(&vaults_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let dir = entry.path();
        let dir_name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        match crate::config::vault_config::load_vault_config(&dir) {
            Ok(config) => {
                ids.insert(config.vault.id);
            }
            Err(UprivError::VaultConfigInvalid { .. }) => {
                if !dir_name.is_empty() {
                    ids.insert(dir_name);
                }
            }
            Err(error) => return Err(error),
        }
    }
    Ok(ids)
}

/// Test helper — production must use [`create_vault_group_with_sort`] so
/// `sibling_vaults_moved` is not discarded.
#[cfg(test)]
fn create_vault_group(
    root: &VaultRoot,
    id: &str,
    display_name: &str,
    grouped_vaults: &[String],
) -> Result<VaultGroup> {
    Ok(
        create_vault_group_with_sort(root, id, display_name, grouped_vaults, None, None, false)?
            .group,
    )
}

/// Create a group with optional grouped-vault sort (same defaults as [`create_vault_group`]).
pub fn create_vault_group_with_sort(
    root: &VaultRoot,
    id: &str,
    display_name: &str,
    grouped_vaults: &[String],
    grouped_vault_sort: Option<&str>,
    grouped_vault_sort_direction: Option<&str>,
    hidden: bool,
) -> Result<VaultGroupCreate> {
    let _guard = lock_groups_write();
    require_upriv_dir(root)?;
    let id = id.trim();
    let display_name = crate::paths::normalize_stored_name(display_name);
    if !crate::paths::slug_id_is_valid(id) {
        return Err(groups_invalid(root, format!("invalid group id: {id}")));
    }
    if display_name.is_empty() {
        return Err(groups_invalid(root, "id and display_name are required"));
    }
    let mut groups = load_vault_groups_for_mutate(root)?;
    if groups.iter().any(|g| g.id == id) {
        return Err(groups_invalid(root, format!("group already exists: {id}")));
    }
    let clean_grouped = trim_vault_ids(grouped_vaults);
    let vault_set: HashSet<&str> = clean_grouped.iter().map(|s| s.as_str()).collect();
    let mut sibling_vaults_moved = false;
    for group in &mut groups {
        let before = group.grouped_vaults.len();
        group
            .grouped_vaults
            .retain(|m| !vault_set.contains(m.as_str()));
        if group.grouped_vaults.len() != before {
            sibling_vaults_moved = true;
        }
    }
    for m in &clean_grouped {
        require_assignable_vault(root, m)?;
    }
    let sort = match grouped_vault_sort {
        Some(mode) => normalize_grouped_vault_sort(mode)
            .ok_or_else(|| groups_invalid(root, format!("invalid grouped_vault_sort: {mode}")))?
            .to_string(),
        None => "order".into(),
    };
    let direction = match grouped_vault_sort_direction {
        Some(value) => normalize_grouped_vault_sort_direction(value)
            .ok_or_else(|| {
                groups_invalid(
                    root,
                    format!("invalid grouped_vault_sort_direction: {value}"),
                )
            })?
            .to_string(),
        None => "asc".into(),
    };
    let order = groups
        .iter()
        .map(|g| g.order)
        .max()
        .unwrap_or(0)
        .saturating_add(1)
        .max(groups.len() as i64 + 1);
    let applied = set_grouped_vaults_hidden(root, &clean_grouped, hidden)?;
    let group = VaultGroup {
        id: id.to_string(),
        display_name: display_name.clone(),
        order,
        collapsed: false,
        hidden,
        grouped_vaults: clean_grouped,
        grouped_vault_sort: sort,
        grouped_vault_sort_direction: direction,
    };
    groups.push(group.clone());
    if let Err(error) = save_vault_groups(root, &groups) {
        revert_vault_hidden(&applied);
        return Err(error);
    }
    Ok(VaultGroupCreate {
        group,
        sibling_vaults_moved,
    })
}

/// Delete group; vaults stay on disk. Returns removed group if found.
pub fn delete_vault_group(root: &VaultRoot, group_id: &str) -> Result<Option<VaultGroup>> {
    let _guard = lock_groups_write();
    require_upriv_dir(root)?;
    let mut groups = load_vault_groups_for_mutate(root)?;
    let Some(idx) = find_group_index(&groups, group_id) else {
        return Ok(None);
    };
    let removed = groups.remove(idx);
    save_vault_groups(root, &groups)?;
    Ok(Some(removed))
}

fn normalize_grouped_vault_sort(mode: &str) -> Option<&'static str> {
    match mode.trim() {
        "order" => Some("order"),
        "name" => Some("name"),
        "state" => Some("state"),
        "last_accessed" => Some("last_accessed"),
        _ => None,
    }
}

fn normalize_grouped_vault_sort_direction(direction: &str) -> Option<&'static str> {
    match direction.trim() {
        "asc" => Some("asc"),
        "desc" => Some("desc"),
        _ => None,
    }
}

/// Result of [`create_vault_group_with_sort`]: the new group and whether siblings lost vaults.
#[derive(Debug, Clone)]
pub struct VaultGroupCreate {
    pub group: VaultGroup,
    /// True when creating with members removed those vaults from sibling groups.
    pub sibling_vaults_moved: bool,
}

/// Result of [`update_vault_group`]: the saved group and whether membership moved.
#[derive(Debug, Clone)]
pub struct VaultGroupUpdate {
    pub group: VaultGroup,
    /// True when this group's `grouped_vaults` changed, or exclusivity removed a
    /// vault from a sibling (assign / ungroup / picker).
    pub grouped_vaults_changed: bool,
    /// True when `hidden` flipped from false to true (log `vault_group_hidden`).
    pub hidden_became_true: bool,
}

/// Optional fields for [`update_vault_group`] (avoids an 8-arg clippy hit).
#[derive(Debug, Clone, Default)]
pub struct UpdateVaultGroupParams<'a> {
    pub display_name: Option<&'a str>,
    pub collapsed: Option<bool>,
    pub order: Option<i64>,
    pub grouped_vaults: Option<&'a [String]>,
    pub grouped_vault_sort: Option<&'a str>,
    pub grouped_vault_sort_direction: Option<&'a str>,
    pub hidden: Option<bool>,
}

/// Update display_name / collapsed / grouped_vaults / order / sort for one group.
pub fn update_vault_group(
    root: &VaultRoot,
    group_id: &str,
    params: UpdateVaultGroupParams<'_>,
) -> Result<VaultGroupUpdate> {
    let _guard = lock_groups_write();
    update_vault_group_locked(root, group_id, params)
}

fn update_vault_group_locked(
    root: &VaultRoot,
    group_id: &str,
    params: UpdateVaultGroupParams<'_>,
) -> Result<VaultGroupUpdate> {
    require_upriv_dir(root)?;
    let mut groups = load_vault_groups_for_mutate(root)?;
    let idx = find_group_index(&groups, group_id)
        .ok_or_else(|| UprivError::VaultGroupNotFound(group_id.trim().to_string()))?;
    let was_hidden = groups[idx].hidden;

    if let Some(name) = params.display_name {
        let name = crate::paths::normalize_stored_name(name);
        if name.is_empty() {
            return Err(groups_invalid(root, "display_name is empty"));
        }
        groups[idx].display_name = name;
    }
    if let Some(c) = params.collapsed {
        groups[idx].collapsed = c;
    }
    if let Some(o) = params.order {
        groups[idx].order = o;
    }
    if let Some(mode) = params.grouped_vault_sort {
        let Some(normalized) = normalize_grouped_vault_sort(mode) else {
            return Err(groups_invalid(
                root,
                format!("invalid grouped_vault_sort: {mode}"),
            ));
        };
        groups[idx].grouped_vault_sort = normalized.to_string();
    }
    if let Some(direction) = params.grouped_vault_sort_direction {
        let Some(normalized) = normalize_grouped_vault_sort_direction(direction) else {
            return Err(groups_invalid(
                root,
                format!("invalid grouped_vault_sort_direction: {direction}"),
            ));
        };
        groups[idx].grouped_vault_sort_direction = normalized.to_string();
    }
    let previous_members = groups[idx].grouped_vaults.clone();
    let mut grouped_vaults_changed = false;
    if let Some(grouped_vaults) = params.grouped_vaults {
        let clean = trim_vault_ids(grouped_vaults);
        let vault_set: HashSet<&str> = clean.iter().map(|s| s.as_str()).collect();
        for (i, group) in groups.iter_mut().enumerate() {
            if i == idx {
                continue;
            }
            let before = group.grouped_vaults.len();
            group
                .grouped_vaults
                .retain(|m| !vault_set.contains(m.as_str()));
            if group.grouped_vaults.len() != before {
                grouped_vaults_changed = true;
            }
        }
        for m in &clean {
            require_assignable_vault(root, m)?;
        }
        if groups[idx].grouped_vaults != clean {
            grouped_vaults_changed = true;
        }
        groups[idx].grouped_vaults = clean;
    }
    if let Some(hidden) = params.hidden {
        groups[idx].hidden = hidden;
    }
    let dest_hidden = groups[idx].hidden;
    let current_members = groups[idx].grouped_vaults.clone();
    let becoming_hidden = dest_hidden && !was_hidden;
    let hide_ids = if dest_hidden {
        if becoming_hidden {
            unique_vault_ids(&previous_members, &current_members)
        } else {
            current_members.clone()
        }
    } else {
        Vec::new()
    };
    let unhide_ids = if dest_hidden {
        Vec::new()
    } else if was_hidden {
        unique_vault_ids(&previous_members, &current_members)
    } else {
        current_members
            .iter()
            .filter(|id| !previous_members.contains(id))
            .cloned()
            .collect()
    };
    let mut applied = Vec::new();
    if !hide_ids.is_empty() {
        applied.extend(set_grouped_vaults_hidden(root, &hide_ids, true)?);
    }
    if !unhide_ids.is_empty() {
        match set_grouped_vaults_hidden(root, &unhide_ids, false) {
            Ok(more) => applied.extend(more),
            Err(error) => {
                revert_vault_hidden(&applied);
                return Err(error);
            }
        }
    }

    let updated = groups[idx].clone();
    let hidden_became_true = updated.hidden && !was_hidden;
    if let Err(error) = save_vault_groups(root, &groups) {
        revert_vault_hidden(&applied);
        return Err(error);
    }
    Ok(VaultGroupUpdate {
        group: updated,
        grouped_vaults_changed,
        hidden_became_true,
    })
}

/// Persist root-level `order` values for the listed groups (one round-trip).
pub fn reorder_vault_groups(root: &VaultRoot, orders: &[(String, i64)]) -> Result<Vec<VaultGroup>> {
    let _guard = lock_groups_write();
    require_upriv_dir(root)?;
    let mut groups = load_vault_groups_for_mutate(root)?;
    for (id, order) in orders {
        let idx = find_group_index(&groups, id)
            .ok_or_else(|| UprivError::VaultGroupNotFound(id.trim().to_string()))?;
        groups[idx].order = *order;
    }
    save_vault_groups(root, &groups)?;
    Ok(groups)
}

fn same_id_multiset(left: &[String], right: &[String]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut a = left.to_vec();
    let mut b = right.to_vec();
    a.sort();
    b.sort();
    a == b
}

/// Permute existing grouped-vault membership. Rejects a different id set.
pub fn reorder_vault_group_grouped_vaults(
    root: &VaultRoot,
    group_id: &str,
    ordered_vault_ids: &[String],
) -> Result<VaultGroup> {
    let _guard = lock_groups_write();
    require_upriv_dir(root)?;
    let mut groups = load_vault_groups_for_mutate(root)?;
    let idx = find_group_index(&groups, group_id)
        .ok_or_else(|| UprivError::VaultGroupNotFound(group_id.trim().to_string()))?;

    let current = trim_vault_ids(&groups[idx].grouped_vaults);
    let clean = trim_vault_ids(ordered_vault_ids);
    if !same_id_multiset(&current, &clean) {
        return Err(groups_invalid(
            root,
            "reorder grouped_vaults must be a permutation of current membership",
        ));
    }
    groups[idx].grouped_vaults = clean;
    let updated = groups[idx].clone();
    save_vault_groups(root, &groups)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn root_with_vaults(ids: &[&str]) -> (TempDir, VaultRoot) {
        let tmp = TempDir::new().unwrap();
        let root_path = tmp.path().to_path_buf();
        std::fs::create_dir_all(root_path.join(".upriv/vaults")).unwrap();
        std::fs::write(
            root_path.join(".upriv/settings.toml"),
            "[package]\nvaults_dir = \".upriv/vaults\"\n",
        )
        .unwrap();
        for id in ids {
            let dir = root_path.join(".upriv/vaults").join(id);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("config.toml"),
                format!("[vault]\nid = \"{id}\"\ndisplay_name = \"{id}\"\n"),
            )
            .unwrap();
        }
        let root = VaultRoot::discover(&root_path).unwrap();
        (tmp, root)
    }

    fn disk_body(root: &VaultRoot) -> String {
        std::fs::read_to_string(vault_groups_path(root)).unwrap()
    }

    #[test]
    fn absent_file_is_empty() {
        let (_tmp, root) = root_with_vaults(&["a"]);
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert!(loaded.groups.is_empty());
    }

    #[test]
    fn round_trip_create_and_load() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into(), "taxes".into()]).unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.groups.len(), 1);
        assert_eq!(loaded.groups[0].grouped_vaults, vec!["notes", "taxes"]);
        let body = disk_body(&root);
        assert!(body.contains("grouped_vaults"));
        assert!(body.contains("vaults/<id>/config.toml"));
        assert!(!body.contains("members ="));
        assert!(body.contains("grouped_vault_sort"));
        assert!(!body.contains("member_sort"));
    }

    #[test]
    fn writes_display_name_even_when_it_equals_id() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "trasdf", "trasdf", &[]).unwrap();
        let body = disk_body(&root);
        assert!(body.contains("display_name = \"trasdf\""));
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.groups[0].id, "trasdf");
        assert_eq!(loaded.groups[0].display_name, "trasdf");
    }

    #[test]
    fn keeps_display_name_when_it_differs_from_id() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "test-2", "test", &[]).unwrap();
        let body = disk_body(&root);
        assert!(body.contains("display_name = \"test\""));
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.groups[0].id, "test-2");
        assert_eq!(loaded.groups[0].display_name, "test");
    }

    #[test]
    fn collapses_internal_whitespace_in_display_name() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "work", "Work    Notes", &[]).unwrap();
        let body = disk_body(&root);
        assert!(body.contains("display_name = \"Work Notes\""));
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.groups[0].display_name, "Work Notes");
    }

    #[test]
    fn load_fills_display_name_from_id_when_omitted() {
        let raw = r#"
[[group]]
id = "trasdf"
grouped_vaults = []
"#;
        let parsed = parse_vault_groups_toml_str(raw).unwrap();
        assert_eq!(parsed.groups[0].display_name, "trasdf");
    }

    #[test]
    fn orphan_soft_dropped() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let path = vault_groups_path(&root);
        std::fs::write(
            &path,
            r#"
[[group]]
id = "work"
display_name = "Work"
grouped_vaults = ["notes", "gone"]
"#,
        )
        .unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.dropped_orphans, 1);
        assert_eq!(loaded.groups[0].grouped_vaults, vec!["notes"]);
    }

    #[test]
    fn dual_assignment_dropped_on_load_rejected_on_save() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        std::fs::write(
            vault_groups_path(&root),
            r#"
[[group]]
id = "a"
display_name = "A"
grouped_vaults = ["notes"]

[[group]]
id = "b"
display_name = "B"
grouped_vaults = ["notes"]
"#,
        )
        .unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.dropped_duplicate_assignments, 1);
        assert_eq!(loaded.groups[0].grouped_vaults, vec!["notes"]);
        assert!(loaded.groups[1].grouped_vaults.is_empty());

        // Mutate path soft-heals dual membership then persists.
        update_vault_group(
            &root,
            "a",
            UpdateVaultGroupParams {
                collapsed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let known = known_vault_ids(&root).unwrap();
        let after = load_vault_groups(&root, &known).unwrap();
        assert_eq!(after.dropped_duplicate_assignments, 0);
        assert_eq!(after.groups[0].grouped_vaults, vec!["notes"]);
        assert!(after.groups[1].grouped_vaults.is_empty());

        let err = save_vault_groups(
            &root,
            &[
                VaultGroup {
                    id: "a".into(),
                    display_name: "A".into(),
                    order: 1,
                    collapsed: false,
                    hidden: false,
                    grouped_vaults: vec!["notes".into()],
                    grouped_vault_sort: "order".into(),
                    grouped_vault_sort_direction: "asc".into(),
                },
                VaultGroup {
                    id: "b".into(),
                    display_name: "B".into(),
                    order: 2,
                    collapsed: false,
                    hidden: false,
                    grouped_vaults: vec!["notes".into()],
                    grouped_vault_sort: "order".into(),
                    grouped_vault_sort_direction: "asc".into(),
                },
            ],
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupsInvalid { .. }));
    }

    #[test]
    fn collapse_does_not_drop_orphans_or_invalid_config() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into(), "taxes".into()]).unwrap();
        std::fs::remove_dir_all(root.vault_dir("taxes").unwrap()).unwrap();
        std::fs::write(
            root.vault_dir("notes").unwrap().join("config.toml"),
            "not = [[[toml",
        )
        .unwrap();

        update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                collapsed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let body = disk_body(&root);
        assert!(body.contains("notes"));
        assert!(body.contains("taxes"));
        assert!(body.contains("collapsed = true"));
    }

    #[test]
    fn known_vault_ids_keeps_invalid_config_dir() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        std::fs::write(
            root.vault_dir("notes").unwrap().join("config.toml"),
            "broken",
        )
        .unwrap();
        let known = known_vault_ids(&root).unwrap();
        assert!(known.contains("notes"));
    }

    #[test]
    fn save_missing_upriv_does_not_recreate() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "work", "Work", &[]).unwrap();
        std::fs::remove_dir_all(root.root().join(".upriv")).unwrap();
        let err = update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                collapsed: Some(true),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultRootNotFound(_)));
        assert!(!root.root().join(".upriv").exists());
    }

    #[test]
    fn directory_at_groups_path_is_invalid() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let path = vault_groups_path(&root);
        std::fs::create_dir_all(&path).unwrap();
        let known = known_vault_ids(&root).unwrap();
        let err = load_vault_groups(&root, &known).unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupsInvalid { .. }));
    }

    #[test]
    fn update_missing_group_is_not_found() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let err = update_vault_group(
            &root,
            "missing",
            UpdateVaultGroupParams {
                collapsed: Some(true),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupNotFound(_)));
    }

    #[test]
    fn create_unknown_vault_vs_broken_config() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let err = create_vault_group(&root, "work", "Work", &["gone".into()]).unwrap_err();
        assert!(matches!(err, UprivError::VaultNotFound(_)));

        std::fs::create_dir_all(root.vault_dir("broken").unwrap()).unwrap();
        std::fs::write(
            root.vault_dir("broken").unwrap().join("config.toml"),
            "nope",
        )
        .unwrap();
        let err = create_vault_group(&root, "other", "Other", &["broken".into()]).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
    }

    #[test]
    fn create_trims_membership_before_retain() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "a", "A", &["notes".into()]).unwrap();
        create_vault_group(&root, "b", "B", &[" notes ".into()]).unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        let a = loaded.groups.iter().find(|g| g.id == "a").unwrap();
        let b = loaded.groups.iter().find(|g| g.id == "b").unwrap();
        assert!(a.grouped_vaults.is_empty());
        assert_eq!(b.grouped_vaults, vec!["notes"]);
    }

    #[test]
    fn invalid_sort_rejected_on_save() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let err = save_vault_groups(
            &root,
            &[VaultGroup {
                id: "work".into(),
                display_name: "Work".into(),
                order: 1,
                collapsed: false,
                hidden: false,
                grouped_vaults: vec![],
                grouped_vault_sort: "bogus".into(),
                grouped_vault_sort_direction: "asc".into(),
            }],
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupsInvalid { .. }));
    }

    #[test]
    fn invalid_group_id_rejected() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let err = create_vault_group(&root, "Foo Bar", "Work", &[]).unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupsInvalid { .. }));
        let err = create_vault_group(&root, "CON", "Work", &[]).unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupsInvalid { .. }));
    }

    #[test]
    fn lookup_trims_group_id() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "work", "Work", &[]).unwrap();
        update_vault_group(
            &root,
            " work ",
            UpdateVaultGroupParams {
                collapsed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert!(loaded.groups[0].collapsed);
    }

    #[test]
    fn reorder_rewrites_orders() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "a", "A", &[]).unwrap();
        create_vault_group(&root, "b", "B", &[]).unwrap();
        reorder_vault_groups(&root, &[("b".into(), 1), ("a".into(), 5)]).unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        let a = loaded.groups.iter().find(|g| g.id == "a").unwrap();
        let b = loaded.groups.iter().find(|g| g.id == "b").unwrap();
        assert_eq!(a.order, 5);
        assert_eq!(b.order, 1);
    }

    #[test]
    fn unknown_group_keys_are_rejected() {
        let raw = r#"
[[group]]
id = "work"
display_name = "Work"
grouped_vaults = ["notes"]
color = "red"
"#;
        assert!(parse_vault_groups_toml_str(raw).is_err());
    }

    #[test]
    fn legacy_members_and_member_sort_load() {
        let raw = r#"
[[group]]
id = "work"
display_name = "Work"
members = ["notes", "taxes"]
member_sort = "name"
"#;
        let parsed = parse_vault_groups_toml_str(raw).unwrap();
        assert_eq!(parsed.groups[0].grouped_vaults, vec!["notes", "taxes"]);
        assert_eq!(parsed.groups[0].grouped_vault_sort, "name");
    }

    #[test]
    fn grouped_vaults_key_is_required_shape() {
        let raw = r#"
[[group]]
id = "work"
display_name = "Work"
grouped_vaults = ["notes"]
grouped_vault_sort = "state"
grouped_vault_sort_direction = "asc"
"#;
        let parsed = parse_vault_groups_toml_str(raw).unwrap();
        assert_eq!(parsed.groups[0].grouped_vaults, vec!["notes"]);
        assert_eq!(parsed.groups[0].grouped_vault_sort, "state");
        assert_eq!(parsed.groups[0].grouped_vault_sort_direction, "asc");
    }

    #[test]
    fn invalid_toml_errors() {
        let (_tmp, root) = root_with_vaults(&[]);
        std::fs::write(vault_groups_path(&root), "not = [[[toml").unwrap();
        let known = known_vault_ids(&root).unwrap();
        let err = load_vault_groups(&root, &known).unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupsInvalid { .. }));
    }

    #[test]
    fn repair_backs_up_and_clears() {
        let (_tmp, root) = root_with_vaults(&["a"]);
        let path = vault_groups_path(&root);
        std::fs::write(&path, "broken [[[").unwrap();
        repair_vault_groups(&root).unwrap();
        assert!(
            path.with_extension("toml.bak").is_file()
                || path
                    .parent()
                    .unwrap()
                    .read_dir()
                    .unwrap()
                    .any(|e| { e.unwrap().file_name().to_string_lossy().contains("bak") })
        );
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert!(loaded.groups.is_empty());
        assert!(path.is_file());
    }

    #[test]
    fn unique_tmp_not_fixed_name() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "work", "Work", &[]).unwrap();
        let path = vault_groups_path(&root);
        let parent = path.parent().unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy() == "vault_groups.toml.tmp")
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn create_respects_optional_sort() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let created = create_vault_group_with_sort(
            &root,
            "work",
            "Work",
            &["notes".into()],
            Some("name"),
            Some("desc"),
            false,
        )
        .unwrap();
        assert_eq!(created.group.grouped_vault_sort, "name");
        assert_eq!(created.group.grouped_vault_sort_direction, "desc");
        assert!(!created.sibling_vaults_moved);
    }

    #[test]
    fn create_reports_sibling_vaults_moved() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "work", "Work", &["notes".into()]).unwrap();
        let created = create_vault_group_with_sort(
            &root,
            "home",
            "Home",
            &["notes".into()],
            None,
            None,
            false,
        )
        .unwrap();
        assert!(created.sibling_vaults_moved);
        assert_eq!(created.group.grouped_vaults, vec!["notes"]);
    }

    #[test]
    fn reorder_grouped_vaults_permutes_only() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into(), "taxes".into()]).unwrap();
        let group =
            reorder_vault_group_grouped_vaults(&root, "work", &["taxes".into(), "notes".into()])
                .unwrap();
        assert_eq!(group.grouped_vaults, vec!["taxes", "notes"]);

        let err = reorder_vault_group_grouped_vaults(&root, "work", &["notes".into()]).unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupsInvalid { .. }));
    }

    #[test]
    fn update_reports_grouped_vaults_moved() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into()]).unwrap();
        create_vault_group(&root, "home", "Home", &[]).unwrap();

        let collapse = update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                collapsed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!collapse.grouped_vaults_changed);

        let assigned = update_vault_group(
            &root,
            "home",
            UpdateVaultGroupParams {
                grouped_vaults: Some(&["notes".into()][..]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(assigned.grouped_vaults_changed);
        assert_eq!(assigned.group.grouped_vaults, vec!["notes"]);

        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        let work = loaded.groups.iter().find(|g| g.id == "work").unwrap();
        assert!(work.grouped_vaults.is_empty());

        let same = update_vault_group(
            &root,
            "home",
            UpdateVaultGroupParams {
                grouped_vaults: Some(&["notes".into()][..]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!same.grouped_vaults_changed);

        let ungrouped = update_vault_group(
            &root,
            "home",
            UpdateVaultGroupParams {
                grouped_vaults: Some(&[][..]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(ungrouped.grouped_vaults_changed);
        assert!(ungrouped.group.grouped_vaults.is_empty());
    }

    fn vault_is_hidden(root: &VaultRoot, id: &str) -> bool {
        crate::config::vault_config::load_vault_config(root.vault_dir(id).unwrap())
            .unwrap()
            .vault
            .hidden
    }

    #[test]
    fn hiding_group_cascades_vault_hidden_and_unhide_restores() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into(), "taxes".into()]).unwrap();
        assert!(!vault_is_hidden(&root, "notes"));

        update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                hidden: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert!(loaded.groups[0].hidden);
        assert!(vault_is_hidden(&root, "notes"));
        assert!(vault_is_hidden(&root, "taxes"));

        update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                hidden: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert!(!loaded.groups[0].hidden);
        assert!(!vault_is_hidden(&root, "notes"));
        assert!(!vault_is_hidden(&root, "taxes"));
    }

    #[test]
    fn assign_into_hidden_group_hides_vault() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group_with_sort(&root, "work", "Work", &["notes".into()], None, None, true)
            .unwrap();
        assert!(vault_is_hidden(&root, "notes"));
        assert!(!vault_is_hidden(&root, "taxes"));

        update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                grouped_vaults: Some(&["notes".into(), "taxes".into()][..]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(vault_is_hidden(&root, "taxes"));
    }

    #[test]
    fn delete_hidden_group_leaves_vaults_hidden() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group_with_sort(&root, "work", "Work", &["notes".into()], None, None, true)
            .unwrap();
        delete_vault_group(&root, "work").unwrap();
        assert!(vault_is_hidden(&root, "notes"));
    }

    #[test]
    fn hiding_and_shrinking_membership_hides_removed_vaults() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into(), "taxes".into()]).unwrap();
        update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                grouped_vaults: Some(&["notes".into()][..]),
                hidden: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(vault_is_hidden(&root, "notes"));
        assert!(vault_is_hidden(&root, "taxes"));
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.groups[0].grouped_vaults, vec!["notes"]);
        assert!(loaded.groups[0].hidden);
    }

    #[test]
    fn hiding_group_validates_members_before_writing_hidden() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into(), "taxes".into()]).unwrap();
        std::fs::write(
            root.vault_dir("taxes").unwrap().join("config.toml"),
            "not = [[[toml",
        )
        .unwrap();
        let err = update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                hidden: Some(true),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigInvalid { .. }));
        assert!(!vault_is_hidden(&root, "notes"));
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert!(!loaded.groups[0].hidden);
    }

    #[test]
    fn moving_vault_from_hidden_group_to_visible_unhides() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group_with_sort(
            &root,
            "secret",
            "Secret",
            &["notes".into()],
            None,
            None,
            true,
        )
        .unwrap();
        create_vault_group(&root, "visible", "Visible", &[]).unwrap();
        update_vault_group(
            &root,
            "visible",
            UpdateVaultGroupParams {
                grouped_vaults: Some(&["notes".into()][..]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!vault_is_hidden(&root, "notes"));
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        let secret = loaded.groups.iter().find(|g| g.id == "secret").unwrap();
        let visible = loaded.groups.iter().find(|g| g.id == "visible").unwrap();
        assert!(secret.grouped_vaults.is_empty());
        assert_eq!(visible.grouped_vaults, vec!["notes"]);
    }

    #[test]
    fn create_visible_group_unhides_stolen_members() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group_with_sort(
            &root,
            "secret",
            "Secret",
            &["notes".into()],
            None,
            None,
            true,
        )
        .unwrap();
        create_vault_group(&root, "open", "Open", &["notes".into()]).unwrap();
        assert!(!vault_is_hidden(&root, "notes"));
    }

    #[test]
    fn hiding_group_skips_mount_revalidation() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        create_vault_group(&root, "work", "Work", &["notes".into(), "taxes".into()]).unwrap();
        std::fs::write(
            root.vault_dir("taxes").unwrap().join("config.toml"),
            "[vault]\nid = \"taxes\"\ndisplay_name = \"taxes\"\n[mount]\nworkspace_path = \"relative\"\n",
        )
        .unwrap();
        update_vault_group(
            &root,
            "work",
            UpdateVaultGroupParams {
                hidden: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(vault_hidden_raw(&root, "notes"));
        assert!(vault_hidden_raw(&root, "taxes"));
    }

    fn vault_hidden_raw(root: &VaultRoot, id: &str) -> bool {
        crate::config::vault_config::load_vault_config_raw(root.vault_dir(id).unwrap())
            .unwrap()
            .vault
            .hidden
    }
}
