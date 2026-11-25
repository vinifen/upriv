import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyDroppedPath,
  readDroppedPathRange,
  statDroppedImportPaths,
  statListFitsInFreeMemory,
} from "../droppedImport";

/** Windows refuses symlink creation without Developer Mode. The check still runs on Linux. */
async function symlinkOrSkip(target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "EPERM") return false;
    throw error;
  }
}

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
      const link = path.join(dir, "link");
      const linked = await symlinkOrSkip(folder, link);
      expect(await classifyDroppedPath(file)).toBe("file");
      expect(await classifyDroppedPath(folder)).toBe("directory");
      if (linked) expect(await classifyDroppedPath(link)).toBe("other");
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
      expect(result.unreadable).toEqual([{ osPath: missing, reason: "missing" }]);
      expect(result.blocked).toEqual([]);
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

  it("skips a link inside a dropped folder, and names a dropped link", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      const real = path.join(dir, "real.txt");
      await fs.writeFile(real, "secret");
      const link = path.join(dir, "link.txt");
      if (!(await symlinkOrSkip(real, link))) return;
      const inside = await statDroppedImportPaths([dir]);
      expect(inside.files.map((row) => row.relativePath)).toEqual([
        `${path.basename(dir)}/real.txt`,
      ]);
      expect(inside.blocked).toEqual([]);
      const dropped = await statDroppedImportPaths([link, real]);
      expect(dropped.files.map((row) => row.relativePath)).toEqual(["real.txt"]);
      expect(dropped.blocked).toEqual([{ path: "link.txt", reason: "link" }]);
      expect(dropped.blockedCount).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // Root reads every file, and Windows has neither modes nor sockets on disk.
  const asOwner = process.platform !== "win32" && process.getuid?.() !== 0;

  it.runIf(asOwner)(
    "names a file it cannot read, a folder it cannot list, and a socket, with why",
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
      const locked = path.join(dir, "db");
      const server = net.createServer();
      try {
        await fs.writeFile(path.join(dir, "ok.txt"), "ok");
        await fs.writeFile(path.join(dir, "secret.txt"), "no");
        await fs.chmod(path.join(dir, "secret.txt"), 0o000);
        await fs.mkdir(locked);
        await fs.writeFile(path.join(locked, "inside.txt"), "no");
        await fs.chmod(locked, 0o000);
        await new Promise<void>((resolve) => server.listen(path.join(dir, "agent.sock"), resolve));
        const result = await statDroppedImportPaths([dir]);
        const root = path.basename(dir);
        expect(result.files.map((row) => row.relativePath)).toEqual([`${root}/ok.txt`]);
        expect([...result.blocked].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
          { path: `${root}/agent.sock`, reason: "special" },
          { path: `${root}/db`, reason: "permission" },
          { path: `${root}/secret.txt`, reason: "permission" },
        ]);
        expect(result.blockedCount).toBe(3);
        expect(result.truncated).toBe(false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await fs.chmod(locked, 0o700).catch(() => undefined);
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(asOwner)("counts every blocked item and names only the first ones", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upriv-drop-"));
    try {
      for (let index = 0; index < 502; index += 1) {
        const file = path.join(dir, `locked-${index}`);
        await fs.writeFile(file, "no");
        await fs.chmod(file, 0o000);
      }
      const result = await statDroppedImportPaths([dir]);
      expect(result.files).toEqual([]);
      expect(result.blockedCount).toBe(502);
      expect(result.blocked).toHaveLength(500);
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
      const linked = await symlinkOrSkip(real, link);
      const read = await readDroppedPathRange(real, 0, 6);
      expect(Buffer.from(read.contentB64, "base64").toString()).toBe("secret");
      if (linked) {
        await expect(readDroppedPathRange(link, 0, 6)).rejects.toThrow("refusing a symlink");
      }
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
