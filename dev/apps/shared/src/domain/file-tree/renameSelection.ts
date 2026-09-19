/** Selection range when entering rename — basename before the last `.`. */
export function renameBasenameSelection(name: string): { start: number; end: number } {
  const end = name.length;
  if (!name || name === "." || name === "..") return { start: 0, end };
  const dot = name.lastIndexOf(".");
  // No extension, or leading-dot names (`.env`) → select all.
  if (dot <= 0) return { start: 0, end };
  return { start: 0, end: dot };
}
