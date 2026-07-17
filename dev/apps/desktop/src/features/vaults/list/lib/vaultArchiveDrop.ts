/** Helpers for OS drag of vault `.7z` archives onto the vault list. */

export function isSevenZipFileName(name: string): boolean {
  return name.trim().toLowerCase().endsWith(".7z");
}

/** Electron exposes absolute `path` on dropped File; browsers do not. */
export function absolutePathFromDroppedFile(file: File): string | undefined {
  const path = (file as File & { path?: string }).path?.trim();
  return path || undefined;
}

export function firstSevenZipFile(files: Iterable<File>): File | null {
  for (const file of files) {
    if (file.name.length > 0 && isSevenZipFileName(file.name)) return file;
  }
  return null;
}

export function dataTransferHasSevenZip(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.files).some(
    (file) => file.name.length > 0 && isSevenZipFileName(file.name),
  );
}
