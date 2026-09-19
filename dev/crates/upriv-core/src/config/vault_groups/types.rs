//! On-disk shape of `.upriv/vault_groups.toml`.

use serde::{Deserialize, Serialize};

fn default_grouped_vault_sort() -> String {
    "order".into()
}

fn default_grouped_vault_sort_direction() -> String {
    "asc".into()
}

/// One vault group — organizational only (not a vault).
///
/// `display_name` is the list title. Omitted on old files fills from `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultGroup {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub collapsed: bool,
    /// Hide this group (and cascade `[vault].hidden` on members; unhide restores). Default false.
    #[serde(default)]
    pub hidden: bool,
    /// Vault ids in this group — array order is the manual in-group order
    /// (`grouped_vault_sort = "order"`). Legacy key `members` is accepted on load.
    #[serde(default, alias = "members")]
    pub grouped_vaults: Vec<String>,
    /// In-group vault sort mode: `order` | `name` | `state` | `last_accessed`.
    /// Legacy key `member_sort` is accepted on load.
    #[serde(default = "default_grouped_vault_sort", alias = "member_sort")]
    pub grouped_vault_sort: String,
    #[serde(default = "default_grouped_vault_sort_direction")]
    pub grouped_vault_sort_direction: String,
}

impl VaultGroup {
    /// Trim `id`; empty / omitted `display_name` → `id`. Collapse internal spaces.
    pub fn resolve_identity(&mut self) {
        self.id = self.id.trim().to_string();
        let name = crate::paths::normalize_stored_name(&self.display_name);
        self.display_name = if name.is_empty() {
            self.id.clone()
        } else {
            name
        };
    }
}

/// Root document: list of `[[group]]` tables.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct VaultGroupsFile {
    #[serde(default, rename = "group")]
    pub groups: Vec<VaultGroup>,
}

/// Successful load (possibly with soft sanitation applied in memory).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedVaultGroups {
    pub groups: Vec<VaultGroup>,
    /// Orphan grouped-vault ids dropped (vault folder missing).
    pub dropped_orphans: usize,
    /// Extra assignments dropped when a vault appeared in more than one group.
    pub dropped_duplicate_assignments: usize,
}
