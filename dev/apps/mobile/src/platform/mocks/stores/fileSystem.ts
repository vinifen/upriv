import {
  type FileTreeNode,
  type VaultFileContent,
  type VaultFileLanguage,
  vaultFileLanguageFromPath as languageFromPathShared,
  fileBaseName,
  joinPath,
} from "@upriv/shared";
import {
  addChild,
  collectFilePaths,
  findNode,
  getParentPath,
  moveNode,
  removeContentPaths,
  removeNode,
  remapContentPaths,
  renameNode,
  siblingNames,
  uniqueFolderName,
  uniqueName,
} from "@upriv/shared";
import { getMockFileContent, getMockVaultFileTree } from "./fileTree";

interface VaultFileSession {
  tree: FileTreeNode;
  contents: Record<string, string>;
  languages: Record<string, VaultFileLanguage>;
  revision: number;
}

const sessions = new Map<string, VaultFileSession>();

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

export function resetVaultFileSession(vaultId: string): void {
  sessions.delete(vaultId);
}

export function getVaultTreeRevision(vaultId: string): number {
  return ensureSession(vaultId).revision;
}

export function getVaultFileTree(vaultId: string): FileTreeNode {
  return ensureSession(vaultId).tree;
}

export function getVaultFileContent(vaultId: string, path: string): VaultFileContent | null {
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
  const file = getVaultFileContent(vaultId, path);
  if (!file) return false;
  return file.language !== "binary" && file.language !== "image";
}

export function isVaultFileViewable(vaultId: string, path: string): boolean {
  const file = getVaultFileContent(vaultId, path);
  if (!file) return false;
  return file.language !== "binary";
}

export function isVaultFileImage(vaultId: string, path: string): boolean {
  const file = getVaultFileContent(vaultId, path);
  return file?.language === "image";
}

export function setVaultFileContent(vaultId: string, path: string, content: string): number {
  const session = ensureSession(vaultId);
  session.contents[path] = content;
  session.languages[path] ??= languageFromPath(path);
  return bump(session);
}

export function createVaultFile(
  vaultId: string,
  parentPath: string,
  baseName: string,
): string | null {
  const session = ensureSession(vaultId);
  const names = siblingNames(session.tree, parentPath);
  const name = uniqueName(names, baseName);
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
  const session = ensureSession(vaultId);
  if (findNode(session.tree, parentPath)?.type !== "folder") return null;

  const names = siblingNames(session.tree, parentPath);
  const name = uniqueName(names, fileName);
  session.tree = addChild(session.tree, parentPath, { name, type: "file" });
  const path = joinPath(parentPath, name);
  session.contents[path] = content;
  session.languages[path] = languageFromPath(name);
  bump(session);
  return path;
}

export function createVaultFolder(
  vaultId: string,
  parentPath: string,
  baseName: string,
): string | null {
  const session = ensureSession(vaultId);
  const names = siblingNames(session.tree, parentPath);
  const name = uniqueFolderName(names, baseName);
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
  bump(session);
  return joinPath(parentPath, folderName);
}

export function renameVaultPath(vaultId: string, path: string, newName: string): string | null {
  if (path === "/") return null;
  const session = ensureSession(vaultId);
  const parentPath = getParentPath(path);
  const names = siblingNames(session.tree, parentPath).filter((n) => n !== fileBaseName(path));
  if (names.includes(newName)) return null;

  const newPath = joinPath(parentPath, newName);
  session.tree = renameNode(session.tree, path, newName);
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
  if (path === "/") return false;
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
