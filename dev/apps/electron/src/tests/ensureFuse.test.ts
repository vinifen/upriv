import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fuseInstallPlan,
  fusePackageManager,
  fuseRuntimeReady,
  osReleaseIdentity,
  resolveSystemBinary,
  runFuseInstall,
} from "../ensureFuse";

describe("fuseRuntimeReady", () => {
  it("needs both the helper and a writable fuse device", () => {
    expect(fuseRuntimeReady({ fusermount3: true, fuseDeviceWritable: true })).toBe(true);
    expect(fuseRuntimeReady({ fusermount3: true, fuseDeviceWritable: false })).toBe(false);
    expect(fuseRuntimeReady({ fusermount3: false, fuseDeviceWritable: true })).toBe(false);
  });
});

describe("osReleaseIdentity", () => {
  it("reads ID and ID_LIKE", () => {
    expect(osReleaseIdentity('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n')).toEqual({
      id: "ubuntu",
      like: ["debian"],
    });
    expect(osReleaseIdentity('ID="opensuse-tumbleweed"\nID_LIKE="suse opensuse"\n')).toEqual({
      id: "opensuse-tumbleweed",
      like: ["suse", "opensuse"],
    });
  });
});

describe("fusePackageManager", () => {
  it("maps the families that ship fuse3", () => {
    expect(fusePackageManager("ubuntu", ["debian"])).toBe("apt");
    expect(fusePackageManager("linuxmint", ["ubuntu"])).toBe("apt");
    expect(fusePackageManager("pop", ["ubuntu", "debian"])).toBe("apt");
    expect(fusePackageManager("fedora", [])).toBe("dnf");
    expect(fusePackageManager("nobara", ["fedora"])).toBe("dnf");
    expect(fusePackageManager("arch", [])).toBe("pacman");
    expect(fusePackageManager("steamos", ["arch"])).toBe("pacman");
    expect(fusePackageManager("opensuse-tumbleweed", ["suse", "opensuse"])).toBe("zypper");
    expect(fusePackageManager("alpine", [])).toBe("apk");
    expect(fusePackageManager("nixos", [])).toBeNull();
  });
});

describe("fuseInstallPlan", () => {
  const present = new Set(["/usr/bin/pkexec", "/usr/bin/apt-get", "/usr/bin/dnf"]);

  it("asks pkexec to install only fuse3", () => {
    const plan = fuseInstallPlan({
      osRelease: "ID=ubuntu\nID_LIKE=debian\n",
      canExecute: (candidate) => present.has(candidate),
    });
    expect(plan).toEqual({
      pkexec: "/usr/bin/pkexec",
      args: ["/usr/bin/apt-get", "install", "-y", "fuse3"],
    });
  });

  it("uses dnf on Fedora", () => {
    const plan = fuseInstallPlan({
      osRelease: "ID=fedora\n",
      canExecute: (candidate) => present.has(candidate),
    });
    expect(plan?.args).toEqual(["/usr/bin/dnf", "install", "-y", "fuse3"]);
  });

  it("does nothing for an unknown distro or a missing pkexec", () => {
    expect(
      fuseInstallPlan({
        osRelease: "ID=nixos\n",
        canExecute: (candidate) => present.has(candidate),
      }),
    ).toBeNull();
    expect(
      fuseInstallPlan({
        osRelease: "ID=ubuntu\nID_LIKE=debian\n",
        canExecute: () => false,
      }),
    ).toBeNull();
  });
});

describe("resolveSystemBinary", () => {
  it("ignores names that are paths", () => {
    expect(resolveSystemBinary("../apt-get", () => true)).toBeNull();
    expect(resolveSystemBinary("apt-get", (candidate) => candidate === "/usr/bin/apt-get")).toBe(
      "/usr/bin/apt-get",
    );
  });
});

describe("runFuseInstall", () => {
  it("does not run a relative command", async () => {
    await expect(runFuseInstall({ pkexec: "pkexec", args: ["apt-get"] })).resolves.toBe(1);
  });

  it("runs the absolute argv without a shell", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "upriv-fuse-install-"));
    const bin = path.join(root, "pkexec");
    const log = path.join(root, "args");
    fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(log)}\n`, {
      mode: 0o755,
    });
    const code = await runFuseInstall({
      pkexec: bin,
      args: ["/usr/bin/apt-get", "install", "-y", "fuse3"],
    });
    expect(code).toBe(0);
    expect(fs.readFileSync(log, "utf8")).toBe("/usr/bin/apt-get\ninstall\n-y\nfuse3\n");
  });
});
