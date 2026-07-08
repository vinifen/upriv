//! Structured app logs under `.upriv/logs/`.
//!
//! Line format matches `prod-example/README.md` § Logs and `@upriv/shared`
//! `domain/logs/format.ts`. **Write from Rust only** — React reads via `LogService`.

mod config;
mod format;
mod level;
mod writer;

pub use config::LogConfig;
pub use format::format_log_line;
pub use level::LogLevel;
pub use writer::Logger;
