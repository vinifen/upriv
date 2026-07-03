import {
  type FileTreeNode,
  type VaultFileContent,
  type VaultFileLanguage,
  type WorkspaceReconcileResult,
  addChild,
  fileBaseName,
  findNode,
  getParentPath,
  joinPath,
  moveNode,
  remapContentPaths,
  removeContentPaths,
  removeNode,
  renameNode,
  siblingNames,
  uniqueFolderName,
  uniqueName,
  vaultFileLanguageFromPath,
} from "@upriv/shared";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";

interface WorkspaceEntryDto {
  path: string;
  isDir: boolean;
  kind: "text" | "image" | "binary" | "dir";
  content: string;
}

interface WorkspaceSession {
  vaultRoot: string;
  tree: FileTreeNode;
  contents: Record<string, string>;
  languages: Record<string, VaultFileLanguage>;
  kinds: Record<string, WorkspaceEntryDto["kind"]>;
  revision: number;
  pending: Promise<unknown>;
}

const sessions = new Map<string, WorkspaceSession>();
/** Suppress watcher echoes for app-initiated writes (`vaultId:relativePath` → expiry ms). */
const localWriteUntil = new Map<string, number>();

const LOCAL_WRITE_SUPPRESS_MS = 800;

function emptyRoot(): FileTreeNode {
  return { name: "/", type: "folder", children: [] };
}

function toRelative(path: string): string {
  return path.replace(/^\/+/, "");
}

function toAbsolute(relPath: string): string {
  return `/${relPath.replace(/^\/+/, "")}`;
}

function languageFor(path: string, kind: WorkspaceEntryDto["kind"]): VaultFileLanguage {
  if (kind === "image") return "image";
  if (kind === "binary") return "binary";
  return vaultFileLanguageFromPath(path);
}

function insertPath(root: FileTreeNode, relPath: string, isDir: boolean): void {
  const segments = relPath.split("/").filter(Boolean);
  let current = root;
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    const existing = current.children?.find((child) => child.name === segment);
    if (existing) {
      current = existing;
      return;
    }
    const node: FileTreeNode =
      isLast && !isDir
        ? { name: segment, type: "file" }
        : { name: segment, type: "folder", children: [] };
    current.children = [...(current.children ?? []), node];
    current = node;
  });
}

function bump(session: WorkspaceSession): number {
  session.revision += 1;
  return session.revision;
}

function localWriteKey(vaultId: string, relPath: string): string {
  return `${vaultId}:${relPath}`;
}

function markLocalWorkspaceWrite(vaultId: string, relPath: string): void {
  localWriteUntil.set(
    localWriteKey(vaultId, relPath),
    Date.now() + LOCAL_WRITE_SUPPRESS_MS,
  );
}

function shouldIgnoreExternalChange(vaultId: string, relPath: string): boolean {
  const key = localWriteKey(vaultId, relPath);
  const until = localWriteUntil.get(key);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  localWriteUntil.delete(key);
  return false;
}

function enqueue(
  session: WorkspaceSession,
  vaultId: string,
  relPath: string,
  op: () => Promise<unknown>,
): void {
  session.pending = session.pending
    .then(async () => {
      await op();
      markLocalWorkspaceWrite(vaultId, relPath);
    })
    .catch((error) => {
      console.error("workspace fs write failed", error);
    });
}

function getSession(vaultId: string): WorkspaceSession | undefined {
  return sessions.get(vaultId);
}

function ensureSession(vaultId: string): WorkspaceSession {
  let session = sessions.get(vaultId);
  if (!session) {
    session = {
      vaultRoot: "",
      tree: emptyRoot(),
      contents: {},
      languages: {},
      kinds: {},
      revision: 0,
      pending: Promise.resolve(),
    };
    sessions.set(vaultId, session);
  }
  return session;
}

function applyEntriesToSession(
  session: WorkspaceSession,
  entries: WorkspaceEntryDto[],
): void {
  session.tree = emptyRoot();
  session.contents = {};
  session.languages = {};
  session.kinds = {};

  const sorted = [...entries].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const entry of sorted) {
    insertPath(session.tree, entry.path, entry.isDir);
    if (!entry.isDir) {
      const abs = toAbsolute(entry.path);
      session.kinds[abs] = entry.kind;
      session.languages[abs] = languageFor(abs, entry.kind);
      if (entry.kind === "text" || entry.kind === "image") {
        session.contents[abs] = entry.content;
      }
    }
  }
}

async function fetchWorkspaceEntries(
  vaultRoot: string,
  vaultId: string,
): Promise<WorkspaceEntryDto[]> {
  return tauriInvoke<WorkspaceEntryDto[]>(TAURI_COMMANDS.WORKSPACE_SNAPSHOT, {
    vaultRoot,
    vaultId,
  });
}

