use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::config::{ArchiveMode, SevenZipSection, VaultConfig};
use crate::error::{Result, UprivError};
use crate::paths::VaultRoot;
use crate::config::AppSettings;

/// Resolved path to `7zz` / `7z` and archive options from vault config.
#[derive(Debug, Clone)]
pub struct SevenZip {
    binary: PathBuf,
    options: SevenZipSection,
}

impl SevenZip {
    pub fn resolve(root: &VaultRoot, settings: &AppSettings) -> Result<Self> {
        let binary = resolve_binary(&root.resolve_7zz_candidates(settings))?;
        Ok(Self {
            binary,
            options: SevenZipSection::default(),
        })
    }

    pub fn with_vault_options(mut self, config: &VaultConfig) -> Self {
        self.options = config.seven_zip.clone();
        self
    }

    pub fn from_binary(binary: impl Into<PathBuf>) -> Self {
        Self {
            binary: binary.into(),
            options: SevenZipSection::default(),
        }
    }

    pub fn binary(&self) -> &Path {
        &self.binary
    }

    pub fn test(&self, archive: &Path, password: &str) -> Result<()> {
        self.run(
            &[OsStr::new("t"), archive.as_os_str()],
            password,
            None,
        )
    }

    /// Extract archive contents into `output_dir` (created if missing).
    pub fn extract(&self, archive: &Path, output_dir: &Path, password: &str) -> Result<()> {
        std::fs::create_dir_all(output_dir)?;
        let output_flag = format!("-o{}", output_dir.display());
        self.run(
            &[
                OsStr::new("x"),
                archive.as_os_str(),
                OsStr::new(&output_flag),
                OsStr::new("-y"),
            ],
            password,
            None,
        )
    }

    /// Create a new archive from all files under `source_dir`.
    pub fn create_from_dir(
        &self,
        source_dir: &Path,
        output_archive: &Path,
        password: &str,
    ) -> Result<()> {
        if let Some(parent) = output_archive.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if output_archive.exists() {
            std::fs::remove_file(output_archive)?;
        }

        let mut args: Vec<OsString> = vec![
            OsStr::new("a").into(),
            OsStr::new("-t7z").into(),
            output_archive.as_os_str().into(),
        ];
        args.push(format!("-mhe={}", if self.options.encrypt_file_names {
            "on"
        } else {
            "off"
        })
        .into());

        match self.options.archive_mode {
            ArchiveMode::EncryptOnly => {
                args.push(OsStr::new("-mx=0").into());
                args.push(OsStr::new("-m0=Copy").into());
            }
            ArchiveMode::CompressEncrypt => {
                args.push(format!("-mx={}", self.options.compression_level).into());
                args.push(format!("-m0={}", self.options.method).into());
            }
        }

        if !self.options.solid {
            args.push(OsStr::new("-ms=off").into());
        }

        args.push(OsStr::new("-y").into());

        let pattern = source_dir.join("*");
        args.push(pattern.as_os_str().into());

        self.run(&args.iter().map(|s| s.as_os_str()).collect::<Vec<_>>(), password, None)
    }

    fn run(&self, args: &[&OsStr], password: &str, cwd: Option<&Path>) -> Result<()> {
        let mut command = Command::new(&self.binary);
        command.args(args);
        command.arg(format!("-p{password}"));
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        let output = command.output().map_err(|source| UprivError::SevenZipCommand {
            command: format!("{} {:?}", self.binary.display(), args.iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ")),
            source,
        })?;

        if !output.status.success() {
            return Err(UprivError::SevenZipFailed {
                status: output.status.code().unwrap_or(-1),
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            });
        }
        Ok(())
    }
}

fn resolve_binary(candidates: &[PathBuf]) -> Result<PathBuf> {
    for candidate in candidates {
        if candidate.is_file() {
            if is_executable_archive_tool(candidate) {
                return Ok(candidate.clone());
            }
            continue;
        }
        if let Some(found) = find_on_path(candidate) {
            if is_executable_archive_tool(&found) {
                return Ok(found);
            }
        }
    }
    Err(UprivError::SevenZipNotFound)
}

fn find_on_path(name: &Path) -> Option<PathBuf> {
    let file_name = name.file_name()?;
    let paths = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&paths) {
        let candidate = dir.join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn is_executable_archive_tool(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let output = Command::new(path)
        .arg("--help")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if let Ok(status) = output {
        return status.success() || status.code() == Some(0) || status.code() == Some(7);
    }
    // Some 7z builds exit non-zero on --help; try a lightweight probe.
    Command::new(path)
        .arg("i")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_system_7z_when_available() {
        let candidates = vec![PathBuf::from("7z")];
        if let Ok(path) = resolve_binary(&candidates) {
            assert!(path.is_file());
        }
    }
}
