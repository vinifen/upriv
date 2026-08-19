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

use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;

pub use types::{LoadedVaultGroups, VaultGroup, VaultGroupsFile};

pub const VAULT_GROUPS_FILE_NAME: &str = "vault_groups.toml";

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
    let parsed: VaultGroupsFile =
        toml::from_str(raw).map_err(|error| UprivError::VaultGroupsInvalid {
            path: PathBuf::from(VAULT_GROUPS_FILE_NAME),
            detail: format!("invalid vault_groups.toml: {error}"),
        })?;
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
        if group.display_name.trim().is_empty() {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.to_path_buf(),
                detail: format!("[[group]].display_name is empty for id {id}"),
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
    let dir = root.vault_dir(vault_id);
    if !dir.is_dir() {
        return Err(UprivError::VaultNotFound(dir));
    }
    crate::config::vault_config::load_vault_config(&dir)?;
    Ok(())
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
        group.id = group.id.trim().to_string();
        group.display_name = group.display_name.trim().to_string();

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
    let parsed: VaultGroupsFile =
        toml::from_str(&raw).map_err(|error| UprivError::VaultGroupsInvalid {
            path: path.clone(),
            detail: format!("invalid vault_groups.toml: {error}"),
        })?;
    validate_schema(&parsed, &path)?;
    Ok(Some(parsed))
}

