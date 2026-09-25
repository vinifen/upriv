import { describe, expect, it, vi } from "vitest";
import { openOsPathInTerminal, type TerminalChild, type TerminalHost } from "../openInTerminal";

function startedChild(): TerminalChild {
  return {
    unref: vi.fn(),
    on(event, listener) {
      if (event === "spawn") listener();
    },
  };
}

function failingChild(): TerminalChild {
  return {
    unref: vi.fn(),
    on(event, listener) {
      if (event === "error") listener(new Error("ENOENT"));
    },
  };
}

function host(overrides: Partial<TerminalHost> & Pick<TerminalHost, "platform">): TerminalHost {
  return {
    env: {},
    commandExists: () => false,
    spawn: vi.fn(() => startedChild()),
    ...overrides,
  };
}

const existingDir = {
  existsSync: () => true,
  statSync: () => ({ isDirectory: () => true }),
};

describe("openOsPathInTerminal", () => {
  it("opens macOS Terminal.app at the folder", async () => {
    const spawn = vi.fn(() => startedChild());
    await openOsPathInTerminal(
      "/workspace/Notes",
      existingDir,
      host({ platform: "darwin", spawn }),
    );
    expect(spawn).toHaveBeenCalledWith(
      "open",
      ["-a", "Terminal", "/workspace/Notes"],
      expect.objectContaining({ cwd: "/workspace/Notes", detached: true }),
    );
  });

  it("prefers Windows Terminal when wt is on PATH", async () => {
    const spawn = vi.fn(() => startedChild());
    await openOsPathInTerminal(
      "/workspace/Notes",
      existingDir,
      host({
        platform: "win32",
        commandExists: (command) => command === "wt" || command === "wt.exe",
        spawn,
      }),
    );
    expect(spawn).toHaveBeenCalledWith(
      "wt",
      ["-d", "/workspace/Notes"],
      expect.objectContaining({ cwd: "/workspace/Notes" }),
    );
  });

  it("starts cmd.exe with cwd set and does not put the path on the command line", async () => {
    const spawn = vi.fn(() => startedChild());
    await openOsPathInTerminal(
      "/vaults/notes&calc",
      existingDir,
      host({ platform: "win32", env: { ComSpec: "cmd.exe" }, spawn }),
    );
    expect(spawn).toHaveBeenCalledWith(
      "cmd.exe",
      ["/c", "start", "", "cmd.exe"],
      expect.objectContaining({ cwd: "/vaults/notes&calc", windowsHide: false }),
    );
  });

  it("falls through to cmd when wt fails to spawn", async () => {
    const spawn = vi.fn((command: string) => (command === "wt" ? failingChild() : startedChild()));
    await openOsPathInTerminal(
      "/workspace/Notes",
      existingDir,
      host({
        platform: "win32",
        commandExists: (command) => command === "wt",
        env: { ComSpec: "cmd.exe" },
        spawn,
      }),
    );
    expect(spawn).toHaveBeenNthCalledWith(1, "wt", ["-d", "/workspace/Notes"], expect.anything());
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "cmd.exe",
      ["/c", "start", "", "cmd.exe"],
      expect.anything(),
    );
  });

  it("uses $TERMINAL on Linux before gnome-terminal", async () => {
    const spawn = vi.fn(() => startedChild());
    await openOsPathInTerminal(
      "/workspace/Notes",
      existingDir,
      host({
        platform: "linux",
        env: { TERMINAL: "kitty" },
        commandExists: (command) => command === "kitty" || command === "gnome-terminal",
        spawn,
      }),
    );
    expect(spawn).toHaveBeenCalledWith(
      "kitty",
      ["--directory", "/workspace/Notes"],
      expect.objectContaining({ cwd: "/workspace/Notes" }),
    );
  });

  it("tries the next Linux terminal when the first spawn fails", async () => {
    const spawn = vi.fn((command: string) =>
      command === "xdg-terminal-exec" ? failingChild() : startedChild(),
    );
    await openOsPathInTerminal(
      "/workspace/Notes",
      existingDir,
      host({
        platform: "linux",
        commandExists: (command) => command === "xdg-terminal-exec" || command === "kgx",
        spawn,
      }),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "xdg-terminal-exec",
      ["--dir=/workspace/Notes"],
      expect.anything(),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "kgx",
      ["--working-directory", "/workspace/Notes"],
      expect.anything(),
    );
  });

  it("uses xdg-terminal-exec when present", async () => {
    const spawn = vi.fn(() => startedChild());
    await openOsPathInTerminal(
      "/workspace/Notes",
      existingDir,
      host({
        platform: "linux",
        commandExists: (command) => command === "xdg-terminal-exec",
        spawn,
      }),
    );
    expect(spawn).toHaveBeenCalledWith(
      "xdg-terminal-exec",
      ["--dir=/workspace/Notes"],
      expect.anything(),
    );
  });

  it("cds into the parent folder when the selection is a file", async () => {
    const spawn = vi.fn(() => startedChild());
    await openOsPathInTerminal(
      "/workspace/Notes/a.txt",
      {
        existsSync: () => true,
        statSync: () => ({ isDirectory: () => false }),
      },
      host({
        platform: "linux",
        commandExists: (command) => command === "xterm",
        spawn,
      }),
    );
    expect(spawn).toHaveBeenCalledWith(
      "xterm",
      [],
      expect.objectContaining({ cwd: "/workspace/Notes" }),
    );
  });

  it("errors when no Linux terminal is available", async () => {
    await expect(
      openOsPathInTerminal("/workspace/Notes", existingDir, host({ platform: "linux" })),
    ).rejects.toThrow(/open_terminal_failed/);
  });

  it("errors when every Linux candidate fails to spawn", async () => {
    await expect(
      openOsPathInTerminal(
        "/workspace/Notes",
        existingDir,
        host({
          platform: "linux",
          commandExists: (command) => command === "xterm",
          spawn: vi.fn(() => failingChild()),
        }),
      ),
    ).rejects.toThrow(/open_terminal_failed/);
  });

  it("rejects relative paths", async () => {
    await expect(
      openOsPathInTerminal("Notes", existingDir, host({ platform: "linux" })),
    ).rejects.toThrow(/open_terminal_failed/);
  });
});
