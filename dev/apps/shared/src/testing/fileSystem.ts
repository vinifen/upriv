import {
  addChild,
  collectFilePaths,
  fileBaseName,
  findNode,
  getParentPath,
  imageDataUrlFromBase64,
  joinPath,
  moveNode,
  removeContentPaths,
  removeNode,
  remapContentPaths,
  renameNode,
  siblingNames,
  type FileTreeNode,
  type VaultFileContent,
  type VaultFileLanguage,
  uniqueFolderName,
  uniqueName,
  acceptedLogicalFileName,
  vaultFileLanguageFromPath as languageFromPathShared,
} from "../domain/file-tree";
import {
  isInternalVaultFileName,
  isInternalVaultPath,
  omitInternalVaultNodes,
  UPRIV_WORKSPACE_PATH,
} from "../domain/file-manager/workspaceSnapshot";
import { RpcError } from "../domain/core-rpc/errors";
import { VAULT_ERROR_CODES } from "../domain/vault/errors/codes";
import { getMockFileContent, getMockVaultFileTree } from "./fileTree";
import type {
  VaultBinaryByteSource,
  VaultFileSystemService,
} from "../services/filesystem/VaultFileSystemService";

interface VaultFileSession {
  tree: FileTreeNode;
  contents: Record<string, string>;
  languages: Record<string, VaultFileLanguage>;
  revision: number;
}

const sessions = new Map<string, VaultFileSession>();

/**
 * Expo Go only. Survives `resetVaultFileSession` inside this process.
 * The live file manager stores this snapshot as a logical file in `store/`.
 */
const durableWorkspaceSnapshots = new Map<string, string>();

function languageFromPath(path: string): VaultFileLanguage {
  return languageFromPathShared(path);
}

/** @deprecated Use `@upriv/shared` vaultFileLanguageFromPath */
export function vaultFileLanguageFromPath(path: string): VaultFileLanguage {
  return languageFromPathShared(path);
}

function loadInitialContents(vaultId: string, tree: FileTreeNode): VaultFileSession {
  const contents: Record<string, string> = {};
  const languages: Record<string, VaultFileLanguage> = {};
  for (const path of collectFilePaths(tree)) {
    const file = getMockFileContent(vaultId, path);
    if (file) {
      contents[path] = file.content;
      languages[path] = file.language;
    }
  }
  const durable = durableWorkspaceSnapshots.get(vaultId);
  if (durable !== undefined) {
    contents[UPRIV_WORKSPACE_PATH] = durable;
    languages[UPRIV_WORKSPACE_PATH] = "text";
  }
  return { tree, contents, languages, revision: 0 };
}

function ensureSession(vaultId: string): VaultFileSession {
  let session = sessions.get(vaultId);
  if (!session) {
    const tree = getMockVaultFileTree(vaultId);
    session = loadInitialContents(vaultId, tree);
    sessions.set(vaultId, session);
  }
  return session;
}

function bump(session: VaultFileSession): number {
  session.revision += 1;
  return session.revision;
}

function rememberWorkspaceSnapshot(vaultId: string, session: VaultFileSession): void {
  const raw = session.contents[UPRIV_WORKSPACE_PATH];
  if (typeof raw === "string") {
    durableWorkspaceSnapshots.set(vaultId, raw);
  }
}

export function resetVaultFileSession(vaultId: string): void {
  const session = sessions.get(vaultId);
  if (session) rememberWorkspaceSnapshot(vaultId, session);
  sessions.delete(vaultId);
}

/** Test helper — clear durable FM snapshots too. */
export function resetVaultWorkspaceSnapshots(vaultId?: string): void {
  if (vaultId) durableWorkspaceSnapshots.delete(vaultId);
  else durableWorkspaceSnapshots.clear();
}

/** After mock `vault_rename` changes the folder id — keep FM layout in this process. */
export function remapVaultWorkspaceSnapshot(fromId: string, toId: string): void {
  if (!fromId || fromId === toId) return;

  const session = sessions.get(fromId);
  if (session) {
    rememberWorkspaceSnapshot(fromId, session);
    sessions.set(toId, session);
    sessions.delete(fromId);
  }

  const raw = durableWorkspaceSnapshots.get(fromId);
  if (raw !== undefined) {
    durableWorkspaceSnapshots.set(toId, raw);
    durableWorkspaceSnapshots.delete(fromId);
  }
}

export function getVaultTreeRevision(vaultId: string): number {
  return ensureSession(vaultId).revision;
}

export function getVaultFileTree(vaultId: string): FileTreeNode {
  return omitInternalVaultNodes(ensureSession(vaultId).tree);
}