/** Load the real workspace tree from disk into the in-memory mirror (called on open). */
export async function loadWorkspaceSnapshot(vaultId: string, vaultRoot: string): Promise<void> {
  const entries = await fetchWorkspaceEntries(vaultRoot, vaultId);

  const session: WorkspaceSession = {
    vaultRoot,
    tree: emptyRoot(),
    contents: {},
    languages: {},
    kinds: {},
    revision: (sessions.get(vaultId)?.revision ?? 0) + 1,
    pending: Promise.resolve(),
  };

  applyEntriesToSession(session, entries);
  sessions.set(vaultId, session);
}

/** Whether the in-memory mirror was loaded from disk for this vault. */
export function isWorkspaceHydrated(vaultId: string): boolean {
  return Boolean(sessions.get(vaultId)?.vaultRoot);
}

/**
 * Load workspace snapshot + start disk watcher when missing (e.g. after app restart
 * while vault lock files still mark the vault as open).
 */
export async function hydrateWorkspace(vaultId: string, vaultRoot: string): Promise<number> {
  if (!isWorkspaceHydrated(vaultId)) {
    await loadWorkspaceSnapshot(vaultId, vaultRoot);
    await startWorkspaceWatch(vaultId, vaultRoot);
  }
  return getTreeRevision(vaultId);
}

/** Hydrate all vaults reported as open by `vault_list` (startup recovery). */
export async function hydrateOpenVaultWorkspaces(
  vaults: ReadonlyArray<{ id: string; session?: string | null }>,
  vaultRoot: string,
): Promise<void> {
  for (const vault of vaults) {
    if (vault.session === "open") {
      await hydrateWorkspace(vault.id, vaultRoot);
    }
  }
}

/**
 * Merge disk state into the in-memory mirror.
 * Dirty in-app drafts are preserved; conflicting paths are reported.
 */
export async function reconcileWorkspace(
  vaultId: string,
  options: { dirtyPaths?: readonly string[] } = {},
): Promise<WorkspaceReconcileResult> {
  const session = getSession(vaultId);
  if (!session?.vaultRoot) {
    return { revision: 0, conflicts: [] };
  }

  await session.pending;

  const entries = await fetchWorkspaceEntries(session.vaultRoot, vaultId);
  const dirtySet = new Set(options.dirtyPaths ?? []);
  const conflicts: string[] = [];
  const diskFilePaths = new Set<string>();

  const newTree = emptyRoot();
  const sorted = [...entries].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const entry of sorted) {
    insertPath(newTree, entry.path, entry.isDir);
    if (!entry.isDir) {
      diskFilePaths.add(toAbsolute(entry.path));
    }
  }

  const newContents = { ...session.contents };
  const newKinds = { ...session.kinds };
  const newLanguages = { ...session.languages };

  for (const entry of entries) {
    if (entry.isDir) continue;
    const abs = toAbsolute(entry.path);
    if (shouldIgnoreExternalChange(vaultId, entry.path)) continue;

    if (dirtySet.has(abs)) {
      const baseline = session.contents[abs] ?? "";
      const diskText = entry.kind === "text" ? entry.content : null;
      if (diskText !== null && diskText !== baseline) {
        conflicts.push(abs);
        continue;
      }
    }

    newKinds[abs] = entry.kind;
    newLanguages[abs] = languageFor(abs, entry.kind);
    if (entry.kind === "text" || entry.kind === "image") {
      newContents[abs] = entry.content;
    } else {
      delete newContents[abs];
    }
  }

  for (const abs of Object.keys(session.contents)) {
    if (diskFilePaths.has(abs) || dirtySet.has(abs)) continue;
    delete newContents[abs];
    delete newKinds[abs];
    delete newLanguages[abs];
  }

  for (const abs of dirtySet) {
    if (!diskFilePaths.has(abs) && abs in session.contents) {
      conflicts.push(abs);
    }
  }

  session.tree = newTree;
  session.contents = newContents;
  session.kinds = newKinds;
  session.languages = newLanguages;
  const revision = bump(session);
  return { revision, conflicts };
}

export interface ImportHostFolderResult {
  cancelled: boolean;
  folderName: string | null;
  fileCount: number;
}

/**
 * Open a native folder picker and copy the chosen host folder into the workspace
 * under `parentPath`, then refresh the in-memory mirror. Used instead of the
 * browser `webkitdirectory` input, which is unreliable on Linux WebKitGTK.
 */
