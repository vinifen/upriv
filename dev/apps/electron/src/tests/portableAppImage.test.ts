import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  PORTABLE_LAUNCHER_MARK,
  wrapAppImageFile,
  wrapPortableAppImage,
} from "../portableAppImage";

describe("wrapPortableAppImage", () => {
  it("keeps the payload after the launcher and does not wrap twice", () => {
    const payload = Buffer.from("not-an-elf-but-the-bytes-we-keep\n$(echo HACKED)\n");
    const wrapped = wrapPortableAppImage(payload);
    expect(wrapped.subarray(0, PORTABLE_LAUNCHER_MARK.length)).toEqual(PORTABLE_LAUNCHER_MARK);
    expect(wrapped.subarray(wrapped.length - payload.length)).toEqual(payload);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "upriv-portable-"));
    const file = path.join(root, "Upriv.AppImage");
    const cache = path.join(root, "cache");
    fs.writeFileSync(file, wrapped, { mode: 0o755 });
    const ran = spawnSync(file, [], {
      env: { ...process.env, UPRIV_PORTABLE_TEST_ECHO: "1", XDG_CACHE_HOME: cache },
      encoding: "utf8",
    });
    expect(ran.status).toBe(0);
    expect(ran.stdout).not.toContain("HACKED");
    const [portableFile, extracted] = ran.stdout.trim().split("\n");
    expect(portableFile).toBe(file);
    expect(fs.readFileSync(extracted)).toEqual(payload);

    wrapAppImageFile(file);
    expect(fs.readFileSync(file)).toEqual(wrapped);
  });
});
