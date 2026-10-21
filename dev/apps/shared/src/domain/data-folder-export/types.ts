/** File name of the written zip, from its path on either system. */
export function dataFolderZipName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
