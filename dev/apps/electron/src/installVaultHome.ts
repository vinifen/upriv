import fs from "node:fs";
import path from "node:path";

/** How a packaged desktop build places the default data folder. */
export type PackagedVaultHome = "portable" | "installed";

/**
 * Portable artifacts keep `.upriv` beside the program.
 * Every other packaged build uses the OS user-data directory, including a
 * Windows installer whose install folder is writable.
 */
export function packagedVaultHome(input: {
  platform: NodeJS.Platform;
  portableExecutableDir?: string;
  appImageFile?: boolean;
}): PackagedVaultHome {
  const portableDir = input.portableExecutableDir?.trim() ?? "";
  if (input.platform === "win32" && portableDir.length > 0) return "portable";
  if (input.appImageFile) return "portable";
  return "installed";
}

export type InstallVaultRelocateNotice = "left_behind" | "move_failed";

export type InstallVaultRelocate = {
  /** Folder Electron should pin as `UPRIV_DEFAULT_ROOT_ANCHOR`. */
  anchor: string;
  notice: InstallVaultRelocateNotice | null;
  /** Install directory that still holds `.upriv`, or where the move failed. */
  noticePath: string | null;
};

/**
 * Move `.upriv` (and `.upriv-root` when the destination has none) out of a
 * Windows install directory into the user-data folder.
 *
 * The source tree is removed only after the destination has the same files.
 * When the destination already has `.upriv`, both stay and `anchor` is the
 * user-data folder. When the move fails, `anchor` stays the install directory
 * so this launch can still open the vaults.
 */
export function relocateInstallDirVault(
  installDir: string,
  userData: string,
): InstallVaultRelocate {
  const install = path.resolve(installDir);
  const home = path.resolve(userData);
  if (install === home) {
    return { anchor: home, notice: null, noticePath: null };
  }
  const source = path.join(install, ".upriv");
  const dest = path.join(home, ".upriv");
  const sourceKind = pathKind(source);
  if (sourceKind === "symlink") {
    return { anchor: install, notice: "move_failed", noticePath: install };
  }
  if (sourceKind !== "directory") {
    moveAlias(install, home);
    return { anchor: home, notice: null, noticePath: null };
  }
  if (existsDir(dest)) {
    moveAlias(install, home);
    return { anchor: home, notice: "left_behind", noticePath: install };
  }
  fs.mkdirSync(home, { recursive: true });
  if (!moveTree(source, dest)) {
    return { anchor: install, notice: "move_failed", noticePath: install };
  }
  moveAlias(install, home);
  return { anchor: home, notice: null, noticePath: null };
}

function existsDir(dir: string): boolean {
  return pathKind(dir) === "directory";
}

function pathKind(target: string): "directory" | "symlink" | "other" {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    return "other";
  } catch {
    return "other";
  }
}

function moveAlias(installDir: string, userData: string): void {
  try {
    const source = path.join(installDir, ".upriv-root");
    const dest = path.join(userData, ".upriv-root");
    if (!existsFile(source) || existsFile(dest)) return;
    fs.mkdirSync(userData, { recursive: true });
    moveFile(source, dest);
  } catch {
    // The data folder move already finished. A leftover alias is retried next launch.
  }
}

function existsFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * `false` leaves `source` in place and does not keep a partial `dest`.
 * A symlink anywhere in the tree fails the move. After a verified copy, a
 * failure to delete `source` still counts as success: the destination is complete.
 */
function moveTree(source: string, dest: string): boolean {
  try {
    if (containsSymlink(source)) return false;
  } catch {
    return false;
  }
  try {
    fs.renameSync(source, dest);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") return false;
  }
  try {
    fs.cpSync(source, dest, { recursive: true, verbatimSymlinks: true });
    if (!sameFiles(source, dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      return false;
    }
  } catch {
    fs.rmSync(dest, { recursive: true, force: true });
    return false;
  }
  try {
    fs.rmSync(source, { recursive: true, force: true });
  } catch {
    // Destination matches. The next launch reports the leftover source.
  }
  return true;
}

function moveFile(source: string, dest: string): void {
  try {
    fs.renameSync(source, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") return;
    fs.copyFileSync(source, dest);
    fs.rmSync(source, { force: true });
  }
}

function containsSymlink(dir: string): boolean {
  for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name);
    const stat = fs.lstatSync(child);
    if (stat.isSymbolicLink()) return true;
    if (stat.isDirectory() && containsSymlink(child)) return true;
  }
  return false;
}

function sameFiles(source: string, dest: string): boolean {
  const left = fileList(source);
  const right = fileList(dest);
  if (left == null || right == null) return false;
  return left.join("\n") === right.join("\n");
}

function fileList(dir: string, prefix = ""): string[] | null {
  const lines: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const child = path.join(dir, name);
    const rel = prefix.length === 0 ? name : `${prefix}/${name}`;
    const stat = fs.lstatSync(child);
    if (stat.isSymbolicLink()) return null;
    if (stat.isDirectory()) {
      lines.push(`${rel}/`);
      const nested = fileList(child, rel);
      if (nested == null) return null;
      lines.push(...nested);
    } else if (stat.isFile()) {
      lines.push(`${rel}:${stat.size}`);
    }
  }
  return lines;
}
