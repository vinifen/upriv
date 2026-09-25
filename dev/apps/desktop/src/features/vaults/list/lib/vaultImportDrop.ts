import { isAbsoluteOsFilesystemPath } from "@upriv/shared";

/** Helpers for OS drag of vault `.zip` / `.7z` onto the vault list. */

export function isVaultImportFileName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".7z");
}

function droppedFilePathHint(file: File): string | undefined {
  const legacy = (file as File & { path?: string }).path?.trim();
  if (legacy) return legacy;
  const api = typeof window !== "undefined" ? window.upriv : undefined;
  if (!api || typeof api.getPathForFile !== "function") return undefined;
  try {
    return api.getPathForFile(file)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Absolute OS path of an OS-dropped vault package.
 * Electron 32+ removed `File.path` — prefer `window.upriv.getPathForFile`.
 * Relative names and SAF URIs are dropped: the daemon can only `std::fs::read` a real path.
 */
export function absolutePathFromDroppedFile(file: File): string | undefined {
  const path = droppedFilePathHint(file);
  if (!path || !isAbsoluteOsFilesystemPath(path)) return undefined;
  return path;
}

export function firstVaultImportFile(files: Iterable<File>): File | null {
  for (const file of files) {
    if (file.name.length > 0 && isVaultImportFileName(file.name)) return file;
  }
  return null;
}

export function dataTransferHasVaultImport(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.files).some(
    (file) => file.name.length > 0 && isVaultImportFileName(file.name),
  );
}
