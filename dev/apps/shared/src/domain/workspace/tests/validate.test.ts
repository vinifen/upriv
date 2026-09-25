import { describe, expect, it } from "vitest";
import {
  WORKSPACE_PATH_DEFAULT,
  isAbsoluteFilesystemPath,
  isAbsoluteOsFilesystemPath,
  isReservedUprivWorkspacePath,
  needsWorkspaceSetupOnOpen,
  normalizeMountWorkspacePath,
  resolveMountParentPath,
  resolveVaultMountPoint,
  suggestedDefaultWorkspacePath,
  validateMountWorkspacePath,
  validateWorkspaceGlobalPath,
} from "../index";

describe("workspace path validation", () => {
  it("allows empty global path", () => {
    expect(validateWorkspaceGlobalPath("")).toBeNull();
    expect(validateWorkspaceGlobalPath("  ")).toBeNull();
  });

  it("rejects relative global paths", () => {
    expect(validateWorkspaceGlobalPath("workspace")).toBe("not_absolute");
    expect(validateWorkspaceGlobalPath("./workspace")).toBe("not_absolute");
  });

  it("accepts absolute global paths", () => {
    expect(validateWorkspaceGlobalPath("/home/u/Documents/Upriv")).toBeNull();
    expect(validateWorkspaceGlobalPath("C:\\Users\\u\\Upriv")).toBeNull();
  });

  it("treats SAF URIs as absolute for workspace, not for OS file import", () => {
    const uri = "content://com.android.externalstorage.documents/tree/primary";
    expect(isAbsoluteFilesystemPath(uri)).toBe(true);
    expect(isAbsoluteOsFilesystemPath(uri)).toBe(false);
    expect(isAbsoluteOsFilesystemPath("/tmp/Notes.zip")).toBe(true);
    expect(isAbsoluteOsFilesystemPath("Notes.zip")).toBe(false);
  });

  it("blocks reserved .upriv children", () => {
    const root = "/data/upriv-root";
    expect(isReservedUprivWorkspacePath(`${root}/.upriv/vaults`, root)).toBe(true);
    expect(isReservedUprivWorkspacePath(`${root}/.upriv/vaults/x`, root)).toBe(true);
    expect(isReservedUprivWorkspacePath(`${root}/.upriv/logs`, root)).toBe(true);
    expect(isReservedUprivWorkspacePath(`${root}/.upriv/app`, root)).toBe(true);
    expect(isReservedUprivWorkspacePath(`${root}/.upriv/runtime`, root)).toBe(true);
    expect(isReservedUprivWorkspacePath(`${root}/.upriv/workspace`, root)).toBe(true);
    expect(isReservedUprivWorkspacePath(`${root}/.upriv`, root)).toBe(true);
    expect(isReservedUprivWorkspacePath(`${root}/workspace`, root)).toBe(false);
    expect(validateWorkspaceGlobalPath(`${root}/.upriv/vaults`, root)).toBe("reserved");
    expect(validateWorkspaceGlobalPath(`${root}/.upriv`, root)).toBe("reserved");
  });

  it("blocks reserved .upriv tree without vault-root (default_root / SAF parity)", () => {
    expect(validateWorkspaceGlobalPath("/tmp/foo/.upriv/vaults/x")).toBe("reserved");
    expect(validateWorkspaceGlobalPath("/tmp/foo/.UPRIV/Vaults")).toBe("reserved");
    expect(validateMountWorkspacePath("/data/.upriv/logs")).toBe("reserved");
    expect(validateWorkspaceGlobalPath("/tmp/foo/.upriv/workspace")).toBe("reserved");
    expect(validateWorkspaceGlobalPath("/tmp/foo/.upriv")).toBe("reserved");
  });

  it("normalizes mount path default", () => {
    expect(normalizeMountWorkspacePath("")).toBe(WORKSPACE_PATH_DEFAULT);
    expect(normalizeMountWorkspacePath("DEFAULT")).toBe(WORKSPACE_PATH_DEFAULT);
    expect(normalizeMountWorkspacePath("/tmp/open")).toBe("/tmp/open");
  });

  it("validates mount override", () => {
    expect(validateMountWorkspacePath("default")).toBeNull();
    expect(validateMountWorkspacePath("rel")).toBe("not_absolute");
    expect(validateMountWorkspacePath("/ok")).toBeNull();
  });

  it("resolves mount parent and point", () => {
    expect(resolveMountParentPath("", "default")).toBeNull();
    expect(resolveMountParentPath("/global", "default")).toBe("/global");
    expect(resolveMountParentPath("/global", "/override")).toBe("/override");
    expect(resolveVaultMountPoint("/global", "default", "Notes")).toBe("/global/Notes");
  });

  it("suggests default beside vault-root", () => {
    expect(suggestedDefaultWorkspacePath("/data/upriv-root")).toBe("/data/upriv-root/workspace");
    expect(suggestedDefaultWorkspacePath("")).toBe("");
    expect(
      suggestedDefaultWorkspacePath(
        "content://com.android.externalstorage.documents/tree/primary%3AUpriv",
      ),
    ).toBe("");
  });

  it("needs setup on open only when mount is default and global unset", () => {
    expect(needsWorkspaceSetupOnOpen("", "default")).toBe(true);
    expect(needsWorkspaceSetupOnOpen(null, "default")).toBe(true);
    expect(needsWorkspaceSetupOnOpen("/global", "default")).toBe(false);
    expect(needsWorkspaceSetupOnOpen("", "/override")).toBe(false);
  });

  it("accepts Android SAF content:// paths (vault-root pattern)", () => {
    expect(
      validateWorkspaceGlobalPath(
        "content://com.android.externalstorage.documents/tree/primary%3AUpriv",
      ),
    ).toBeNull();
    expect(
      validateMountWorkspacePath(
        "content://com.android.externalstorage.documents/tree/primary%3ADocs",
      ),
    ).toBeNull();
    expect(
      validateWorkspaceGlobalPath(
        "content://com.android.externalstorage.documents/tree/primary%3AUpriv/workspace",
      ),
    ).toBe("saf_tree_child");
    expect(
      validateMountWorkspacePath(
        "content://com.android.externalstorage.documents/tree/primary%3ADocs/workspace",
      ),
    ).toBe("saf_tree_child");
    expect(
      validateWorkspaceGlobalPath(
        "content://com.android.externalstorage.documents/tree/primary%3AUpriv/document/primary%3AUpriv%2Fworkspace",
      ),
    ).toBeNull();
  });

  it("sanitizes mount leaf like Rust", () => {
    expect(resolveVaultMountPoint("/g", "default", "Notes")).toBe("/g/Notes");
    expect(resolveVaultMountPoint("/g", "default", "..")).toBe("/g/_");
    expect(resolveVaultMountPoint("/g", "default", "a/b")).toBe("/g/_");
  });
});
