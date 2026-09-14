//! Config edit gates for `vault_config_save` (parity with `@upriv/shared` edit-policy).
//!
//! Contract: `apps/shared/src/domain/edit-policy/edit-policy.json`
//! (`rustConfigSaveQuietTargets`).
//!
//! Process-side backstop for **open session**, **mid-close**, and **Argon2 in flight**
//! (`UNLOCK_GATE` — same idea as `vault_activity_blocks_root_switch`).
//! Pipeline statuses like `opening` / `creating` are UI-only — core does not see them.
//! Prefer `CONFIG_SAVE_QUIET_TARGETS` + `quiet_targets_changed` staying in lockstep
//! (parity test below).

use std::path::Path;

use crate::config::VaultConfig;
use crate::error::{Result, UprivError};
use crate::session::{is_unlock_in_flight, is_vault_closing_at, is_vault_open_at};

/// Targets refused while the vault session is open, mid-close, or Argon2 is in flight.
/// Keep in sync with `edit-policy.json` → `rustConfigSaveQuietTargets`.
pub const CONFIG_SAVE_QUIET_TARGETS: &[&str] = &[
    "vault.display_name",
    "mount.workspace_path",
    "storage.mode",
    "security.mode",
    "vault.id",
];

/// Which quiet targets differ between two configs.
///
/// Field checks are explicit (typed `VaultConfig`); the parity test ensures every
/// `CONFIG_SAVE_QUIET_TARGETS` entry is reachable here.
pub fn quiet_targets_changed(before: &VaultConfig, after: &VaultConfig) -> Vec<&'static str> {
    let mut out = Vec::new();
    if before.vault.display_name != after.vault.display_name {
        out.push("vault.display_name");
    }
    if before.vault.id != after.vault.id {
        out.push("vault.id");
    }
    if before.mount.workspace_path != after.mount.workspace_path {
        out.push("mount.workspace_path");
    }
    if before.storage.mode != after.storage.mode {
        out.push("storage.mode");
    }
    if before.security.mode.normalized() != after.security.mode.normalized() {
        out.push("security.mode");
    }
    out
}

fn session_blocks_quiet(vault_dir: &Path) -> bool {
    is_vault_open_at(vault_dir) || is_vault_closing_at(vault_dir) || is_unlock_in_flight()
}

/// Refuse a config save when quiet-gated fields change while busy.
pub fn refuse_config_save_if_busy(
    vault_dir: &Path,
    before: &VaultConfig,
    after: &VaultConfig,
) -> Result<()> {
    if !session_blocks_quiet(vault_dir) {
        return Ok(());
    }
    let changed = quiet_targets_changed(before, after);
    if let Some(target) = changed.first() {
        return Err(UprivError::VaultConfigBusy {
            target: (*target).into(),
        });
    }
    Ok(())
}

