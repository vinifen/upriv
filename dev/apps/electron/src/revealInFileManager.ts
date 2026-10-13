import path from "node:path";

export type RevealFs = {
  existsSync(target: string): boolean;
  statSync(target: string): { isDirectory(): boolean };
};

export type RevealShell = {
  showItemInFolder(target: string): void;
  openPath(target: string): Promise<string>;
};

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/**
 * Absolute on this operating system, so `path.resolve` cannot glue a foreign
 * path (`C:\…` on Linux, a UNC prefix on POSIX) onto the current directory.
 */
export function isAbsoluteOsPath(
  target: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const trimmed = target.trim();
  if (!trimmed || hasControlChar(trimmed) || /^content:/i.test(trimmed)) return false;
  if (platform === "win32") return path.win32.isAbsolute(trimmed);
  return path.posix.isAbsolute(trimmed);
}

function osPath(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/** Walk up from a missing leaf to an existing path on disk. */
export function resolveExistingOsPath(
  target: string,
  fs: RevealFs,
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = target.trim();
  if (!trimmed || !isAbsoluteOsPath(trimmed, platform)) {
    throw new Error("open_path_failed: path must be absolute");
  }
  const os = osPath(platform);
  let current = os.resolve(trimmed);
  while (!fs.existsSync(current)) {
    const parent = os.dirname(current);
    if (parent === current) {
      throw new Error("open_path_failed: item is not on disk");
    }
    current = parent;
  }
  return current;
}

/** Directory to use as cwd: the path itself, or its parent when it is a file. */
export function resolveExistingOsDirectory(
  target: string,
  fs: RevealFs,
  platform: NodeJS.Platform = process.platform,
): string {
  const existing = resolveExistingOsPath(target, fs, platform);
  if (fs.statSync(existing).isDirectory()) return existing;
  return osPath(platform).dirname(existing);
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
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const current = resolveExistingOsPath(target, fs, platform);
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
