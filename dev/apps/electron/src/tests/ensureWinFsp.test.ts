import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  winfspDllName,
  winfspInstallSucceeded,
  winfspRuntimeDllPaths,
  winfspScriptCandidates,
} from "../ensureWinFsp";

describe("winfspDllName", () => {
  it("follows the process architecture", () => {
    expect(winfspDllName("x64")).toBe("winfsp-x64.dll");
    expect(winfspDllName("arm64")).toBe("winfsp-a64.dll");
    expect(winfspDllName("ia32")).toBe("winfsp-x86.dll");
    expect(winfspDllName("linux")).toBeNull();
  });
});

describe("winfspRuntimeDllPaths", () => {
  it("checks both Program Files directories for this architecture", () => {
    expect(
      winfspRuntimeDllPaths({
        arch: "x64",
        programFiles: "C:\\Program Files",
        programFilesX86: "C:\\Program Files (x86)",
      }),
    ).toEqual([
      "C:\\Program Files\\WinFsp\\bin\\winfsp-x64.dll",
      "C:\\Program Files (x86)\\WinFsp\\bin\\winfsp-x64.dll",
    ]);
  });
});

describe("winfspScriptCandidates", () => {
  it("looks in the packaged resources and then the dev tree", () => {
    expect(winfspScriptCandidates("C:\\Upriv\\resources", "C:\\src\\electron")).toEqual([
      path.join("C:\\Upriv\\resources", "winfsp", "install-winfsp.ps1"),
      path.join("C:\\src\\electron", "build", "winfsp", "install-winfsp.ps1"),
    ]);
  });
});

describe("winfspInstallSucceeded", () => {
  it("accepts msiexec success and reboot-required, and rejects a declined prompt", () => {
    expect(winfspInstallSucceeded(0)).toBe(true);
    expect(winfspInstallSucceeded(3010)).toBe(true);
    expect(winfspInstallSucceeded(1602)).toBe(false);
  });
});
