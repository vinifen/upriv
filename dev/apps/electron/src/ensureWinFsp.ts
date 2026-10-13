import { execFile } from "node:child_process";
import path from "node:path";

/** msiexec: success, reboot required. */
const WINFSP_SUCCESS_CODES = new Set([0, 3010]);

const DLL_BY_ARCH: Record<string, string> = {
  x64: "winfsp-x64.dll",
  arm64: "winfsp-a64.dll",
  ia32: "winfsp-x86.dll",
};

export function winfspDllName(arch: string): string | null {
  return DLL_BY_ARCH[arch] ?? null;
}

/** Install directories the daemon also searches, for this process architecture. */
export function winfspRuntimeDllPaths(input: {
  arch: string;
  programFiles?: string;
  programFilesX86?: string;
}): string[] {
  const dll = winfspDllName(input.arch);
  if (!dll) return [];
  const roots = [input.programFiles, input.programFilesX86]
    .map((root) => root?.trim() ?? "")
    .filter((root) => root.length > 0);
  return [...new Set(roots)].map((root) => path.win32.join(root, "WinFsp", "bin", dll));
}

export function bundledWinFspScript(resourcesPath: string): string {
  return path.join(resourcesPath, "winfsp", "install-winfsp.ps1");
}

/** Packaged `resources/winfsp`, then the dev tree beside the Electron app. */
export function winfspScriptCandidates(resourcesPath: string, appPath: string): string[] {
  return [
    bundledWinFspScript(resourcesPath),
    path.join(appPath, "build", "winfsp", "install-winfsp.ps1"),
  ];
}

export function winfspInstallSucceeded(code: number): boolean {
  return WINFSP_SUCCESS_CODES.has(code);
}

export function runBundledWinFspInstaller(script: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true },
      (error) => {
        if (!error) {
          resolve(0);
          return;
        }
        const code = "code" in error && typeof error.code === "number" ? error.code : 1;
        resolve(code);
      },
    );
  });
}