export function getVaultFileContent(vaultId: string, path: string): VaultFileContent | null {
  if (isInternalVaultPath(path)) {
    const session = ensureSession(vaultId);
    const fromSession = session.contents[path];
    if (typeof fromSession === "string") {
      return { content: fromSession, language: "text" };
    }
    const durable = durableWorkspaceSnapshots.get(vaultId);
    if (typeof durable === "string") {
      return { content: durable, language: "text" };
    }
    return null;
  }

  const session = ensureSession(vaultId);
  if (!(path in session.contents)) {
    const initial = getMockFileContent(vaultId, path);
    if (!initial) return null;
    return initial;
  }
  return {
    content: session.contents[path] ?? "",
    language: session.languages[path] ?? languageFromPath(path),
  };
}

export function isVaultFileEditable(vaultId: string, path: string): boolean {
  if (isInternalVaultPath(path)) return false;
  const file = getVaultFileContent(vaultId, path);
  if (!file) return false;
  return file.language !== "binary" && file.language !== "image";
}

export function isVaultFileViewable(vaultId: string, path: string): boolean {
  if (isInternalVaultPath(path)) return false;
  const file = getVaultFileContent(vaultId, path);
  if (!file) return false;
  return file.language !== "binary";
}

export function isVaultFileImage(vaultId: string, path: string): boolean {
  if (isInternalVaultPath(path)) return false;
  const file = getVaultFileContent(vaultId, path);
  return file?.language === "image";
}

export function setVaultFileContent(vaultId: string, path: string, content: string): number {
  const session = ensureSession(vaultId);
  session.contents[path] = content;
  session.languages[path] ??= languageFromPath(path);
  if (isInternalVaultPath(path)) {
    durableWorkspaceSnapshots.set(vaultId, content);
    /* Internal snapshot writes do not need a tree node or explorer revision bump. */
    return session.revision;
  }
  return bump(session);
}

function acceptedSessionName(raw: string): string | null {
  const name = acceptedLogicalFileName(raw);
  if (!name || isInternalVaultFileName(name)) return null;
  return name;
}

export function createVaultFile(
  vaultId: string,
  parentPath: string,
  baseName: string,
): string | null {
  const base = acceptedSessionName(baseName);
  if (!base) return null;
  const session = ensureSession(vaultId);
  const names = siblingNames(session.tree, parentPath);
  const name = uniqueName(names, base);
  session.tree = addChild(session.tree, parentPath, { name, type: "file" });
  const path = joinPath(parentPath, name);
  session.contents[path] = "";
  session.languages[path] = languageFromPath(path);
  bump(session);
  return path;
}

export function importVaultFile(
  vaultId: string,
  parentPath: string,
  fileName: string,
  content: string,
): string | null {
  const imported = acceptedSessionName(fileName);
  if (!imported) return null;
  const session = ensureSession(vaultId);
  if (findNode(session.tree, parentPath)?.type !== "folder") return null;

  const names = siblingNames(session.tree, parentPath);
  const name = uniqueName(names, imported);
  session.tree = addChild(session.tree, parentPath, { name, type: "file" });
  const path = joinPath(parentPath, name);
  session.contents[path] = content;
  session.languages[path] = languageFromPath(name);
  bump(session);
  return path;
}

const MOCK_IMPORT_CHUNK = 4 * 1024 * 1024;

function concatMockBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function mockBytesToB64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

async function bytesFromMockSource(source: VaultBinaryByteSource): Promise<Uint8Array> {
  if (source.size === 0) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  if (source.size > 0) {
    let offset = 0;
    while (offset < source.size) {
      const end = Math.min(offset + MOCK_IMPORT_CHUNK, source.size);
      chunks.push(await source.slice(offset, end));
      offset = end;
    }
    return concatMockBytes(chunks);
  }
  let offset = 0;
  for (;;) {
    const piece = await source.slice(offset, offset + MOCK_IMPORT_CHUNK);
    if (piece.byteLength === 0) break;
    chunks.push(piece);
    offset += piece.byteLength;
    if (piece.byteLength < MOCK_IMPORT_CHUNK) break;
  }
  return concatMockBytes(chunks);
}

function contentFromMockBytes(fileName: string, bytes: Uint8Array): string {
  const language = languageFromPath(fileName);
  if (language === "binary") return "";
  if (language === "image") return imageDataUrlFromBase64(mockBytesToB64(bytes), fileName);
  return new TextDecoder().decode(bytes);
}

export async function importVaultFileFromBytes(
  vaultId: string,
  parentPath: string,
  fileName: string,
  source: VaultBinaryByteSource,
): Promise<string | null> {
  const bytes = await bytesFromMockSource(source);
  return importVaultFile(vaultId, parentPath, fileName, contentFromMockBytes(fileName, bytes));
}

export function createVaultFolder(
  vaultId: string,
  parentPath: string,
  baseName: string,
): string | null {
  const base = acceptedSessionName(baseName);
  if (!base) return null;
  const session = ensureSession(vaultId);
  const names = siblingNames(session.tree, parentPath);
  const name = uniqueFolderName(names, base);
  session.tree = addChild(session.tree, parentPath, { name, type: "folder", children: [] });
  bump(session);
  return joinPath(parentPath, name);
}