fn trim_group_headers(file: VaultGroupsFile) -> VaultGroupsFile {
    VaultGroupsFile {
        groups: file
            .groups
            .into_iter()
            .map(|mut group| {
                group.id = group.id.trim().to_string();
                group.display_name = group.display_name.trim().to_string();
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
        group.id = group.id.trim().to_string();
        group.display_name = group.display_name.trim().to_string();
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
pub fn serialize_vault_groups(groups: &[VaultGroup]) -> Result<String> {
    let file = VaultGroupsFile {
        groups: groups.to_vec(),
    };
    toml::to_string_pretty(&file).map_err(|error| UprivError::VaultGroupsInvalid {
        path: PathBuf::from(VAULT_GROUPS_FILE_NAME),
        detail: format!("serialize vault_groups.toml failed: {error}"),
    })
}

fn prepare_groups_for_write(root: &VaultRoot, groups: &[VaultGroup]) -> Result<Vec<VaultGroup>> {
    let path = vault_groups_path(root);
    let mut out = Vec::with_capacity(groups.len());
    let mut seen_ids = HashSet::new();
    let mut claimed = HashSet::new();

    for group in groups {
        let id = group.id.trim().to_string();
        let display_name = group.display_name.trim().to_string();
        if !crate::paths::slug_id_is_valid(&id) {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.clone(),
                detail: format!("invalid [[group]].id: {id}"),
            });
        }
        if display_name.is_empty() {
            return Err(UprivError::VaultGroupsInvalid {
                path: path.clone(),
                detail: format!("[[group]].display_name is empty for id {id}"),
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
            grouped_vaults,
            grouped_vault_sort: sort.to_string(),
            grouped_vault_sort_direction: direction.to_string(),
        });
    }
    Ok(out)
}

/// Atomic write via [`crate::paths::write_bytes_atomic_existing_parent`].
/// Never creates `.upriv/` (mid-session Case B must stay not-found).
pub fn save_vault_groups(root: &VaultRoot, groups: &[VaultGroup]) -> Result<()> {
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

/// Create a group (empty grouped_vaults unless provided). Sort defaults to order/asc.
pub fn create_vault_group(
    root: &VaultRoot,
    id: &str,
    display_name: &str,
    grouped_vaults: &[String],
) -> Result<VaultGroup> {
    create_vault_group_with_sort(root, id, display_name, grouped_vaults, None, None)
}

/// Create a group with optional grouped-vault sort (same defaults as [`create_vault_group`]).
pub fn create_vault_group_with_sort(
    root: &VaultRoot,
    id: &str,
    display_name: &str,
    grouped_vaults: &[String],
    grouped_vault_sort: Option<&str>,
    grouped_vault_sort_direction: Option<&str>,
) -> Result<VaultGroup> {
    let _guard = lock_groups_write();
    require_upriv_dir(root)?;
    let id = id.trim();
    let display_name = display_name.trim();
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
    for group in &mut groups {
        group
            .grouped_vaults
            .retain(|m| !vault_set.contains(m.as_str()));
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
    let group = VaultGroup {
        id: id.to_string(),
        display_name: display_name.to_string(),
        order,
        collapsed: false,
        grouped_vaults: clean_grouped,
        grouped_vault_sort: sort,
        grouped_vault_sort_direction: direction,
    };
    groups.push(group.clone());
    save_vault_groups(root, &groups)?;
    Ok(group)
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

/// Update display_name / collapsed / grouped_vaults / order / sort for one group.
pub fn update_vault_group(
    root: &VaultRoot,
    group_id: &str,
    display_name: Option<&str>,
    collapsed: Option<bool>,
    order: Option<i64>,
    grouped_vaults: Option<&[String]>,
    grouped_vault_sort: Option<&str>,
    grouped_vault_sort_direction: Option<&str>,
) -> Result<VaultGroup> {
    let _guard = lock_groups_write();
    update_vault_group_locked(
        root,
        group_id,
        display_name,
        collapsed,
        order,
        grouped_vaults,
        grouped_vault_sort,
        grouped_vault_sort_direction,
    )
}

fn update_vault_group_locked(
    root: &VaultRoot,
    group_id: &str,
    display_name: Option<&str>,
    collapsed: Option<bool>,
    order: Option<i64>,
    grouped_vaults: Option<&[String]>,
    grouped_vault_sort: Option<&str>,
    grouped_vault_sort_direction: Option<&str>,
) -> Result<VaultGroup> {
    require_upriv_dir(root)?;
    let mut groups = load_vault_groups_for_mutate(root)?;
    let idx = find_group_index(&groups, group_id)
        .ok_or_else(|| UprivError::VaultGroupNotFound(group_id.trim().to_string()))?;

    if let Some(name) = display_name {
        let name = name.trim();
        if name.is_empty() {
            return Err(groups_invalid(root, "display_name is empty"));
        }
        groups[idx].display_name = name.to_string();
    }
    if let Some(c) = collapsed {
        groups[idx].collapsed = c;
    }
    if let Some(o) = order {
        groups[idx].order = o;
    }
    if let Some(mode) = grouped_vault_sort {
        let Some(normalized) = normalize_grouped_vault_sort(mode) else {
            return Err(groups_invalid(
                root,
                format!("invalid grouped_vault_sort: {mode}"),
            ));
        };
        groups[idx].grouped_vault_sort = normalized.to_string();
    }
    if let Some(direction) = grouped_vault_sort_direction {
        let Some(normalized) = normalize_grouped_vault_sort_direction(direction) else {
            return Err(groups_invalid(
                root,
                format!("invalid grouped_vault_sort_direction: {direction}"),
            ));
        };
        groups[idx].grouped_vault_sort_direction = normalized.to_string();
    }
    if let Some(grouped_vaults) = grouped_vaults {
        let clean = trim_vault_ids(grouped_vaults);
        let vault_set: HashSet<&str> = clean.iter().map(|s| s.as_str()).collect();
        for (i, group) in groups.iter_mut().enumerate() {
            if i == idx {
                continue;
            }
            group
                .grouped_vaults
                .retain(|m| !vault_set.contains(m.as_str()));
        }
        for m in &clean {
            require_assignable_vault(root, m)?;
        }
        groups[idx].grouped_vaults = clean;
    }

    let updated = groups[idx].clone();
    save_vault_groups(root, &groups)?;
    Ok(updated)
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
        assert!(!body.contains("members ="));
        assert!(body.contains("grouped_vault_sort"));
        assert!(!body.contains("member_sort"));
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
        assert_eq!(loaded.groups[1].grouped_vaults.is_empty(), true);

        // Mutate path soft-heals dual membership then persists.
        update_vault_group(&root, "a", None, Some(true), None, None, None, None).unwrap();
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
                    grouped_vaults: vec!["notes".into()],
                    grouped_vault_sort: "order".into(),
                    grouped_vault_sort_direction: "asc".into(),
                },
                VaultGroup {
                    id: "b".into(),
                    display_name: "B".into(),
                    order: 2,
                    collapsed: false,
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
        std::fs::remove_dir_all(root.vault_dir("taxes")).unwrap();
        std::fs::write(root.vault_dir("notes").join("config.toml"), "not = [[[toml").unwrap();

        update_vault_group(&root, "work", None, Some(true), None, None, None, None).unwrap();
        let body = disk_body(&root);
        assert!(body.contains("notes"));
        assert!(body.contains("taxes"));
        assert!(body.contains("collapsed = true"));
    }

    #[test]
    fn known_vault_ids_keeps_invalid_config_dir() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        std::fs::write(root.vault_dir("notes").join("config.toml"), "broken").unwrap();
        let known = known_vault_ids(&root).unwrap();
        assert!(known.contains("notes"));
    }

    #[test]
    fn save_missing_upriv_does_not_recreate() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        create_vault_group(&root, "work", "Work", &[]).unwrap();
        std::fs::remove_dir_all(root.root().join(".upriv")).unwrap();
        let err = update_vault_group(&root, "work", None, Some(true), None, None, None, None)
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
        let err = update_vault_group(&root, "missing", None, Some(true), None, None, None, None)
            .unwrap_err();
        assert!(matches!(err, UprivError::VaultGroupNotFound(_)));
    }

    #[test]
    fn create_unknown_vault_vs_broken_config() {
        let (_tmp, root) = root_with_vaults(&["notes"]);
        let err = create_vault_group(&root, "work", "Work", &["gone".into()]).unwrap_err();
        assert!(matches!(err, UprivError::VaultNotFound(_)));

        std::fs::create_dir_all(root.vault_dir("broken")).unwrap();
        std::fs::write(root.vault_dir("broken").join("config.toml"), "nope").unwrap();
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
        update_vault_group(&root, " work ", None, Some(true), None, None, None, None).unwrap();
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
    fn legacy_members_keys_soft_migrate() {
        let (_tmp, root) = root_with_vaults(&["notes", "taxes"]);
        let path = vault_groups_path(&root);
        std::fs::write(
            &path,
            r#"
[[group]]
id = "work"
display_name = "Work"
member_sort = "name"
member_sort_direction = "desc"
members = ["notes", "taxes"]
"#,
        )
        .unwrap();
        let known = known_vault_ids(&root).unwrap();
        let loaded = load_vault_groups(&root, &known).unwrap();
        assert_eq!(loaded.groups[0].grouped_vaults, vec!["notes", "taxes"]);
        assert_eq!(loaded.groups[0].grouped_vault_sort, "name");
        assert_eq!(loaded.groups[0].grouped_vault_sort_direction, "desc");
    }

    #[test]
    fn prefer_new_keys_when_both_present() {
        let raw = r#"
[[group]]
id = "work"
display_name = "Work"
members = ["old"]
grouped_vaults = ["notes"]
member_sort = "name"
grouped_vault_sort = "state"
member_sort_direction = "desc"
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
        let group = create_vault_group_with_sort(
            &root,
            "work",
            "Work",
            &["notes".into()],
            Some("name"),
            Some("desc"),
        )
        .unwrap();
        assert_eq!(group.grouped_vault_sort, "name");
        assert_eq!(group.grouped_vault_sort_direction, "desc");
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
}
