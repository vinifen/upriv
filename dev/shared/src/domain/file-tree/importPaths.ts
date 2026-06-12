import type { VaultFileSystemService } from "../../services/filesystem/VaultFileSystemService";
import { validateFileName } from "./fileNameValidation";
import { joinPath } from "./treeUtils";

export function resolveImportDestination(
  vaultId: string,
  baseParentPath: string,
  relativePath: string,
  ensureFolder: VaultFileSystemService["ensureFolder"],
): { parentPath: string; fileName: string } | null {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const fileName = segments.pop();
  if (!fileName) return null;

  let parentPath = baseParentPath;
  for (const segment of segments) {
    if (validateFileName(segment)) return null;
    const next = ensureFolder(vaultId, parentPath, segment);
    if (!next) return null;
    parentPath = next;
  }

  if (validateFileName(fileName)) return null;

  return { parentPath, fileName };
}

export function foldersToExpandOnImport(baseParentPath: string, relativePath: string): string[] {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length <= 1) return [baseParentPath];

  const paths = [baseParentPath];
  let current = baseParentPath;
  for (const segment of segments.slice(0, -1)) {
    current = joinPath(current, segment);
    paths.push(current);
  }
  return paths;
}
