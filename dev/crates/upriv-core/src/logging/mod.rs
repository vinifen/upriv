//! Structured app logs under `.upriv/logs/`.
//!
//! Emission: [`log_event`] / [`Logger`] → on-disk Upriv format.
//! UI reads via RPC (`log_list` / `log_get` / `log_delete`) → [`store`] / [`session`].
//!
//! Line format matches `prod-example/README.md` § Logs and `@upriv/shared`
//! `domain/logs/format.ts`.

mod config;
mod format;
mod level;
mod names;
mod session;
mod store;
mod writer;

pub use config::LogConfig;
pub use format::format_log_line;
pub use level::LogLevel;
pub use session::{
    clear_logging_session, delete_session_log_files, ensure_logging_session, flush_logging_session,
    install_logging_at, list_session_log_files, log_app_start, log_event, log_vault_root_entered,
    log_vault_root_leaving, log_vault_root_leaving_on, log_vault_root_ready, read_session_log_file,
    reset_vault_root_ready, session_logger, session_logs_dir,
};
pub use store::{delete_log_files, list_log_files, read_log_file, LogFileInfo};
pub use writer::Logger;