/** Returns existing folder path or creates one with an exact name (for OS imports). */
export function ensureVaultFolder(
  vaultId: string,
  parentPath: string,
  folderName: string,
): string | null {
  const name = acceptedSessionName(folderName);
  if (!name) return null;
  const session = ensureSession(vaultId);
  const parent = findNode(session.tree, parentPath);
  if (parent?.type !== "folder") return null;

  const existing = parent.children?.find((child) => child.type === "folder" && child.name === name);
  if (existing) return joinPath(parentPath, name);

  session.tree = addChild(session.tree, parentPath, {
    name,
    type: "folder",
    children: [],
  });
  bump(session);
  return joinPath(parentPath, name);
}

export function renameVaultPath(vaultId: string, path: string, newName: string): string | null {
  const name = acceptedSessionName(newName);
  if (path === "/" || !name || isInternalVaultPath(path)) {
    return null;
  }
  const session = ensureSession(vaultId);
  const parentPath = getParentPath(path);
  const names = siblingNames(session.tree, parentPath).filter((n) => n !== fileBaseName(path));
  if (names.includes(name)) return null;

  const newPath = joinPath(parentPath, name);
  session.tree = renameNode(session.tree, path, name);
  session.contents = remapContentPaths(session.contents, path, newPath);
  const nextLanguages: Record<string, VaultFileLanguage> = {};
  for (const [p, lang] of Object.entries(session.languages)) {
    if (p === path) nextLanguages[newPath] = lang;
    else if (p.startsWith(`${path}/`)) nextLanguages[`${newPath}${p.slice(path.length)}`] = lang;
    else nextLanguages[p] = lang;
  }
  session.languages = nextLanguages;
  bump(session);
  return newPath;
}

export function deleteVaultPath(vaultId: string, path: string): boolean {
  if (path === "/" || isInternalVaultPath(path)) return false;
  const session = ensureSession(vaultId);
  session.tree = removeNode(session.tree, path);
  session.contents = removeContentPaths(session.contents, path);
  session.languages = removeContentPaths(session.languages, path) as Record<
    string,
    VaultFileLanguage
  >;
  bump(session);
  return true;
}

export function moveVaultPath(
  vaultId: string,
  fromPath: string,
  toFolderPath: string,
): string | null {
  if (
    fromPath === "/" ||
    fromPath === toFolderPath ||
    isInternalVaultPath(fromPath) ||
    isInternalVaultFileName(fileBaseName(fromPath))
  ) {
    return null;
  }
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
  const nextLanguages: Record<string, VaultFileLanguage> = {};
  for (const [p, lang] of Object.entries(session.languages)) {
    if (p === fromPath) nextLanguages[newPath] = lang;
    else if (p.startsWith(`${fromPath}/`))
      nextLanguages[`${newPath}${p.slice(fromPath.length)}`] = lang;
    else nextLanguages[p] = lang;
  }
  session.languages = nextLanguages;
  bump(session);
  return newPath;
}

/** Browser / test adapter wrapping the in-memory session helpers. */
export function createAsyncVaultFileSystemService(): VaultFileSystemService {
  return {
    resetSession: resetVaultFileSession,
    getTreeRevision: async (vaultId) => getVaultTreeRevision(vaultId),
    getFileTree: async (vaultId) => getVaultFileTree(vaultId),
    getFileContent: async (vaultId, path) => getVaultFileContent(vaultId, path),
    isFileEditable: isVaultFileEditable,
    isFileViewable: isVaultFileViewable,
    isFileImage: isVaultFileImage,
    setFileContent: async (vaultId, path, content) => setVaultFileContent(vaultId, path, content),
    createFile: async (vaultId, parentPath, baseName) =>
      createVaultFile(vaultId, parentPath, baseName),
    importFile: async (vaultId, parentPath, fileName, content) =>
      importVaultFile(vaultId, parentPath, fileName, content),
    importFileFromBytes: async (vaultId, parentPath, fileName, source) =>
      importVaultFileFromBytes(vaultId, parentPath, fileName, source),
    importFileFromOsPath: async (vaultId, parentPath, fileName) =>
      importVaultFile(vaultId, parentPath, fileName, ""),
    createFolder: async (vaultId, parentPath, baseName) =>
      createVaultFolder(vaultId, parentPath, baseName),
    ensureFolder: async (vaultId, parentPath, folderName) =>
      ensureVaultFolder(vaultId, parentPath, folderName),
    renamePath: async (vaultId, path, newName) => renameVaultPath(vaultId, path, newName),
    deletePath: async (vaultId, path) => deleteVaultPath(vaultId, path),
    movePath: async (vaultId, fromPath, toFolderPath) =>
      moveVaultPath(vaultId, fromPath, toFolderPath),
    osPath: async () => {
      throw new RpcError(
        VAULT_ERROR_CODES.MOUNT_FAILED,
        "OS mount is not available in the in-memory file manager",
      );
    },
    languageFromPath: vaultFileLanguageFromPath,
  };
}
