import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyDroppedPath,
  readDroppedPathRange,
  statDroppedImportPaths,
  statListFitsInFreeMemory,
} from "../droppedImport";

describe("classifyDroppedPath", () => {
  it("distinguishes a file, a folder, a symlink, and a missing path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      const file = path.join(dir, "note.txt");
      const folder = path.join(dir, "Photos");
      const real = path.join(dir, "real.txt");
      await fs.writeFile(file, "hi");
      await fs.mkdir(folder);
      await fs.writeFile(real, "secret");
      await fs.symlink(folder, path.join(dir, "link"));
      expect(await classifyDroppedPath(file)).toBe("file");
      expect(await classifyDroppedPath(folder)).toBe("directory");
      expect(await classifyDroppedPath(path.join(dir, "link"))).toBe("other");
      expect(await classifyDroppedPath(path.join(dir, "missing"))).toBe("other");
      expect(await classifyDroppedPath("")).toBe("other");
      expect(await classifyDroppedPath("notes.txt")).toBe("other");
      expect(await classifyDroppedPath(1)).toBe("other");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("statDroppedImportPaths", () => {
  it("reports a missing root separately from an empty directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      const empty = path.join(dir, "empty");
      const file = path.join(dir, "note.txt");
      const missing = path.join(dir, "missing.txt");
      await fs.mkdir(empty);
      await fs.writeFile(file, "hi");
      const result = await statDroppedImportPaths([empty, file, missing]);
      expect(result.files.map((row) => row.relativePath)).toEqual(["note.txt"]);
      expect(result.unreadable).toEqual([missing]);
      expect(result.truncated).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("lists every file under the depth cap and reports a deeper file as truncated", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      await fs.writeFile(path.join(dir, "keep.txt"), "ok");
      let nested = dir;
      for (let depth = 0; depth < 13; depth += 1) {
        nested = path.join(nested, "z");
        await fs.mkdir(nested);
      }
      await fs.writeFile(path.join(nested, "hidden.txt"), "no");
      const result = await statDroppedImportPaths([dir]);
      expect(result.files.map((row) => row.relativePath)).toEqual([
        `${path.basename(dir)}/keep.txt`,
      ]);
      expect(result.truncated).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses the tree when a directory entry is a symlink", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      const real = path.join(dir, "real.txt");
      await fs.writeFile(real, "secret");
      const link = path.join(dir, "link.txt");
      await fs.symlink(real, link);
      const result = await statDroppedImportPaths([dir]);
      expect(result.files).toEqual([]);
      expect(result.symlinks).toEqual([link]);
      expect(result.truncated).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readDroppedPathRange", () => {
  it("reads a regular file and refuses a symlink", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      const real = path.join(dir, "real.txt");
      await fs.writeFile(real, "secret");
      const link = path.join(dir, "link.txt");
      await fs.symlink(real, link);
      const read = await readDroppedPathRange(real, 0, 6);
      expect(Buffer.from(read.contentB64, "base64").toString()).toBe("secret");
      await expect(readDroppedPathRange(link, 0, 6)).rejects.toThrow("refusing a symlink");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("statListFitsInFreeMemory", () => {
  it("accepts a path list while free memory covers the reserve and a renderer copy", () => {
    const ceiling = 8 * 1024 * 1024 * 1024;
    expect(statListFitsInFreeMemory(0, 400, 2 * 1024 * 1024 * 1024, ceiling)).toBe(true);
  });

  it("refuses another path when free memory is below the reserve", () => {
    const ceiling = 8 * 1024 * 1024 * 1024;
    expect(statListFitsInFreeMemory(0, 400, 32 * 1024 * 1024, ceiling)).toBe(false);
  });

  it("counts the path list twice, once in this process and once in the renderer", () => {
    const ceiling = 8 * 1024 * 1024 * 1024;
    const retained = 2 * 1024 * 1024 * 1024;
    expect(statListFitsInFreeMemory(retained, 100, 4 * 1024 * 1024 * 1024, ceiling)).toBe(false);
  });
});
