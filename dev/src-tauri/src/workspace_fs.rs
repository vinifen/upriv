//! Workspace file-system commands for the in-app file manager.
//!
//! Operations target a vault's open `workspace/<display_name>/` directory. In dev
//! (no FUSE) this is a plaintext export; in production it is the FUSE mount. Either
//! way, writing through to this directory is what `encrypted_dir` close persists.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use upriv_core::{load_app_settings, load_vault_config, VaultRoot};

use crate::commands::map_error_public;

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryDto {
    pub path: String,
    pub is_dir: bool,
    /// "text" | "image" | "binary" | "dir"
    pub kind: String,
    pub content: String,
}

fn workspace_dir(vault_root: &str, vault_id: &str) -> Result<PathBuf, String> {
    let root = VaultRoot::discover(vault_root).map_err(map_error_public)?;
    let settings = load_app_settings(&root).map_err(map_error_public)?;
    let config = load_vault_config(&root, vault_id).map_err(map_error_public)?;
    Ok(root.workspace_dir(&settings, &config.vault.display_name))
}

/// Resolve a workspace-relative path safely (rejects traversal / absolute paths).
fn resolve_in_workspace(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim_start_matches('/').replace('\\', "/");
    let candidate = Path::new(&rel);
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return Err("error.workspace_not_found".to_string()),
        }
    }
    Ok(base.join(candidate))
}

fn ext_lower(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

fn read_entry(base: &Path, abs: &Path) -> Option<WorkspaceEntryDto> {
    let rel = abs.strip_prefix(base).ok()?.to_string_lossy().replace('\\', "/");
    if rel.is_empty() {
        return None;
    }
    if abs.is_dir() {
        return Some(WorkspaceEntryDto {
            path: rel,
            is_dir: true,
            kind: "dir".to_string(),
            content: String::new(),
        });
    }

    let ext = ext_lower(abs);
    let metadata = std::fs::metadata(abs).ok()?;

    if IMAGE_EXTS.contains(&ext.as_str()) {
        if let Ok(bytes) = std::fs::read(abs) {
            let mime = match ext.as_str() {
                "svg" => "image/svg+xml",
                "jpg" | "jpeg" => "image/jpeg",
                "ico" => "image/x-icon",
                other => return image_or_binary(rel, other, &bytes),
            };
            let b64 = base64_encode(&bytes);
            return Some(WorkspaceEntryDto {
                path: rel,
                is_dir: false,
                kind: "image".to_string(),
                content: format!("data:{mime};base64,{b64}"),
            });
        }
    }

    if metadata.len() <= MAX_TEXT_BYTES {
        if let Ok(text) = std::fs::read_to_string(abs) {
            return Some(WorkspaceEntryDto {
                path: rel,
                is_dir: false,
                kind: "text".to_string(),
                content: text,
            });
        }
    }

    Some(WorkspaceEntryDto {
        path: rel,
        is_dir: false,
        kind: "binary".to_string(),
        content: String::new(),
    })
}

fn image_or_binary(rel: String, ext: &str, bytes: &[u8]) -> Option<WorkspaceEntryDto> {
    let mime = match ext {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => {
            return Some(WorkspaceEntryDto {
                path: rel,
                is_dir: false,
                kind: "binary".to_string(),
                content: String::new(),
            })
        }
    };
    let b64 = base64_encode(bytes);
    Some(WorkspaceEntryDto {
        path: rel,
        is_dir: false,
        kind: "image".to_string(),
        content: format!("data:{mime};base64,{b64}"),
    })
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[tauri::command]
pub fn workspace_snapshot(
    vault_root: String,
    vault_id: String,
) -> Result<Vec<WorkspaceEntryDto>, String> {
    let base = workspace_dir(&vault_root, &vault_id)?;
    if !base.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in walkdir(&base) {
        if let Some(dto) = read_entry(&base, &entry) {
            entries.push(dto);
        }
    }
    Ok(entries)
}

fn walkdir(base: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![base.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.push(path.clone());
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

#[tauri::command]
pub fn workspace_write_file(
    vault_root: String,
    vault_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let base = workspace_dir(&vault_root, &vault_id)?;
    let target = resolve_in_workspace(&base, &path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_make_dir(
    vault_root: String,
    vault_id: String,
    path: String,
) -> Result<(), String> {
    let base = workspace_dir(&vault_root, &vault_id)?;
    let target = resolve_in_workspace(&base, &path)?;
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFolderResult {
    pub cancelled: bool,
    pub folder_name: Option<String>,
    pub file_count: usize,
}

/// Pick a host folder with a native dialog and copy it into the workspace under `dest`.
///
/// Replaces the browser `webkitdirectory` picker, which is unreliable on the Linux
/// WebKitGTK webview. The copy lands on disk and the caller refreshes the in-memory
/// mirror via the normal reconcile path.
#[tauri::command]
pub async fn workspace_import_folder(
    vault_root: String,
    vault_id: String,
    dest: String,
) -> Result<ImportFolderResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(source) = rfd::FileDialog::new()
            .set_title("Import folder into vault")
            .pick_folder()
        else {
            return Ok(ImportFolderResult {
                cancelled: true,
                folder_name: None,
                file_count: 0,
            });
        };

        let base = workspace_dir(&vault_root, &vault_id)?;
        let dest_base = resolve_in_workspace(&base, &dest)?;
        std::fs::create_dir_all(&dest_base).map_err(|e| e.to_string())?;

        let raw_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "folder".to_string());
        let folder_name = unique_child_name(&dest_base, &raw_name);
        let target_root = dest_base.join(&folder_name);

        let mut file_count = 0usize;
        copy_dir_recursive(&source, &target_root, &mut file_count).map_err(|e| e.to_string())?;

        Ok(ImportFolderResult {
            cancelled: false,
            folder_name: Some(folder_name),
            file_count,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn unique_child_name(parent: &Path, base: &str) -> String {
    if !parent.join(base).exists() {
        return base.to_string();
    }
    let mut index = 2;
    loop {
        let candidate = format!("{base} {index}");
        if !parent.join(&candidate).exists() {
            return candidate;
        }
        index += 1;
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path, file_count: &mut usize) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target, file_count)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
            *file_count += 1;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_delete(vault_root: String, vault_id: String, path: String) -> Result<(), String> {
    let base = workspace_dir(&vault_root, &vault_id)?;
    let target = resolve_in_workspace(&base, &path)?;
    if target == base {
        return Err("error.workspace_not_found".to_string());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else if target.exists() {
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn workspace_rename(
    vault_root: String,
    vault_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    workspace_move_path(&vault_root, &vault_id, &from, &to)
}

#[tauri::command]
pub fn workspace_move(
    vault_root: String,
    vault_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    workspace_move_path(&vault_root, &vault_id, &from, &to)
}

fn workspace_move_path(
    vault_root: &str,
    vault_id: &str,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let base = workspace_dir(vault_root, vault_id)?;
    let src = resolve_in_workspace(&base, from)?;
    let dst = resolve_in_workspace(&base, to)?;
    if !src.exists() {
        return Ok(());
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src, &dst).map_err(|e| e.to_string())
}