export async function importHostFolder(
  vaultId: string,
  parentPath: string,
): Promise<ImportHostFolderResult> {
  const session = getSession(vaultId);
  if (!session?.vaultRoot) {
    return { cancelled: true, folderName: null, fileCount: 0 };
  }
  await session.pending;
  const dest = toRelative(parentPath);
  const result = await tauriInvoke<ImportHostFolderResult>(
    TAURI_COMMANDS.WORKSPACE_IMPORT_FOLDER,
    { vaultRoot: session.vaultRoot, vaultId, dest },
  );
  if (!result.cancelled) {
    await reconcileWorkspace(vaultId);
  }
  return result;
}

export async function startWorkspaceWatch(vaultId: string, vaultRoot: string): Promise<void> {
  await tauriInvoke(TAURI_COMMANDS.WORKSPACE_WATCH_START, { vaultRoot, vaultId });
}

export async function stopWorkspaceWatch(vaultId: string): Promise<void> {
  await tauriInvoke(TAURI_COMMANDS.WORKSPACE_WATCH_STOP, { vaultId });
}

/** Await all pending disk writes (called before close so nothing is lost). */
export async function flushWorkspace(vaultId: string): Promise<void> {
  const session = sessions.get(vaultId);
  if (!session) return;
  await session.pending;
}

export function resetWorkspaceSession(vaultId: string): void {
  sessions.delete(vaultId);
  for (const key of [...localWriteUntil.keys()]) {
    if (key.startsWith(`${vaultId}:`)) {
      localWriteUntil.delete(key);
    }
  }
}

export function getTreeRevision(vaultId: string): number {
  return getSession(vaultId)?.revision ?? 0;
}

export function getFileTree(vaultId: string): FileTreeNode {
  return getSession(vaultId)?.tree ?? emptyRoot();
}

export function getFileContent(vaultId: string, path: string): VaultFileContent | null {
  const session = getSession(vaultId);
  if (!session) return null;
  if (!(path in session.contents)) {
    if (session.kinds[path] === "binary") {
      return { content: "", language: "binary" };
    }
    return null;
  }
  return {
    content: session.contents[path] ?? "",
    language: session.languages[path] ?? vaultFileLanguageFromPath(path),
  };
}

export function isFileEditable(vaultId: string, path: string): boolean {
  const file = getFileContent(vaultId, path);
  if (!file) return false;
  return file.language !== "binary" && file.language !== "image";
}

export function isFileViewable(vaultId: string, path: string): boolean {
  const file = getFileContent(vaultId, path);
  if (!file) return false;
  return file.language !== "binary";
}

export function isFileImage(vaultId: string, path: string): boolean {
  return getFileContent(vaultId, path)?.language === "image";
}

export function setFileContent(vaultId: string, path: string, content: string): number {
  const session = ensureSession(vaultId);
  const rel = toRelative(path);
  session.contents[path] = content;
  session.languages[path] ??= vaultFileLanguageFromPath(path);
  enqueue(session, vaultId, rel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_WRITE_FILE, {
      vaultRoot: session.vaultRoot,
      vaultId,
      path: rel,
      content,
    }),
  );
  return bump(session);
}

export function createFile(vaultId: string, parentPath: string, baseName: string): string | null {
  const session = ensureSession(vaultId);
  const names = siblingNames(session.tree, parentPath);
  const name = uniqueName(names, baseName);
  session.tree = addChild(session.tree, parentPath, { name, type: "file" });
  const path = joinPath(parentPath, name);
  const rel = toRelative(path);
  session.contents[path] = "";
  session.languages[path] = vaultFileLanguageFromPath(path);
  enqueue(session, vaultId, rel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_WRITE_FILE, {
      vaultRoot: session.vaultRoot,
      vaultId,
      path: rel,
      content: "",
    }),
  );
  bump(session);
  return path;
}

export function importFile(
  vaultId: string,
  parentPath: string,
  fileName: string,
  content: string,
): string | null {
  const session = ensureSession(vaultId);
  if (findNode(session.tree, parentPath)?.type !== "folder") return null;
  const names = siblingNames(session.tree, parentPath);
  const name = uniqueName(names, fileName);
  session.tree = addChild(session.tree, parentPath, { name, type: "file" });
  const path = joinPath(parentPath, name);
  const rel = toRelative(path);
  session.contents[path] = content;
  session.languages[path] = vaultFileLanguageFromPath(name);
  enqueue(session, vaultId, rel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_WRITE_FILE, {
      vaultRoot: session.vaultRoot,
      vaultId,
      path: rel,
      content,
    }),
  );
  bump(session);
  return path;
}

export function createFolder(
  vaultId: string,
  parentPath: string,
  baseName: string,
): string | null {
  const session = ensureSession(vaultId);
  const names = siblingNames(session.tree, parentPath);
  const name = uniqueFolderName(names, baseName);
  session.tree = addChild(session.tree, parentPath, { name, type: "folder", children: [] });
  const path = joinPath(parentPath, name);
  const rel = toRelative(path);
  enqueue(session, vaultId, rel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_MAKE_DIR, {
      vaultRoot: session.vaultRoot,
      vaultId,
      path: rel,
    }),
  );
  bump(session);
  return path;
}

