import type { WorkspacePathIssue } from "./types";
import { WORKSPACE_SYSTEMS, type WorkspaceTable } from "./os";
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

/** Android Storage Access Framework address. Rust `File::open` cannot read it. */
export function isContentUri(path: string): boolean {
  return path.trim().toLowerCase().startsWith("content://");
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

/** Normalize one workspace path: trim; empty stays unset. */
export function normalizeWorkspaceGlobalPath(value: unknown): string {
  return trimPath(value);
}

/**
 * Whether `candidate` contains a `.upriv` path segment (case-insensitive),
 * independent of vault-root — parity with Rust `path_is_under_reserved_upriv_tree`.
 * The entire `.upriv/` tree is reserved. A storage-access address is checked
 * after percent-decoding, so `…%2F.upriv` is the same reserved tree.
 */
export function pathIsUnderReservedUprivTree(candidate: string): boolean {
  const path = trimPath(candidate);
  if (!path) return false;
  const saf = path.toLowerCase().startsWith("content://");
  const decoded = saf ? decodeContentUri(path) : path;
  const parts = decoded.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.some((part) => segmentIsReservedUpriv(part, saf));
}

function segmentIsReservedUpriv(segment: string, saf: boolean): boolean {
  if (segment.toLowerCase() === ".upriv") return true;
  if (!saf) return false;
  const tail = segment.split(":").pop() ?? segment;
  return tail.toLowerCase() === ".upriv";
}

/** At most two passes. Storage-access ids are encoded once; a pasted id may be twice. */
function decodeContentUri(uri: string): string {
  let current = uri;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
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

/** Validate every path in a workspace table. Empty is unset. */
export function validateWorkspaceTable(
  table: WorkspaceTable,
  vaultRootPath?: string | null,
): WorkspacePathIssue | null {
  for (const system of WORKSPACE_SYSTEMS) {
    const issue = validateWorkspaceGlobalPath(table[system].path, vaultRootPath);
    if (issue) return issue;
  }
  return null;
}

/**
 * Full mount point when `parent` is set.
 * The app folder uses `{parent}/workspace/{displayName}`.
 * A vault's own folder uses `{parent}/{displayName}` at that folder's root.
 * A `content://` tree becomes the document URI of that child.
 * Does not create directories. Leaf sanitization matches Rust.
 */
export function resolveVaultMountPoint(
  parent: string | null | undefined,
  displayName: string,
  ownFolder = false,
): string | null {
  const base = normalizeWorkspaceGlobalPath(parent).replace(/[/\\]+$/, "");
  if (!base) return null;
  const leaf = sanitizeMountLeaf(displayName);
  if (base.toLowerCase().startsWith("content://")) {
    const tree = parseSafTree(base);
    if (!tree) return null;
    const documentId = ownFolder
      ? `${tree.treeId}/${leaf}`
      : `${safWorkspaceDocumentId(tree.treeId)}/${leaf}`;
    return safDocumentUri(tree, documentId);
  }
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return ownFolder ? `${base}${sep}${leaf}` : `${base}${sep}workspace${sep}${leaf}`;
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
 * Child of the granted tree where `workspace` sits beside `.upriv`.
 * A Documents grant is the parent; the data folder is the `Upriv` directory
 * inside it.
 */
function safWorkspaceDocumentId(treeId: string): string {
  if (treeId === "primary:Documents" || treeId === "home:Documents") {
    return `${treeId}/Upriv/workspace`;
  }
  return `${treeId}/workspace`;
}

interface SafTree {
  base: string;
  treeId: string;
}

/** `content://…/tree/<id>` without a fake child path stuck on the end. */
function parseSafTree(treeUri: string): SafTree | null {
  const lower = treeUri.toLowerCase();
  const marker = "/tree/";
  const idx = lower.indexOf(marker);
  if (idx < 0) return null;
  let after = treeUri.slice(idx + marker.length);
  const query = after.search(/[?#]/);
  if (query >= 0) after = after.slice(0, query);
  const documentAt = after.toLowerCase().indexOf("/document/");
  const treeEncoded = (documentAt >= 0 ? after.slice(0, documentAt) : after).replace(/\/+$/, "");
  if (!treeEncoded) return null;
  let treeId: string;
  try {
    treeId = decodeURIComponent(treeEncoded);
  } catch {
    return null;
  }
  if (!treeId || treeId === "." || treeId === "..") return null;
  return { base: treeUri.slice(0, idx).replace(/[?#].*$/, ""), treeId };
}

function safDocumentUri(tree: SafTree, documentId: string): string {
  return `${tree.base}/tree/${encodeURIComponent(tree.treeId)}/document/${encodeURIComponent(documentId)}`;
}

/**
 * Document URI of the `workspace` child under a storage-access tree.
 * `…/tree/<id>/workspace` is not a child; the child is
 * `…/tree/<id>/document/<id>%2Fworkspace`.
 */
function suggestedSafWorkspaceUri(treeUri: string): string {
  const tree = parseSafTree(treeUri);
  if (!tree) return "";
  return safDocumentUri(tree, safWorkspaceDocumentId(tree.treeId));
}

/**
 * Folder that holds every app-folder file manager folder: `{parent}/workspace`.
 * A storage-access address is returned unchanged; it is not a filesystem path.
 */
export function workspaceContainerPath(parent: string | null | undefined): string {
  const base = trimPath(parent).replace(/[/\\]+$/, "");
  if (!base || base.toLowerCase().startsWith("content://")) return base;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}workspace`;
}

/**
 * Suggested default for app `[workspace].path`: `<vaultRoot>/workspace`.
 * A storage-access tree uses the document URI of that child. Empty vault-root → `""`.
 */
export function suggestedDefaultWorkspacePath(vaultRootPath: string | null | undefined): string {
  const root = trimPath(vaultRootPath).replace(/[/\\]+$/, "");
  if (!root) return "";
  if (root.toLowerCase().startsWith("content://")) return suggestedSafWorkspaceUri(root);
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${sep}workspace`;
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
