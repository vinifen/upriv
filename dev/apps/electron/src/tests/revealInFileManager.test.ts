import { describe, expect, it, vi } from "vitest";
import { isAbsoluteOsPath, revealOsPathInFileManager } from "../revealInFileManager";

describe("isAbsoluteOsPath", () => {
  it("accepts paths that are absolute on that operating system", () => {
    expect(isAbsoluteOsPath("/data/.upriv", "linux")).toBe(true);
    expect(isAbsoluteOsPath("C:\\Users\\vault", "win32")).toBe(true);
    expect(isAbsoluteOsPath("D:/vaults", "win32")).toBe(true);
    expect(isAbsoluteOsPath("\\\\server\\share\\upriv", "win32")).toBe(true);
    expect(isAbsoluteOsPath("Notes", "linux")).toBe(false);
    expect(isAbsoluteOsPath("content://tree", "linux")).toBe(false);
    expect(isAbsoluteOsPath("CONTENT://tree", "win32")).toBe(false);
    expect(isAbsoluteOsPath("C:\\Users\\vault", "linux")).toBe(false);
    expect(isAbsoluteOsPath("\\\\server\\share\\upriv", "linux")).toBe(false);
    expect(isAbsoluteOsPath("/tmp/\u0000etc", "linux")).toBe(false);
  });
});

describe("revealOsPathInFileManager", () => {
  it("opens an existing directory with openPath", async () => {
    const openPath = vi.fn(async () => "");
    const showItemInFolder = vi.fn();
    await revealOsPathInFileManager(
      "/workspace/Notes",
      {
        existsSync: () => true,
        statSync: () => ({ isDirectory: () => true }),
      },
      { openPath, showItemInFolder },
    );
    expect(openPath).toHaveBeenCalledWith("/workspace/Notes");
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it("reveals an existing file in the file manager", async () => {
    const openPath = vi.fn(async () => "");
    const showItemInFolder = vi.fn();
    await revealOsPathInFileManager(
      "/workspace/Notes/a.txt",
      {
        existsSync: () => true,
        statSync: () => ({ isDirectory: () => false }),
      },
      { openPath, showItemInFolder },
    );
    expect(showItemInFolder).toHaveBeenCalledWith("/workspace/Notes/a.txt");
    expect(openPath).not.toHaveBeenCalled();
  });

  it("walks up to an existing parent when the leaf is missing", async () => {
    const openPath = vi.fn(async () => "");
    await revealOsPathInFileManager(
      "/workspace/Notes/missing.txt",
      {
        existsSync: (target) => target === "/workspace/Notes",
        statSync: () => ({ isDirectory: () => true }),
      },
      { openPath, showItemInFolder: vi.fn() },
    );
    expect(openPath).toHaveBeenCalledWith("/workspace/Notes");
  });

  it("rejects relative paths", async () => {
    await expect(
      revealOsPathInFileManager(
        "Notes",
        { existsSync: () => true, statSync: () => ({ isDirectory: () => true }) },
        { openPath: async () => "", showItemInFolder: vi.fn() },
      ),
    ).rejects.toThrow(/open_path_failed/);
  });

  it("does not resolve a foreign absolute form against the current directory", async () => {
    if (process.platform === "win32") return;
    const existsSync = vi.fn(() => true);
    await expect(
      revealOsPathInFileManager(
        "C:\\Users\\vault",
        { existsSync, statSync: () => ({ isDirectory: () => true }) },
        { openPath: async () => "", showItemInFolder: vi.fn() },
      ),
    ).rejects.toThrow(/open_path_failed/);
    expect(existsSync).not.toHaveBeenCalled();
  });

  it("fails when no ancestor exists", async () => {
    await expect(
      revealOsPathInFileManager(
        "/missing/leaf",
        { existsSync: () => false, statSync: () => ({ isDirectory: () => true }) },
        { openPath: async () => "", showItemInFolder: vi.fn() },
      ),
    ).rejects.toThrow(/not on disk/);
  });

  it("surfaces an openPath failure", async () => {
    await expect(
      revealOsPathInFileManager(
        "/workspace/Notes",
        {
          existsSync: () => true,
          statSync: () => ({ isDirectory: () => true }),
        },
        { openPath: async () => "No application", showItemInFolder: vi.fn() },
      ),
    ).rejects.toThrow(/open_path_failed: No application/);
  });
});
