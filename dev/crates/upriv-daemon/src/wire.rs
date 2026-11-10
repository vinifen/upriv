use serde::{Deserialize, Serialize};
use serde_json::Value;

use upriv_rpc::{handle_rpc, RpcErrorBody, RpcRequest};

/// Stdio transport envelope (`type: "request"`). Fields map 1:1 to `RpcRequest` in `upriv-rpc`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WireIn {
    Request {
        id: u64,
        method: String,
        #[serde(default)]
        params: Value,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WireOut {
    Ready,
    Response {
        id: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<RpcErrorBody>,
    },
    Event {
        name: String,
        payload: Value,
    },
}

/// Methods whose whole call is Argon2id. Handled on the daemon `upriv-argon2`
/// worker so light RPCs (`app_settings_*`, groups, list, …) are not blocked on
/// stdin.
///
/// Still one Argon2 at a time: single worker + `upriv_core::session::with_unlock_lock`.
/// A long `.7z` pack or import takes that lock only for the Argon2 moment.
/// The rest of the job runs on `upriv-pack`, not on this worker and not on
/// the close worker.
pub fn is_argon2_bound_method(method: &str, _params: &Value) -> bool {
    matches!(method, "vault_open" | "vault_create" | "vault_ingest_open")
}

/// A `vault_open` whose vault the core of an app that went away still holds.
/// It waits on a thread of its own ([`upriv_rpc::vault_open_wait`]), with no
/// time limit, and joins the `upriv-argon2` worker after, so opens and
/// creates of other vaults do not queue behind that wait.
pub fn waits_before_lane(method: &str, params: &Value) -> bool {
    method == "vault_open" && upriv_rpc::vault_open_must_wait(params)
}

/// Close, delete, and plaintext-folder work that waits for a sync pass. Own
/// worker so a lock is not stuck behind a multi-minute import, export, or
/// rewrap, and stdin is not stuck behind a pass.
pub fn is_lifecycle_io_method(method: &str) -> bool {
    matches!(
        method,
        "vault_close"
            | "vault_delete"
            | "vault_discard_import"
            | "vault_plain_confirm"
            | "vault_plain_sync"
            | "vault_plain_deletions"
            | "vault_plain_send"
            | "vault_plain_unsend"
    )
}

/// Password and unlock-RAM change, and the rebuild of a lost index. Own
/// worker: the safety zip of `store/` must not sit ahead of another vault's
/// close. Argon2 inside the call still takes `with_unlock_lock` only for the
/// derive.
pub fn is_rewrap_io_method(method: &str) -> bool {
    matches!(
        method,
        "vault_change_password" | "vault_change_kdf" | "vault_rebuild"
    )
}

/// Zip and `.7z` import, portable export, the wipes of what a crashed plain-text
/// export or session left, a save of the closed `store/`, and a backup export.
/// File imports use [`is_import_io_method`] so they can run beside each other.
pub fn is_pack_io_method(method: &str) -> bool {
    matches!(
        method,
        "vault_import_zip"
            | "vault_import_7z"
            | "vault_import_files_zip"
            | "vault_import_os_path"
            | "vault_export"
            | "vault_unfinished_sweep"
            | "vault_plain_remove"
            | "backup_save"
            | "backup_export"
    )
}

/// The small calls that reach a chosen backup folder: listing, deleting, and
/// pinning backups, and checking a folder. That folder can be a sleeping or
/// dead drive, so they stay off stdin, where a stop and Close now arrive. The
/// backups themselves run on the close and pack lanes.
pub fn is_backup_folder_method(method: &str) -> bool {
    matches!(
        method,
        "backup_list"
            | "backup_delete"
            | "backup_promote"
            | "backup_folder_check"
            | "backup_folder_reuse"
    )
}

/// One vault file copied in from the operating system, and the password test
/// of a `.7z` before an import. Several slots, so neither waits behind a long
/// export, and a stop for either still reaches stdin.
pub fn is_import_io_method(method: &str) -> bool {
    matches!(method, "vault_fs_import_os_file" | "vault_import_probe")
}

/// The zip of the whole data folder, and the copy of a phone's private data
/// folder into the one it granted. Own worker: an import, export, or backup it
/// refuses answers at once instead of queuing behind a copy of every vault.
pub fn is_data_folder_io_method(method: &str, params: &Value) -> bool {
    method == "data_folder_export"
        || (method == "vault_root_setup_path"
            && params.get("adoptPrivateRoot").and_then(Value::as_bool) == Some(true))
}

/// Which off-stdin worker runs this method.
///
/// Android `CoreLanes` in `UprivCoreModule.kt` uses these same method names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeavyLane {
    Argon2,
    Lifecycle,
    Rewrap,
    Pack,
    Import,
    DataFolder,
    BackupFolder,
}

