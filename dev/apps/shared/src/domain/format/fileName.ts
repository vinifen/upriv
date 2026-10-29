/** File name of a written file, from its path on any system (`/`, `\`, or a phone's export mount). */
export function fileNameOfPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
