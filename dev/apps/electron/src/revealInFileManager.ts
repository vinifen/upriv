import path from "node:path";

export type RevealFs = {
  existsSync(target: string): boolean;
  statSync(target: string): { isDirectory(): boolean };
};

export type RevealShell = {
  showItemInFolder(target: string): void;
  openPath(target: string): Promise<string>;
};

export function isAbsoluteOsPath(target: string): boolean {
  return path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target);
}

/** Walk up from a missing leaf to an existing path on disk. */
export function resolveExistingOsPath(target: string, fs: RevealFs): string {
  const trimmed = target.trim();
  if (!trimmed || !isAbsoluteOsPath(trimmed)) {
    throw new Error("open_path_failed: path must be absolute");
  }
  let current = path.resolve(trimmed);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("open_path_failed: item is not on disk");
    }
    current = parent;
  }
  return current;
}

/** Directory to use as cwd: the path itself, or its parent when it is a file. */
export function resolveExistingOsDirectory(target: string, fs: RevealFs): string {
  const existing = resolveExistingOsPath(target, fs);
  if (fs.statSync(existing).isDirectory()) return existing;
  return path.dirname(existing);
}

/**
 * Open `target` in Finder / Explorer / the desktop file manager.
 * Files are revealed (selected); directories open as the folder itself.
 * Missing leaves walk up to an existing parent so a just-imported path still works.
 */
export async function revealOsPathInFileManager(
  target: string,
  fs: RevealFs,
  shell: RevealShell,
): Promise<void> {
  const current = resolveExistingOsPath(target, fs);
  const stat = fs.statSync(current);
  if (stat.isDirectory()) {
    const err = await shell.openPath(current);
    if (err) {
      throw new Error(`open_path_failed: ${err}`);
    }
    return;
  }
  shell.showItemInFolder(current);
}
