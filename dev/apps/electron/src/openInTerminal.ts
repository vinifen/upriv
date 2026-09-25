import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveExistingOsDirectory, type RevealFs } from "./revealInFileManager";

export type TerminalSpawnOptions = {
  cwd: string;
  detached: true;
  stdio: "ignore";
  windowsHide: false;
};

export type TerminalChild = {
  unref(): void;
  on(event: "error" | "spawn", listener: (error?: Error) => void): void;
};

export type TerminalHost = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  commandExists(command: string): boolean;
  spawn(command: string, args: readonly string[], options: TerminalSpawnOptions): TerminalChild;
};

type LinuxTerminal = {
  command: string;
  args: (dir: string) => readonly string[];
};

const LINUX_TERMINALS: readonly LinuxTerminal[] = [
  { command: "xdg-terminal-exec", args: (dir) => [`--dir=${dir}`] },
  { command: "kgx", args: (dir) => ["--working-directory", dir] },
  { command: "gnome-terminal", args: (dir) => ["--working-directory", dir] },
  { command: "konsole", args: (dir) => ["--workdir", dir] },
  { command: "xfce4-terminal", args: (dir) => [`--working-directory=${dir}`] },
  { command: "mate-terminal", args: (dir) => [`--working-directory=${dir}`] },
  { command: "tilix", args: (dir) => [`--working-directory=${dir}`] },
  { command: "terminator", args: (dir) => [`--working-directory=${dir}`] },
  { command: "kitty", args: (dir) => ["--directory", dir] },
  { command: "alacritty", args: (dir) => ["--working-directory", dir] },
  { command: "wezterm", args: (dir) => ["start", "--cwd", dir] },
  { command: "lxterminal", args: (dir) => [`--working-directory=${dir}`] },
  { command: "qterminal", args: (dir) => ["--workdir", dir] },
  { command: "deepin-terminal", args: (dir) => ["--work-directory", dir] },
  { command: "terminology", args: (dir) => ["-d", dir] },
  { command: "x-terminal-emulator", args: () => [] },
  { command: "xterm", args: () => [] },
];

const SPAWN_OPTIONS = (cwd: string): TerminalSpawnOptions => ({
  cwd,
  detached: true,
  stdio: "ignore",
  windowsHide: false,
});

function terminalFailed(detail: string): Error {
  return new Error(`open_terminal_failed: ${detail}`);
}

function commandBaseName(command: string): string {
  return path.basename(command).replace(/\.exe$/i, "");
}

function linuxSpecFor(command: string): LinuxTerminal | undefined {
  const name = commandBaseName(command);
  return LINUX_TERMINALS.find((entry) => entry.command === name);
}

function launch(
  host: TerminalHost,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const child = host.spawn(command, args, SPAWN_OPTIONS(cwd));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      child.unref();
      resolve();
    };
    child.on("error", (error) => finish(error ?? new Error("spawn failed")));
    child.on("spawn", () => finish());
  });
}

async function openLinuxTerminal(dir: string, host: TerminalHost): Promise<void> {
  const preferred = host.env.TERMINAL?.trim();
  const tried = new Set<string>();
  const candidates: LinuxTerminal[] = [];
  if (preferred) {
    const known = linuxSpecFor(preferred);
    candidates.push(known ?? { command: preferred, args: () => [] });
  }
  candidates.push(...LINUX_TERMINALS);

  for (const spec of candidates) {
    const key = spec.command;
    if (tried.has(key)) continue;
    tried.add(key);
    if (!host.commandExists(spec.command)) continue;
    try {
      await launch(host, spec.command, spec.args(dir), dir);
      return;
    } catch {
      /* try the next terminal */
    }
  }
  throw terminalFailed("no terminal emulator found");
}

async function openMacTerminal(dir: string, host: TerminalHost): Promise<void> {
  await launch(host, "open", ["-a", "Terminal", dir], dir);
}

async function openWindowsTerminal(dir: string, host: TerminalHost): Promise<void> {
  const wt = host.commandExists("wt") ? "wt" : host.commandExists("wt.exe") ? "wt.exe" : null;
  if (wt) {
    try {
      await launch(host, wt, ["-d", dir], dir);
      return;
    } catch {
      /* fall through to cmd */
    }
  }
  const comspec = host.env.ComSpec?.trim() || "cmd.exe";
  // cwd is the new console's directory. Do not put `dir` on the cmd command line:
  // cmd re-parses `&` and `%` in an unquoted `/D` path.
  await launch(host, comspec, ["/c", "start", "", "cmd.exe"], dir);
}

/** `which` / `where` probe used by the Electron host (injected in tests). */
export function commandExistsOnHost(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!command.trim()) return false;
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command);
  }
  try {
    if (platform === "win32") {
      execFileSync("where.exe", [command], { stdio: "ignore", windowsHide: true });
    } else {
      execFileSync("which", [command], { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

export function createDefaultTerminalHost(): TerminalHost {
  return {
    platform: process.platform,
    env: process.env,
    commandExists: (command) => commandExistsOnHost(command, process.platform),
    spawn: (command, args, options) => spawn(command, [...args], options),
  };
}

/**
 * Open a system terminal whose cwd is `target` (or its parent if `target` is a file).
 * Linux uses `$TERMINAL` when set, then xdg-terminal-exec / common emulators.
 * macOS opens Terminal.app; Windows prefers Windows Terminal, then cmd.
 */
export async function openOsPathInTerminal(
  target: string,
  disk: RevealFs,
  host: TerminalHost,
): Promise<void> {
  let dir: string;
  try {
    dir = resolveExistingOsDirectory(target, disk);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message.replace(/^open_path_failed:\s*/, "")
        : "item is not on disk";
    throw terminalFailed(detail);
  }
  if (host.platform === "darwin") {
    await openMacTerminal(dir, host);
    return;
  }
  if (host.platform === "win32") {
    await openWindowsTerminal(dir, host);
    return;
  }
  await openLinuxTerminal(dir, host);
}
