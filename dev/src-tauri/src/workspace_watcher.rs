//! Debounced filesystem watcher for open vault workspaces.
//!
//! Emits `workspace-changed` when files are edited outside the in-app file manager
//! (system file manager, external editors, etc.).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use upriv_core::{load_app_settings, load_vault_config, VaultRoot};

use crate::commands::map_error_public;

pub const WORKSPACE_CHANGED_EVENT: &str = "workspace-changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangedPayload {
    pub vault_id: String,
    pub paths: Vec<String>,
}

pub struct WorkspaceWatchers(Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher>>>);

impl WorkspaceWatchers {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

fn workspace_dir(vault_root: &str, vault_id: &str) -> Result<PathBuf, String> {
    let root = VaultRoot::discover(vault_root).map_err(map_error_public)?;
    let settings = load_app_settings(&root).map_err(map_error_public)?;
    let config = load_vault_config(&root, vault_id).map_err(map_error_public)?;
    Ok(root.workspace_dir(&settings, &config.vault.display_name))
}

fn rel_path(workspace: &Path, event_path: &Path) -> Option<String> {
    let rel = event_path.strip_prefix(workspace).ok()?;
    let normalized = rel.to_string_lossy().replace('\\', "/");
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

#[tauri::command]
pub fn workspace_watch_start(
    app: AppHandle,
    watchers: State<'_, WorkspaceWatchers>,
    vault_root: String,
    vault_id: String,
) -> Result<(), String> {
    let workspace = workspace_dir(&vault_root, &vault_id)?;
    if !workspace.is_dir() {
        return Ok(());
    }

    let mut guard = watchers.0.lock().map_err(|_| "workspace watcher lock poisoned".to_string())?;
    if guard.contains_key(&vault_id) {
        return Ok(());
    }

    let vault_id_for_cb = vault_id.clone();
    let workspace_for_cb = workspace.clone();
    let app_for_cb = app.clone();

    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        let Ok(events) = res else {
            return;
        };
        let mut paths = HashSet::new();
        for event in events {
            if let Some(rel) = rel_path(&workspace_for_cb, &event.path) {
                paths.insert(rel);
            }
        }
        if paths.is_empty() {
            return;
        }
        let mut sorted: Vec<String> = paths.into_iter().collect();
        sorted.sort();
        let _ = app_for_cb.emit(
            WORKSPACE_CHANGED_EVENT,
            WorkspaceChangedPayload {
                vault_id: vault_id_for_cb.clone(),
                paths: sorted,
            },
        );
    })
    .map_err(|err| err.to_string())?;

    debouncer
        .watcher()
        .watch(&workspace, RecursiveMode::Recursive)
        .map_err(|err| err.to_string())?;

    guard.insert(vault_id, debouncer);
    Ok(())
}

#[tauri::command]
pub fn workspace_watch_stop(watchers: State<'_, WorkspaceWatchers>, vault_id: String) -> Result<(), String> {
    let mut guard = watchers.0.lock().map_err(|_| "workspace watcher lock poisoned".to_string())?;
    guard.remove(&vault_id);
    Ok(())
}
