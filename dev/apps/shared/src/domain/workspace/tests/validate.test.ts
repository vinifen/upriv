import { describe, expect, it } from "vitest";
import {
  appWorkspace,
  currentWorkspaceSystem,
  hostPlatformFromSignals,
  appWorkspacePlace,
  encryptedShortcutActive,
  resolvedWorkspaceParent,
  isAbsoluteFilesystemPath,
  isAbsoluteOsFilesystemPath,
  isReservedUprivWorkspacePath,
  normalizeWorkspaceTable,
  resolveVaultMountPoint,
  suggestedDefaultWorkspacePath,
  workspaceContainerPath,
  validateWorkspaceGlobalPath,
  vaultWorkspace,
  workspaceSystemsCurrentFirst,
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
    expect(validateWorkspaceGlobalPath("/data/.upriv/logs")).toBe("reserved");
    expect(validateWorkspaceGlobalPath("/tmp/foo/.upriv/workspace")).toBe("reserved");
    expect(validateWorkspaceGlobalPath("/tmp/foo/.upriv")).toBe("reserved");
    expect(
      isReservedUprivWorkspacePath("content://com.android/tree/primary%3AUpriv%2F.upriv", null),
    ).toBe(true);
    expect(isReservedUprivWorkspacePath("content://com.android/tree/primary%3A.upriv", null)).toBe(
      true,
    );
    expect(
      isReservedUprivWorkspacePath("content://com.android/tree/primary%253A%252Eupriv", null),
    ).toBe(true);
    expect(isReservedUprivWorkspacePath("content://com.android/tree/primary%3AUpriv", null)).toBe(
      false,
    );
  });

  it("reads the system from a browser user agent when Node process is absent", () => {
    expect(hostPlatformFromSignals({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("linux");
    expect(hostPlatformFromSignals({ userAgentDataPlatform: "Windows" })).toBe("win32");
    expect(hostPlatformFromSignals({ platform: "MacIntel" })).toBe("darwin");
    expect(
      hostPlatformFromSignals({
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36",
      }),
    ).toBe("android");
    expect(hostPlatformFromSignals({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" })).toBe(
      "ios",
    );
    expect(currentWorkspaceSystem("android")).toBe("android");
    expect(workspaceSystemsCurrentFirst("linux")[0]).toBe("linux");
    expect(workspaceSystemsCurrentFirst("android")).toEqual([
      "android",
      "linux",
      "windows",
      "macos",
      "ios",
    ]);
    expect(hostPlatformFromSignals({})).toBeUndefined();
  });

  it("reads only the per-system rows", () => {
    const ignored = normalizeWorkspaceTable({ path: "/home/me/workspace" }, "app");
    expect(ignored.linux.path).toBe("");
    expect(ignored.linux.place).toBe("unset");
    const kept = normalizeWorkspaceTable(
      { path: "/other", linux: { place: "custom", path: "/already" } },
      "app",
    );
    expect(kept.linux.path).toBe("/already");
  });

  it("inherits the app path and shows the folder when the app file_manager_folder is on", () => {
    const app = {
      ...appWorkspace(),
      file_manager_folder: true,
      linux: { place: "custom" as const, path: "/app" },
    };
    const vault = vaultWorkspace();
    expect(resolvedWorkspaceParent(app, vault, "linux", "/data/root")).toBe("/app");
    expect(encryptedShortcutActive(app, vault, "linux")).toBe(true);
    expect(encryptedShortcutActive(app, vault, "windows")).toBe(false);
    const forcedOn = { ...vault, app_file_manager_folder: "on" as const };
    const appOff = { ...app, file_manager_folder: false };
    expect(encryptedShortcutActive(appOff, forcedOn, "linux")).toBe(true);
    const forcedOff = { ...vault, app_file_manager_folder: "off" as const };
    expect(encryptedShortcutActive(app, forcedOff, "linux")).toBe(false);
    const override = {
      ...vault,
      custom_file_manager_folder: true,
      linux: { place: "unset" as const, path: "/vault" },
    };
    expect(resolvedWorkspaceParent(app, override, "linux", "/data/root")).toBe("/vault");
    expect(
      encryptedShortcutActive(app, { ...override, custom_file_manager_folder: false }, "linux"),
    ).toBe(false);
    expect(encryptedShortcutActive(app, vault, "android")).toBe(false);
    const beside = {
      ...appWorkspace(),
      file_manager_folder: true,
      linux: { place: "beside" as const, path: "" },
    };
    expect(encryptedShortcutActive(beside, vaultWorkspace(), "linux")).toBe(true);
    expect(resolvedWorkspaceParent(beside, vaultWorkspace(), "linux", "/data/root")).toBe(
      "/data/root",
    );
    const unset = {
      ...appWorkspace(),
      file_manager_folder: true,
      linux: { place: "unset" as const, path: "" },
    };
    expect(encryptedShortcutActive(unset, vaultWorkspace(), "linux")).toBe(false);
    expect(unset.file_manager_folder).toBe(true);
    expect(resolvedWorkspaceParent(unset, vaultWorkspace(), "linux", "/data/root")).toBe("");
    expect(resolvedWorkspaceParent(app, vaultWorkspace(), "linux", "/data/root")).toBe("/app");
    expect(
      resolveVaultMountPoint(
        resolvedWorkspaceParent(beside, vault, "linux", "/data/root"),
        "Notes",
      ),
    ).toBe("/data/root/workspace/Notes");
    const readBeside = normalizeWorkspaceTable(
      { file_manager_folder: true, linux: { place: "beside", path: "/stale" } },
      "app",
    );
    expect(appWorkspacePlace(readBeside.linux)).toBe("beside");
    expect(readBeside.linux.path).toBe("");
    expect(readBeside.file_manager_folder).toBe(true);
    const readExplicitUnset = normalizeWorkspaceTable(
      { file_manager_folder: true, linux: { place: "unset", path: "/stale" } },
      "app",
    );
    expect(appWorkspacePlace(readExplicitUnset.linux)).toBe("unset");
    expect(readExplicitUnset.linux.path).toBe("");
    expect(readExplicitUnset.file_manager_folder).toBe(true);
    const readUnset = normalizeWorkspaceTable({ linux: { path: "" } }, "app");
    expect(appWorkspacePlace(readUnset.linux)).toBe("unset");
    expect(readUnset.file_manager_folder).toBe(false);
    const vaultShortcut = normalizeWorkspaceTable({ app_file_manager_folder: "inherit" }, "vault");
    expect(vaultShortcut.app_file_manager_folder).toBe("inherit");
    expect(vaultShortcut.file_manager_folder).toBe(false);
    const vaultOff = normalizeWorkspaceTable(
      { app_file_manager_folder: "off", linux: { path: "", app_file_manager_folder: "on" } },
      "vault",
    );
    expect(vaultOff.app_file_manager_folder).toBe("off");
    const both = normalizeWorkspaceTable(
      {
        app_file_manager_folder: "inherit",
        custom_file_manager_folder: true,
        linux: { path: "/vault" },
      },
      "vault",
    );
    expect(both.app_file_manager_folder).toBe("inherit");
    expect(both.custom_file_manager_folder).toBe(true);
    expect(both.linux.path).toBe("/vault");
    expect(encryptedShortcutActive(app, both, "linux")).toBe(true);
    expect(workspaceContainerPath("/data/chosen")).toBe("/data/chosen/workspace");
    expect(workspaceContainerPath("content://tree")).toBe("content://tree");
    expect(resolveVaultMountPoint("/global", "Notes")).toBe("/global/workspace/Notes");
    expect(resolveVaultMountPoint("/home/me/Documents", "test", true)).toBe(
      "/home/me/Documents/test",
    );
    const tree = "content://com.android.externalstorage.documents/tree/primary%3AUpriv";
    expect(resolveVaultMountPoint(tree, "Notes")).toBe(
      "content://com.android.externalstorage.documents/tree/primary%3AUpriv/document/primary%3AUpriv%2Fworkspace%2FNotes",
    );
    expect(resolveVaultMountPoint(tree, "Notes", true)).toBe(
      "content://com.android.externalstorage.documents/tree/primary%3AUpriv/document/primary%3AUpriv%2FNotes",
    );
    expect(resolveVaultMountPoint("content://not-a-tree", "Notes")).toBeNull();
    expect(resolveVaultMountPoint("", "Notes")).toBeNull();
  });

  it("suggests default beside vault-root", () => {
    expect(suggestedDefaultWorkspacePath("/data/upriv-root")).toBe("/data/upriv-root/workspace");
    expect(suggestedDefaultWorkspacePath("")).toBe("");
    const tree = "content://com.android.externalstorage.documents/tree/primary%3AUpriv";
    const beside = suggestedDefaultWorkspacePath(tree);
    expect(beside).toBe(
      "content://com.android.externalstorage.documents/tree/primary%3AUpriv/document/primary%3AUpriv%2Fworkspace",
    );
    expect(validateWorkspaceGlobalPath(beside, tree)).toBeNull();
    expect(suggestedDefaultWorkspacePath(`${tree}/document/primary%3AUpriv`)).toBe(beside);
    const documents = "content://com.android.externalstorage.documents/tree/primary%3ADocuments";
    expect(suggestedDefaultWorkspacePath(documents)).toBe(
      "content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments%2FUpriv%2Fworkspace",
    );
    expect(
      validateWorkspaceGlobalPath(suggestedDefaultWorkspacePath(documents), documents),
    ).toBeNull();
    expect(
      suggestedDefaultWorkspacePath("content://com.android.externalstorage.documents/document/1"),
    ).toBe("");
  });

  it("accepts Android SAF content:// paths (vault-root pattern)", () => {
    expect(
      validateWorkspaceGlobalPath(
        "content://com.android.externalstorage.documents/tree/primary%3AUpriv",
      ),
    ).toBeNull();
    expect(
      validateWorkspaceGlobalPath(
        "content://com.android.externalstorage.documents/tree/primary%3ADocs",
      ),
    ).toBeNull();
    expect(
      validateWorkspaceGlobalPath(
        "content://com.android.externalstorage.documents/tree/primary%3AUpriv/workspace",
      ),
    ).toBe("saf_tree_child");
    expect(
      validateWorkspaceGlobalPath(
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
    expect(resolveVaultMountPoint("/g", "Notes")).toBe("/g/workspace/Notes");
    expect(resolveVaultMountPoint("/g", "..")).toBe("/g/workspace/_");
    expect(resolveVaultMountPoint("/g", "a/b")).toBe("/g/workspace/_");
  });
});
