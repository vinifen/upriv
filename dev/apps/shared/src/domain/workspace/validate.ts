import { WORKSPACE_PATH_DEFAULT, type WorkspacePathIssue } from "./types";
import { isWindowsReservedName } from "../format/windowsReserved";

function trimPath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** True when `path` looks absolute (POSIX `/…`, Windows `C:\…` / `\\server\…`, or Android SAF `content://…`). */
export function isAbsoluteFilesystemPath(path: string): boolean {
  const p = path.trim();
  if (!p) return false;
  // Android SAF tree URI — same persistable shape as vault-root custom_root on mobile.
  if (p.startsWith("content://")) return true;
  if (p.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (p.startsWith("\\\\")) return true;
  return false;
}

/**
 * Absolute OS filesystem path (`std::path::Path::is_absolute`).
 * SAF `content://` is absolute for mount/workspace, but `upriv-core` cannot `std::fs::read` it.
 */
export function isAbsoluteOsFilesystemPath(path: string): boolean {
  const p = path.trim();
  if (!p || p.startsWith("content://")) return false;
  return isAbsoluteFilesystemPath(p);
}

/**
 * `DocumentFile.fromTreeUri` only opens the tree id. Concatenating `/workspace`
 * (or any extra segment other than `/document/…`) is not a child URI.
 */
export function safTreeUriHasExtraSegment(path: string): boolean {
  const p = trimPath(path);
  if (!p.toLowerCase().startsWith("content://")) return false;
  const marker = "/tree/";
  const idx = p.toLowerCase().indexOf(marker);
  if (idx < 0) return false;
  const afterTree = p.slice(idx + marker.length);
  const slash = afterTree.indexOf("/");
  if (slash < 0) return false;
  const rest = afterTree.slice(slash);
  return !/^\/document(\/|$)/i.test(rest);
}

/**
 * Normalize vault `[mount].workspace_path`: empty → `"default"`; otherwise trim.
 * Does not validate absolute-ness (use {@link validateMountWorkspacePath}).
 */
export function normalizeMountWorkspacePath(value: unknown): string {
  const trimmed = trimPath(value);
  if (!trimmed || trimmed.toLowerCase() === WORKSPACE_PATH_DEFAULT) {
    return WORKSPACE_PATH_DEFAULT;
  }
  return trimmed;
}

/** Normalize app `[workspace].path`: trim; empty stays unset. */
export function normalizeWorkspaceGlobalPath(value: unknown): string {
  return trimPath(value);
}

/**
 * Whether `candidate` contains a `.upriv` path segment (case-insensitive),
 * independent of vault-root — parity with Rust `path_is_under_reserved_upriv_tree`.
 * The entire `.upriv/` tree is reserved (not only vaults/logs/app/runtime).
 */
export function pathIsUnderReservedUprivTree(candidate: string): boolean {
  const path = trimPath(candidate);
  if (!path || path.startsWith("content://")) return false;
  const parts = path.replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
  return parts.includes(".upriv");
}

/**
 * Whether `candidate` is `<vaultRoot>/.upriv` or anything under it.
 */
export function isReservedUprivWorkspacePath(
  candidate: string,
  vaultRootPath: string | null | undefined,
): boolean {
  const root = trimPath(vaultRootPath);
  const path = trimPath(candidate);
  if (!path) return false;
  if (pathIsUnderReservedUprivTree(path)) return true;
  if (!root) return false;

  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const rootN = norm(root);
  const pathN = norm(path);
  const upriv = `${rootN}/.upriv`;
  return pathN === upriv || pathN.startsWith(`${upriv}/`);
}

/** Validate app `[workspace].path`. Empty is allowed (unset). */
export function validateWorkspaceGlobalPath(
  path: unknown,
  vaultRootPath?: string | null,
): WorkspacePathIssue | null {
  const trimmed = trimPath(path);
  if (!trimmed) return null;
  if (!isAbsoluteFilesystemPath(trimmed)) return "not_absolute";
  if (safTreeUriHasExtraSegment(trimmed)) return "saf_tree_child";
  if (isReservedUprivWorkspacePath(trimmed, vaultRootPath)) return "reserved";
  return null;
}

/**
 * Validate vault `[mount].workspace_path`.
 * `"default"` is always ok; otherwise must be absolute and not reserved.
 */
export function validateMountWorkspacePath(
  path: unknown,
  vaultRootPath?: string | null,
): WorkspacePathIssue | null {
  const normalized = normalizeMountWorkspacePath(path);
  if (normalized === WORKSPACE_PATH_DEFAULT) return null;
  if (!isAbsoluteFilesystemPath(normalized)) return "not_absolute";
  if (safTreeUriHasExtraSegment(normalized)) return "saf_tree_child";
  if (isReservedUprivWorkspacePath(normalized, vaultRootPath)) return "reserved";
  return null;
}

/**
 * Resolve the mount parent directory for a vault (no display_name leaf yet).
 * Returns `null` when global is unset and vault uses default.
 */
export function resolveMountParentPath(
  globalPath: string | null | undefined,
  mountWorkspacePath: string | null | undefined,
): string | null {
  const mount = normalizeMountWorkspacePath(mountWorkspacePath);
  if (mount !== WORKSPACE_PATH_DEFAULT) return mount;
  const global = normalizeWorkspaceGlobalPath(globalPath);
  return global || null;
}

/**
 * Full mount point: `{parent}/{displayName}` when parent is known.
 * Does not create directories. Leaf sanitization matches Rust `sanitize_path_component`.
 */
export function resolveVaultMountPoint(
  globalPath: string | null | undefined,
  mountWorkspacePath: string | null | undefined,
  displayName: string,
): string | null {
  const parent = resolveMountParentPath(globalPath, mountWorkspacePath);
  if (!parent) return null;
  const leaf = sanitizeMountLeaf(displayName);
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  const base = parent.replace(/[/\\]+$/, "");
  return `${base}${sep}${leaf}`;
}

/** Mount leaf under the parent — mirrors Rust `sanitize_path_component`. */
export function sanitizeMountLeaf(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    /[/\\<>:"|?*]/.test(trimmed) ||
    [...trimmed].some((c) => c.charCodeAt(0) < 32) ||
    isWindowsReservedName(trimmed)
  ) {
    return "_";
  }
  return trimmed;
}

/**
 * Suggested default for app `[workspace].path`: `<vaultRoot>/workspace`
 * (beside `.upriv`, same data-folder parent). Empty vault-root → `""`.
 */
export function suggestedDefaultWorkspacePath(vaultRootPath: string | null | undefined): string {
  const root = trimPath(vaultRootPath).replace(/[/\\]+$/, "");
  if (!root) return "";
  // SAF tree URIs are not filesystem parents — `/workspace` concat is not a child.
  if (root.toLowerCase().startsWith("content://")) return "";
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${sep}workspace`;
}

/**
 * True when opening a vault that inherits the global workspace and that path
 * is still unset — UI should prompt (Default = beside `.upriv` / Custom).
 * Create-vault with `"default"` is fine while unset; only open needs a path.
 */
export function needsWorkspaceSetupOnOpen(
  globalPath: string | null | undefined,
  mountWorkspacePath: string | null | undefined,
): boolean {
  if (normalizeMountWorkspacePath(mountWorkspacePath) !== WORKSPACE_PATH_DEFAULT) {
    return false;
  }
  return !normalizeWorkspaceGlobalPath(globalPath);
}

/**
 * Path of the active vault-root for reserved-workspace checks.
 * Prefer custom `upriv_root_path`; otherwise the resolved root (default anchor / found).
 */
export function vaultRootPathForWorkspaceValidation(
  vaultRootMode: "default_root" | "custom_root",
  uprivRootPath: string | null | undefined,
  resolvedRootPath: string | null | undefined,
): string | null {
  const custom = typeof uprivRootPath === "string" ? uprivRootPath.trim() : "";
  if (vaultRootMode === "custom_root" && custom) return custom;
  const resolved = typeof resolvedRootPath === "string" ? resolvedRootPath.trim() : "";
  return resolved || null;
}
