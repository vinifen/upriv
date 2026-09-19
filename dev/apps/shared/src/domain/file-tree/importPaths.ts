import { sanitizeLogicalFileName } from "./fileNameValidation";
import { joinPath } from "./treeUtils";

export type EnsureFolderFn = (
  vaultId: string,
  parentPath: string,
  folderName: string,
) => string | null;

/** Folder drag/input may use `\\` on Windows; treat both as path separators. */
export function importPathSegments(relativePath: string): string[] {
  return relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function resolveImportDestination(
  vaultId: string,
  baseParentPath: string,
  relativePath: string,
  ensureFolder: EnsureFolderFn,
): { parentPath: string; fileName: string } | null {
  const segments = importPathSegments(relativePath);
  if (segments.length === 0) return null;

  const rawFileName = segments.pop();
  if (!rawFileName) return null;
  const fileName = sanitizeLogicalFileName(rawFileName, "file");

  let parentPath = baseParentPath;
  for (const segment of segments) {
    const folderName = sanitizeLogicalFileName(segment, "folder");
    const next = ensureFolder(vaultId, parentPath, folderName);
    if (!next) return null;
    parentPath = next;
  }

  return { parentPath, fileName };
}

export function foldersToExpandOnImport(baseParentPath: string, relativePath: string): string[] {
  const segments = importPathSegments(relativePath);
  if (segments.length <= 1) return [baseParentPath];

  const paths = [baseParentPath];
  let current = baseParentPath;
  for (const segment of segments.slice(0, -1)) {
    current = joinPath(current, sanitizeLogicalFileName(segment, "folder"));
    paths.push(current);
  }
  return paths;
}
