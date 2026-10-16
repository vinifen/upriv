import { execFile } from "node:child_process";
import path from "node:path";

/** Directories pkexec may run a package manager from. A user PATH entry is not one of them. */
const SYSTEM_BIN_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] as const;

const PACKAGE_ARGS = {
  apt: ["install", "-y", "fuse3"],
  dnf: ["install", "-y", "fuse3"],
  pacman: ["-S", "--noconfirm", "--needed", "fuse3"],
  zypper: ["--non-interactive", "install", "fuse3"],
  apk: ["add", "fuse3"],
} as const;

type FusePackageManager = keyof typeof PACKAGE_ARGS;

const PACKAGE_BIN: Record<FusePackageManager, string> = {
  apt: "apt-get",
  dnf: "dnf",
  pacman: "pacman",
  zypper: "zypper",
  apk: "apk",
};

export interface FuseInstallPlan {
  pkexec: string;
  args: string[];
}

/** `fusermount3` and a usable `/dev/fuse`. Both come from the distro `fuse3` package. */
export function fuseRuntimeReady(input: {
  fusermount3: boolean;
  fuseDeviceWritable: boolean;
}): boolean {
  return input.fusermount3 && input.fuseDeviceWritable;
}

export function osReleaseIdentity(text: string): { id: string; like: string[] } {
  let id = "";
  let like: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ID=")) id = unquote(trimmed.slice("ID=".length));
    if (trimmed.startsWith("ID_LIKE=")) {
      like = unquote(trimmed.slice("ID_LIKE=".length))
        .split(/\s+/)
        .filter((part) => part.length > 0);
    }
  }
  return { id: id.toLowerCase(), like: like.map((part) => part.toLowerCase()) };
}

export function fusePackageManager(id: string, like: readonly string[]): FusePackageManager | null {
  const tokens = new Set([id, ...like]);
  const has = (...names: string[]) => names.some((name) => tokens.has(name));
  if (has("alpine")) return "apk";
  if (has("arch", "manjaro", "endeavouros", "steamos")) return "pacman";
  if ([...tokens].some((token) => token.includes("suse"))) return "zypper";
  if (has("fedora", "rhel", "centos", "ol", "rocky", "almalinux", "nobara")) return "dnf";
  if (has("debian", "ubuntu", "linuxmint", "pop", "elementary", "zorin")) return "apt";
  return null;
}

/**
 * Absolute `pkexec` argv for this distro. Null when the distro or the binaries
 * are unknown. The package name is always `fuse3`.
 */
export function fuseInstallPlan(input: {
  osRelease: string;
  canExecute: (candidate: string) => boolean;
}): FuseInstallPlan | null {
  const pkexec = resolveSystemBinary("pkexec", input.canExecute);
  if (!pkexec) return null;
  const { id, like } = osReleaseIdentity(input.osRelease);
  const manager = fusePackageManager(id, like);
  if (!manager) return null;
  const bin = resolveSystemBinary(PACKAGE_BIN[manager], input.canExecute);
  if (!bin) return null;
  return { pkexec, args: [bin, ...PACKAGE_ARGS[manager]] };
}

/** First executable `name` under the system bin directories. */
export function resolveSystemBinary(
  name: string,
  canExecute: (candidate: string) => boolean,
): string | null {
  if (name.length === 0 || name.includes("/") || name.includes("\0")) return null;
  for (const dir of SYSTEM_BIN_DIRS) {
    const candidate = path.join(dir, name);
    if (canExecute(candidate)) return candidate;
  }
  return null;
}

export function runFuseInstall(plan: FuseInstallPlan): Promise<number> {
  if (!isAbsoluteFile(plan.pkexec) || plan.args.length === 0 || !isAbsoluteFile(plan.args[0])) {
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    execFile(plan.pkexec, plan.args, (error) => {
      if (!error) {
        resolve(0);
        return;
      }
      const code = "code" in error && typeof error.code === "number" ? error.code : 1;
      resolve(code);
    });
  });
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isAbsoluteFile(file: string): boolean {
  return file.startsWith("/") && !file.includes("\0") && file !== "/";
}