/// Load current config, enforce edit policy, then write `after`.
pub fn save_vault_config_checked(vault_dir: impl AsRef<Path>, after: &VaultConfig) -> Result<()> {
    let vault_dir = vault_dir.as_ref();
    let before = crate::config::load_vault_config_raw(vault_dir)?;
    // Id change is never a live `vault_config_save` — always migration error first,
    // even when the session is busy (do not mask as `vault_config_busy`).
    if after.vault.id != before.vault.id {
        return Err(UprivError::VaultConfigInvalid {
            path: crate::config::vault_config_path(vault_dir),
            detail: "changing [vault].id requires a migration flow; close vault and rename folder"
                .into(),
        });
    }
    refuse_config_save_if_busy(vault_dir, &before, after)?;
    crate::config::save_vault_config(vault_dir, after)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contents::KdfUnlockPreset;
    use crate::session::with_unlock_lock;
    use crate::test_support::vault_root_with;
    use crate::vault::{close_vault, create_vault, open_vault};
    use std::sync::mpsc;
    use std::time::Duration;

    fn sample_config(id: &str, name: &str) -> VaultConfig {
        toml::from_str(&format!(
            r#"
[vault]
id = "{id}"
display_name = "{name}"
order = 1
[storage]
mode = "encrypted_dir"
"#
        ))
        .expect("config")
    }

    #[test]
    fn quiet_targets_list_matches_shared_contract() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../apps/shared/src/domain/edit-policy/edit-policy.json"
        ))
        .expect("edit-policy.json");
        let expected = contract["rustConfigSaveQuietTargets"]
            .as_array()
            .expect("array")
            .iter()
            .map(|v| v.as_str().expect("str"))
            .collect::<Vec<_>>();
        assert_eq!(CONFIG_SAVE_QUIET_TARGETS, expected.as_slice());
    }

    #[test]
    fn quiet_targets_changed_covers_every_listed_target() {
        let before = sample_config("notes", "Notes");
        let mut after = before.clone();
        after.vault.display_name = "Renamed".into();
        after.vault.id = "other".into();
        after.mount.workspace_path = "/tmp/custom".into();
        after.storage.mode = crate::config::VaultStorageMode::UprivPlain;
        after.security.mode = crate::config::VaultSecurityMode::AlwaysPrompt;
        let mut changed = quiet_targets_changed(&before, &after);
        changed.sort_unstable();
        let mut expected = CONFIG_SAVE_QUIET_TARGETS.to_vec();
        expected.sort_unstable();
        assert_eq!(changed, expected);
    }

    #[test]
    fn open_session_blocks_display_name_save() {
        let (_tmp, root) = vault_root_with(&[]);
        let cfg = sample_config("notes", "Notes");
        create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).expect("create");
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        let dir = root.vault_dir("notes").unwrap();
        let mut after = crate::config::load_vault_config_raw(&dir).unwrap();
        after.vault.display_name = "Renamed".into();
        let err = save_vault_config_checked(&dir, &after).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigBusy { .. }));
        close_vault(&root, "notes", None).expect("close");
        assert!(
            !crate::session::is_vault_open_at(&dir),
            "open session must clear after close"
        );
        assert!(
            !crate::session::is_vault_closing_at(&dir),
            "closing mark must clear after close"
        );
        // Process-wide UNLOCK_GATE may be held by parallel Argon2 (other tests) —
        // only assert the checked save when that gate is free.
        if !crate::session::is_unlock_in_flight() {
            save_vault_config_checked(&dir, &after).expect("save when closed");
        }
    }

    #[test]
    fn open_session_allows_note_save() {
        let (_tmp, root) = vault_root_with(&[]);
        let cfg = sample_config("notes", "Notes");
        create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).expect("create");
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        let dir = root.vault_dir("notes").unwrap();
        let mut after = crate::config::load_vault_config_raw(&dir).unwrap();
        after.vault.note = "ok while open".into();
        save_vault_config_checked(&dir, &after).expect("note anytime");
        close_vault(&root, "notes", None).expect("close");
    }

    #[test]
    fn closing_mark_blocks_quiet_target() {
        let dir = std::path::PathBuf::from(format!(
            "/upriv-test-edit-policy-closing-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _guard = crate::session::ClosingGuard::enter(&dir).unwrap();
        let before = sample_config("x", "X");
        let mut after = before.clone();
        after.storage.mode = crate::config::VaultStorageMode::UprivPlain;
        let err = refuse_config_save_if_busy(&dir, &before, &after).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigBusy { .. }));
    }

    #[test]
    fn id_change_is_migration_error_even_when_open() {
        let (_tmp, root) = vault_root_with(&[]);
        let cfg = sample_config("notes", "Notes");
        create_vault(&root, cfg, b"pass-word-ok", KdfUnlockPreset::M32).expect("create");
        open_vault(&root, "notes", b"pass-word-ok").expect("open");
        let dir = root.vault_dir("notes").unwrap();
        let mut after = crate::config::load_vault_config_raw(&dir).unwrap();
        after.vault.id = "other".into();
        let err = save_vault_config_checked(&dir, &after).unwrap_err();
        assert!(
            matches!(err, UprivError::VaultConfigInvalid { .. }),
            "id change must not surface as vault_config_busy: {err:?}"
        );
        close_vault(&root, "notes", None).expect("close");
    }

    #[test]
    fn unlock_gate_blocks_quiet_target() {
        let dir = std::path::PathBuf::from(format!(
            "/upriv-test-edit-policy-unlock-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let (held_tx, held_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let join = std::thread::spawn(move || {
            let _ = with_unlock_lock(|| {
                held_tx.send(()).expect("signal held");
                let _ = release_rx.recv_timeout(Duration::from_secs(5));
                Ok(())
            });
        });
        held_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("unlock gate held");
        let before = sample_config("x", "X");
        let mut after = before.clone();
        after.vault.display_name = "Renamed".into();
        let err = refuse_config_save_if_busy(&dir, &before, &after).unwrap_err();
        assert!(matches!(err, UprivError::VaultConfigBusy { .. }));
        let _ = release_tx.send(());
        join.join().expect("unlock thread");
    }
}
