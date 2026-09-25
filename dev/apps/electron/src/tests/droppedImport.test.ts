import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { statDroppedImportPaths, statListFitsInFreeMemory } from "../droppedImport";

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

  it("does not follow a symlink", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      const real = path.join(dir, "real.txt");
      await fs.writeFile(real, "secret");
      await fs.symlink(real, path.join(dir, "link.txt"));
      const result = await statDroppedImportPaths([dir]);
      expect(result.files.map((row) => row.relativePath)).toEqual([
        `${path.basename(dir)}/real.txt`,
      ]);
      expect(result.truncated).toBe(false);
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