export function ensureFolder(
  vaultId: string,
  parentPath: string,
  folderName: string,
): string | null {
  const session = ensureSession(vaultId);
  const parent = findNode(session.tree, parentPath);
  if (parent?.type !== "folder") return null;
  const existing = parent.children?.find(
    (child) => child.type === "folder" && child.name === folderName,
  );
  if (existing) return joinPath(parentPath, folderName);
  session.tree = addChild(session.tree, parentPath, {
    name: folderName,
    type: "folder",
    children: [],
  });
  const path = joinPath(parentPath, folderName);
  const rel = toRelative(path);
  enqueue(session, vaultId, rel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_MAKE_DIR, {
      vaultRoot: session.vaultRoot,
      vaultId,
      path: rel,
    }),
  );
  bump(session);
  return path;
}

function remapLanguages(
  source: Record<string, VaultFileLanguage>,
  fromPath: string,
  toPath: string,
): Record<string, VaultFileLanguage> {
  const next: Record<string, VaultFileLanguage> = {};
  for (const [p, lang] of Object.entries(source)) {
    if (p === fromPath) next[toPath] = lang;
    else if (p.startsWith(`${fromPath}/`)) next[`${toPath}${p.slice(fromPath.length)}`] = lang;
    else next[p] = lang;
  }
  return next;
}

export function renamePath(vaultId: string, path: string, newName: string): string | null {
  if (path === "/") return null;
  const session = ensureSession(vaultId);
  const parentPath = getParentPath(path);
  const names = siblingNames(session.tree, parentPath).filter((n) => n !== fileBaseName(path));
  if (names.includes(newName)) return null;

  const newPath = joinPath(parentPath, newName);
  session.tree = renameNode(session.tree, path, newName);
  session.contents = remapContentPaths(session.contents, path, newPath);
  session.languages = remapLanguages(session.languages, path, newPath);
  session.kinds = remapContentPaths(session.kinds, path, newPath) as Record<
    string,
    WorkspaceEntryDto["kind"]
  >;
  const fromRel = toRelative(path);
  const toRel = toRelative(newPath);
  enqueue(session, vaultId, toRel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_RENAME, {
      vaultRoot: session.vaultRoot,
      vaultId,
      from: fromRel,
      to: toRel,
    }),
  );
  bump(session);
  return newPath;
}

export function deletePath(vaultId: string, path: string): boolean {
  if (path === "/") return false;
  const session = ensureSession(vaultId);
  const rel = toRelative(path);
  session.tree = removeNode(session.tree, path);
  session.contents = removeContentPaths(session.contents, path);
  session.languages = removeContentPaths(session.languages, path) as Record<
    string,
    VaultFileLanguage
  >;
  session.kinds = removeContentPaths(session.kinds, path) as Record<
    string,
    WorkspaceEntryDto["kind"]
  >;
  enqueue(session, vaultId, rel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_DELETE, {
      vaultRoot: session.vaultRoot,
      vaultId,
      path: rel,
    }),
  );
  bump(session);
  return true;
}

export function movePath(vaultId: string, fromPath: string, toFolderPath: string): string | null {
  if (fromPath === "/" || fromPath === toFolderPath) return null;
  const session = ensureSession(vaultId);
  const node = findNode(session.tree, fromPath);
  if (!node) return null;

  const newPath = joinPath(toFolderPath, node.name);
  if (findNode(session.tree, toFolderPath)?.type !== "folder") return null;
  if (getParentPath(fromPath) === toFolderPath) return fromPath;
  const targetNames = siblingNames(session.tree, toFolderPath);
  if (targetNames.includes(node.name)) return null;

  session.tree = moveNode(session.tree, fromPath, toFolderPath);
  session.contents = remapContentPaths(session.contents, fromPath, newPath);
  session.languages = remapLanguages(session.languages, fromPath, newPath);
  session.kinds = remapContentPaths(session.kinds, fromPath, newPath) as Record<
    string,
    WorkspaceEntryDto["kind"]
  >;
  const fromRel = toRelative(fromPath);
  const toRel = toRelative(newPath);
  enqueue(session, vaultId, toRel, () =>
    tauriInvoke(TAURI_COMMANDS.WORKSPACE_MOVE, {
      vaultRoot: session.vaultRoot,
      vaultId,
      from: fromRel,
      to: toRel,
    }),
  );
  bump(session);
  return newPath;
}

export function languageFromPath(path: string): VaultFileLanguage {
  return vaultFileLanguageFromPath(path);
}
