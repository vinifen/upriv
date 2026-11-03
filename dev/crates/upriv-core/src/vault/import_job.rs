//! The new vault an import fills: created, recorded as unfinished, filled
//! through an import session, and closed. A failure or a stop deletes it; a
//! crash leaves the record, and the next launch deletes it
//! ([`super::unfinished`]).

use crate::config::VaultConfig;
use crate::error::Result;
use crate::logging::{log_event, LogLevel};
use crate::paths::VaultRoot;
use crate::session::Job;
use crate::store::KdfUnlockPreset;

use super::create::create_vault;
use super::open_close::{abandon_failed_import, close_vault, open_vault_for_ingest};
use super::unfinished::{forget_import, record_import};

/// Create the vault `config` names, fill it with `fill` (given its id) while
/// `job` runs, and close it. The last step, from the end of `fill` to the
/// close, refuses a stop.
pub(super) fn fill_new_vault(
    root: &VaultRoot,
    config: VaultConfig,
    new_password: &[u8],
    preset: KdfUnlockPreset,
    job: &Job,
    fill: impl FnOnce(&str) -> Result<()>,
) -> Result<String> {
    let id = config.vault.id.trim().to_string();
    create_vault(root, config, new_password, preset)?;
    let filled = record_import(root, &id).and_then(|()| {
        job.ensure_running()?;
        open_vault_for_ingest(root, &id, new_password)?;
        fill(&id)?;
        job.final_step()
    });
    if let Err(error) = filled {
        return Err(abandon_failed_import(root, &id, error));
    }
    close_vault(root, &id)?;
    forget_import(root, &id);
    log_event(LogLevel::Info, "vault_imported", &[("id", id.as_str())]);
    Ok(id)
}
