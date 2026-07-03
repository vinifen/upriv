use serde::{Deserialize, Serialize};

fn default_vaults_dir() -> String {
    ".upriv/vaults".to_string()
}

fn default_state_file() -> String {
    ".upriv/state.json".to_string()
}

fn default_logs_dir() -> String {
    ".upriv/logs".to_string()
}

fn default_app_dir() -> String {
    ".upriv/app".to_string()
}

fn default_workspace_dir() -> String {
    "workspace".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub package: PackageSection,
    #[serde(default)]
    pub ui: UiSection,
    #[serde(default)]
    pub logging: LoggingSection,
    #[serde(default)]
    pub app: AppSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageSection {
    #[serde(default = "default_package_version")]
    pub version: u32,
    #[serde(default)]
    pub label: String,
    #[serde(default = "default_vaults_dir")]
    pub vaults_dir: String,
    #[serde(default = "default_state_file")]
    pub state_file: String,
    #[serde(default = "default_logs_dir")]
    pub logs_dir: String,
    #[serde(default = "default_app_dir")]
    pub app_dir: String,
    #[serde(default = "default_workspace_dir")]
    pub workspace_dir: String,
    #[serde(default)]
    pub default_vault: Option<String>,
}

fn default_package_version() -> u32 {
    1
}

impl Default for PackageSection {
    fn default() -> Self {
        Self {
            version: default_package_version(),
            label: String::new(),
            vaults_dir: default_vaults_dir(),
            state_file: default_state_file(),
            logs_dir: default_logs_dir(),
            app_dir: default_app_dir(),
            workspace_dir: default_workspace_dir(),
            default_vault: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UiSection {
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub vault_list_sort: Option<String>,
    #[serde(default)]
    pub vault_list_sort_direction: Option<String>,
    #[serde(default)]
    pub vault_list_view: Option<String>,
    #[serde(default)]
    pub always_show_hidden_vaults: bool,
    #[serde(default)]
    pub file_manager_dock_expanded: bool,
}

fn default_locale() -> String {
    "en".to_string()
}

fn default_theme() -> String {
    "dark".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingSection {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_entries_per_file")]
    pub entries_per_file: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_last_entries: Option<u32>,
}

fn default_true() -> bool {
    true
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_entries_per_file() -> u32 {
    1000
}

impl Default for LoggingSection {
    fn default() -> Self {
        Self {
            enabled: default_true(),
            level: default_log_level(),
            entries_per_file: default_entries_per_file(),
            keep_last_entries: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppSection {
    #[serde(default = "default_true")]
    pub auto_detect_vault_root: bool,
    #[serde(default)]
    pub last_opened_vault: Option<String>,
}
