//! On-disk shape of `.upriv/vault_groups.toml`.

use serde::{Deserialize, Deserializer, Serialize};

fn default_grouped_vault_sort() -> String {
    "order".into()
}

fn default_grouped_vault_sort_direction() -> String {
    "asc".into()
}

/// One vault group — organizational only (not a vault).
///
/// Soft migrate (read): accept legacy TOML keys `members` / `member_sort` /
/// `member_sort_direction`. Prefer new keys when both are present. Serialize emits
/// only `grouped_vaults` / `grouped_vault_sort` / `grouped_vault_sort_direction`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultGroup {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub collapsed: bool,
    /// Vault ids in this group — array order is the manual in-group order
    /// (`grouped_vault_sort = "order"`).
    #[serde(default)]
    pub grouped_vaults: Vec<String>,
    /// In-group vault sort mode: `order` | `name` | `state` | `last_accessed`.
    #[serde(default = "default_grouped_vault_sort")]
    pub grouped_vault_sort: String,
    #[serde(default = "default_grouped_vault_sort_direction")]
    pub grouped_vault_sort_direction: String,
}

#[derive(Debug, Deserialize)]
struct VaultGroupDe {
    id: String,
    display_name: String,
    #[serde(default)]
    order: i64,
    #[serde(default)]
    collapsed: bool,
    #[serde(default)]
    grouped_vaults: Option<Vec<String>>,
    /// Legacy key — prefer `grouped_vaults` when both present.
    #[serde(default)]
    members: Option<Vec<String>>,
    #[serde(default)]
    grouped_vault_sort: Option<String>,
    #[serde(default)]
    member_sort: Option<String>,
    #[serde(default)]
    grouped_vault_sort_direction: Option<String>,
    #[serde(default)]
    member_sort_direction: Option<String>,
}

impl From<VaultGroupDe> for VaultGroup {
    fn from(raw: VaultGroupDe) -> Self {
        Self {
            id: raw.id,
            display_name: raw.display_name,
            order: raw.order,
            collapsed: raw.collapsed,
            grouped_vaults: raw.grouped_vaults.or(raw.members).unwrap_or_default(),
            grouped_vault_sort: raw
                .grouped_vault_sort
                .or(raw.member_sort)
                .unwrap_or_else(default_grouped_vault_sort),
            grouped_vault_sort_direction: raw
                .grouped_vault_sort_direction
                .or(raw.member_sort_direction)
                .unwrap_or_else(default_grouped_vault_sort_direction),
        }
    }
}

impl<'de> Deserialize<'de> for VaultGroup {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        VaultGroupDe::deserialize(deserializer).map(Into::into)
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
