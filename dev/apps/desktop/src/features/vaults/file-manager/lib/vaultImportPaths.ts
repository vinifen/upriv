/** Browser-only: `File.webkitRelativePath` from folder drag or input. */
export function relativePathFromImportFile(file: File): string {
  const relative = file.webkitRelativePath?.trim();
  return relative && relative.length > 0 ? relative : file.name;
}
