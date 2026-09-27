import { isAbsoluteOsFilesystemPath, type CreateVaultImportShape } from "@upriv/shared";
import {
  droppedOsRootPaths,
  type OsDropSnapshot,
} from "@/features/vaults/file-manager/lib/osFileDrop";

/** One create-vault import chosen from an OS drop. */
export interface VaultListDropSource {
  fileName: string;
  absolutePath?: string;
  shape: CreateVaultImportShape;
}

function fileNameFromOsPath(osPath: string): string {
  const parts = osPath.split("/");
  const name = parts[parts.length - 1] ?? "";
  return name.trim();
}

async function shapeOfDroppedPath(absolutePath: string): Promise<CreateVaultImportShape> {
  const api = typeof window === "undefined" ? undefined : window.upriv;
  if (!api || typeof api.classifyDroppedPath !== "function") return "file";
  try {
    const kind = await api.classifyDroppedPath(absolutePath);
    return kind === "directory" ? "directory" : "file";
  } catch {
    return "file";
  }
}

/**
 * First dropped file or folder. A file inside a dropped folder is not its own import.
 * The daemon reads that path later — this does not walk the folder.
 */
export async function vaultListDropSource(
  snapshot: OsDropSnapshot,
): Promise<VaultListDropSource | null> {
  const roots = await droppedOsRootPaths(snapshot);
  for (const root of roots) {
    if (!isAbsoluteOsFilesystemPath(root)) continue;
    const fileName = fileNameFromOsPath(root);
    if (!fileName) continue;
    return {
      fileName,
      absolutePath: root,
      shape: await shapeOfDroppedPath(root),
    };
  }

  const named = snapshot.files.find((dropped) => dropped.file.name.trim().length > 0);
  if (!named) return null;
  return { fileName: named.file.name.trim(), shape: "file" };
}
