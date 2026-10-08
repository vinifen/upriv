import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packagedVaultHome, relocateInstallDirVault } from "../installVaultHome";

describe("packagedVaultHome", () => {
  it("keeps a portable exe and an AppImage beside the program", () => {
    expect(
      packagedVaultHome({
        platform: "win32",
        portableExecutableDir: "D:\\Upriv",
      }),
    ).toBe("portable");
    expect(packagedVaultHome({ platform: "linux", appImageFile: true })).toBe("portable");
  });

  it("uses user data for an installer, including a writable install folder", () => {
    expect(packagedVaultHome({ platform: "win32" })).toBe("installed");
    expect(packagedVaultHome({ platform: "linux", appImageFile: false })).toBe("installed");
    expect(packagedVaultHome({ platform: "darwin" })).toBe("installed");
  });
});

describe("relocateInstallDirVault", () => {
  it("moves .upriv and the alias into user data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "upriv-relocate-"));
    const install = path.join(root, "Programs", "Upriv");
    const userData = path.join(root, "Local", "Upriv");
    fs.mkdirSync(path.join(install, ".upriv", "vaults"), { recursive: true });
    fs.writeFileSync(path.join(install, ".upriv", "settings.toml"), "ok\n");
    fs.writeFileSync(path.join(install, ".upriv-root"), "status=active\n");

    const result = relocateInstallDirVault(install, userData);

    expect(result).toEqual({ anchor: userData, notice: null, noticePath: null });
    expect(fs.existsSync(path.join(install, ".upriv"))).toBe(false);
    expect(fs.readFileSync(path.join(userData, ".upriv", "settings.toml"), "utf8")).toBe("ok\n");
    expect(fs.readFileSync(path.join(userData, ".upriv-root"), "utf8")).toBe("status=active\n");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps both trees when user data already has .upriv", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "upriv-relocate-"));
    const install = path.join(root, "install");
    const userData = path.join(root, "user");
    fs.mkdirSync(path.join(install, ".upriv"), { recursive: true });
    fs.writeFileSync(path.join(install, ".upriv", "settings.toml"), "install\n");
    fs.mkdirSync(path.join(userData, ".upriv"), { recursive: true });
    fs.writeFileSync(path.join(userData, ".upriv", "settings.toml"), "user\n");

    const result = relocateInstallDirVault(install, userData);

    expect(result.anchor).toBe(path.resolve(userData));
    expect(result.notice).toBe("left_behind");
    expect(fs.readFileSync(path.join(install, ".upriv", "settings.toml"), "utf8")).toBe(
      "install\n",
    );
    expect(fs.readFileSync(path.join(userData, ".upriv", "settings.toml"), "utf8")).toBe("user\n");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does nothing when the install directory has no data folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "upriv-relocate-"));
    const install = path.join(root, "install");
    const userData = path.join(root, "user");
    fs.mkdirSync(install, { recursive: true });
    const result = relocateInstallDirVault(install, userData);
    expect(result).toEqual({
      anchor: path.resolve(userData),
      notice: null,
      noticePath: null,
    });
    expect(fs.existsSync(path.join(userData, ".upriv"))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps the install folder when the data folder contains a symlink", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "upriv-relocate-"));
    const install = path.join(root, "install");
    const userData = path.join(root, "user");
    fs.mkdirSync(path.join(install, ".upriv"), { recursive: true });
    fs.writeFileSync(path.join(install, ".upriv", "settings.toml"), "ok\n");
    fs.symlinkSync("settings.toml", path.join(install, ".upriv", "link"));

    const result = relocateInstallDirVault(install, userData);

    expect(result.notice).toBe("move_failed");
    expect(result.anchor).toBe(path.resolve(install));
    expect(fs.readFileSync(path.join(install, ".upriv", "settings.toml"), "utf8")).toBe("ok\n");
    expect(fs.existsSync(path.join(userData, ".upriv"))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
