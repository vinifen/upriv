//! System suspend hooks — Linux logind integration is planned; frontend listens for
//! `system-suspend` events when a platform watcher is available.

use tauri::AppHandle;

pub fn spawn_suspend_watcher(_app: AppHandle) {}
