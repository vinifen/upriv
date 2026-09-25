import { describe, expect, it, vi } from "vitest";
import { revealOsPathInFileManager } from "../revealInFileManager";

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
});