pub fn heavy_lane(method: &str, params: &Value) -> Option<HeavyLane> {
    if is_argon2_bound_method(method, params) {
        return Some(HeavyLane::Argon2);
    }
    // A normal quit closes every vault, and closing may take long. On the
    // close lane, after any close already running, stdin stays free for
    // `job_status`, `job_cancel`, and a Close now that hurries the quit.
    if method == SHUTDOWN_METHOD {
        return Some(HeavyLane::Lifecycle);
    }
    if is_lifecycle_io_method(method) {
        return Some(HeavyLane::Lifecycle);
    }
    if is_rewrap_io_method(method) {
        return Some(HeavyLane::Rewrap);
    }
    if is_import_io_method(method) {
        return Some(HeavyLane::Import);
    }
    if is_pack_io_method(method) {
        return Some(HeavyLane::Pack);
    }
    if is_data_folder_io_method(method, params) {
        return Some(HeavyLane::DataFolder);
    }
    if is_backup_folder_method(method) {
        return Some(HeavyLane::BackupFolder);
    }
    None
}

/// Off-stdin work: Argon2, a ciphertext export zip, a long OS-path import, vault close, or vault delete.
pub fn is_heavy_method(method: &str, params: &Value) -> bool {
    heavy_lane(method, params).is_some()
}

/// Quit: Electron sends it once (with `now` for the quit dialog's Close now),
/// and again with `now` when the person chooses Close now while a normal quit runs.
pub const SHUTDOWN_METHOD: &str = "app_shutdown";

