/** Helpers for OS drag of vault `.zip` / `.7z` onto the vault list. */

export function isVaultImportFileName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".7z");
}

/** Electron exposes absolute `path` on dropped File; browsers do not. */
export function absolutePathFromDroppedFile(file: File): string | undefined {
  const path = (file as File & { path?: string }).path?.trim();
  return path || undefined;
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