pub fn handle_request(id: u64, method: String, params: Value) -> WireOut {
    let response = handle_rpc(RpcRequest { method, params });
    WireOut::Response {
        id,
        ok: response.ok,
        result: response.result,
        error: response.error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_worker_is_only_short_unlocks() {
        let empty = Value::Null;
        // Only an open that names a vault can wait before the lane.
        assert!(!waits_before_lane("vault_open", &empty));
        assert!(!waits_before_lane("vault_create", &empty));
        assert!(is_argon2_bound_method("vault_open", &empty));
        assert!(is_argon2_bound_method("vault_ingest_open", &empty));
        assert!(is_lifecycle_io_method("vault_discard_import"));
        assert!(!is_argon2_bound_method("vault_ingest_directory", &empty));
        assert!(!is_heavy_method("vault_ingest_directory", &empty));
        assert!(is_argon2_bound_method("vault_create", &empty));
        assert!(!is_argon2_bound_method("vault_export", &empty));
        assert!(!is_argon2_bound_method("vault_import_7z", &empty));
        assert!(!is_argon2_bound_method("vault_import_zip", &empty));
        assert!(!is_argon2_bound_method("vault_close", &empty));
        assert!(!is_argon2_bound_method("app_settings_save", &empty));
        assert!(!is_argon2_bound_method("vault_list", &empty));
        assert!(!is_heavy_method("vault_disk_usage", &empty));
        assert!(!is_heavy_method("vault_close_phase", &empty));
        assert!(!is_argon2_bound_method("app_shutdown", &empty));
        assert_eq!(
            heavy_lane("app_shutdown", &empty),
            Some(HeavyLane::Lifecycle)
        );
        assert!(!is_argon2_bound_method("vault_fs_import_os_file", &empty));
        assert!(is_import_io_method("vault_fs_import_os_file"));
        assert!(!is_pack_io_method("vault_fs_import_os_file"));
        assert!(is_heavy_method("vault_fs_import_os_file", &empty));
        assert!(is_heavy_method("vault_import_zip", &empty));
        assert!(is_heavy_method("vault_import_7z", &empty));
        assert!(is_lifecycle_io_method("vault_close"));
        assert!(!is_lifecycle_io_method("vault_change_password"));
        assert!(!is_lifecycle_io_method("vault_change_kdf"));
        assert!(is_rewrap_io_method("vault_change_password"));
        assert!(is_rewrap_io_method("vault_change_kdf"));
        assert!(is_rewrap_io_method("vault_rebuild"));
        assert!(!is_argon2_bound_method("vault_change_password", &empty));
        assert!(!is_argon2_bound_method("vault_change_kdf", &empty));
        assert!(!is_argon2_bound_method("vault_rebuild", &empty));
        assert_eq!(heavy_lane("vault_rebuild", &empty), Some(HeavyLane::Rewrap));
        assert_eq!(
            heavy_lane("vault_change_password", &empty),
            Some(HeavyLane::Rewrap)
        );
        assert_eq!(
            heavy_lane("vault_change_kdf", &empty),
            Some(HeavyLane::Rewrap)
        );
        assert_ne!(
            heavy_lane("vault_close", &empty),
            heavy_lane("vault_change_password", &empty)
        );
        assert!(is_lifecycle_io_method("vault_delete"));
        assert_eq!(
            heavy_lane("vault_close", &empty),
            Some(HeavyLane::Lifecycle)
        );
        assert_eq!(heavy_lane("vault_import_7z", &empty), Some(HeavyLane::Pack));
        assert_eq!(
            heavy_lane("vault_fs_import_os_file", &empty),
            Some(HeavyLane::Import)
        );
        assert_eq!(
            heavy_lane("vault_import_files_zip", &empty),
            Some(HeavyLane::Pack)
        );
        assert_eq!(
            heavy_lane("vault_import_os_path", &empty),
            Some(HeavyLane::Pack)
        );
        assert_eq!(
            heavy_lane("vault_import_zip", &empty),
            Some(HeavyLane::Pack)
        );
        assert_eq!(heavy_lane("backup_save", &empty), Some(HeavyLane::Pack));
        assert_eq!(heavy_lane("backup_export", &empty), Some(HeavyLane::Pack));
        for method in [
            "backup_list",
            "backup_delete",
            "backup_promote",
            "backup_folder_check",
            "backup_folder_reuse",
        ] {
            assert_eq!(
                heavy_lane(method, &empty),
                Some(HeavyLane::BackupFolder),
                "{method}"
            );
        }
        assert_eq!(
            heavy_lane("data_folder_export", &empty),
            Some(HeavyLane::DataFolder)
        );
        // A `.7z` password test and the copy of a phone's data folder are
        // jobs: off stdin, so their stop gets through.
        assert_eq!(
            heavy_lane("vault_import_probe", &empty),
            Some(HeavyLane::Import)
        );
        let adopting = serde_json::json!({ "path": "/upriv-saf-root", "adoptPrivateRoot": true });
        assert_eq!(
            heavy_lane("vault_root_setup_path", &adopting),
            Some(HeavyLane::DataFolder)
        );
        assert_eq!(heavy_lane("vault_root_setup_path", &empty), None);
        // Progress and stop answer at once, beside the job they name.
        assert_eq!(heavy_lane("job_status", &empty), None);
        assert_eq!(heavy_lane("job_cancel", &empty), None);
        assert_ne!(
            heavy_lane("vault_close", &empty),
            heavy_lane("vault_import_7z", &empty)
        );
        assert!(is_heavy_method("vault_import_7z", &empty));
        assert!(is_heavy_method("vault_fs_import_os_file", &empty));
        assert!(is_heavy_method("vault_close", &empty));
        assert!(is_heavy_method("vault_delete", &empty));
        assert!(!is_heavy_method("vault_fs_write_range", &empty));
        assert!(!is_heavy_method("app_settings_save", &empty));
    }

    #[test]
    fn export_does_not_share_the_argon2_worker() {
        let store_zip = serde_json::json!({ "format": "store_zip" });
        let missing = serde_json::json!({});
        let seven_zip = serde_json::json!({ "format": "seven_zip" });
        for params in [&store_zip, &missing, &seven_zip] {
            assert!(!is_argon2_bound_method("vault_export", params));
            assert!(is_heavy_method("vault_export", params));
            assert_eq!(heavy_lane("vault_export", params), Some(HeavyLane::Pack));
        }
    }

    #[test]
    fn android_core_lanes_list_the_same_methods() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../apps/mobile/modules/upriv-core/android/src/main/java/expo/modules/uprivcore/UprivCoreModule.kt",
        );
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        let body = text
            .split_once("fun dispatcher")
            .expect("CoreLanes dispatcher")
            .1
            .split_once("else ->")
            .expect("dispatcher else")
            .0;
        let mut found = std::collections::BTreeSet::new();
        let mut parts = body.split('"');
        let _ = parts.next();
        while let Some(method) = parts.next() {
            if !method.is_empty() {
                found.insert(method.to_string());
            }
            let _ = parts.next();
        }
        let expected = [
            "backup_delete",
            "backup_export",
            "backup_folder_check",
            "backup_folder_reuse",
            "backup_list",
            "backup_promote",
            "backup_save",
            "data_folder_export",
            "vault_change_kdf",
            "vault_change_password",
            "vault_close",
            "vault_create",
            "vault_delete",
            "vault_discard_import",
            "vault_export",
            "vault_fs_import_os_file",
            "vault_import_7z",
            "vault_import_files_zip",
            "vault_import_os_path",
            "vault_import_probe",
            "vault_import_zip",
            "vault_ingest_open",
            "vault_open",
            "vault_plain_confirm",
            "vault_plain_deletions",
            "vault_plain_remove",
            "vault_plain_send",
            "vault_plain_sync",
            "vault_plain_unsend",
            "vault_rebuild",
            "vault_unfinished_sweep",
        ];
        let expected: std::collections::BTreeSet<_> = expected
            .iter()
            .map(|method| (*method).to_string())
            .collect();
        assert_eq!(found, expected);
        for method in &expected {
            assert!(is_heavy_method(method, &Value::Null), "{method}");
        }
    }
}
