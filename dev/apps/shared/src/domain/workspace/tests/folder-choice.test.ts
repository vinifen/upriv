import { describe, expect, it } from "vitest";
import {
  appWorkspace,
  appWorkspaceForDaemon,
  appWorkspaceChoice,
  normalizeWorkspaceTable,
  validateWorkspaceTable,
  vaultFolderChosen,
  vaultFolderRow,
  vaultMountForDaemon,
  vaultWorkspace,
  workspaceTablesEqual,
  type WorkspaceTable,
} from "../index";

function withLinux(table: WorkspaceTable, place: "unset" | "beside" | "custom", path: string) {
  return { ...table, linux: { place, path } };
}

describe("a folder option chosen before its path", () => {
  it("stays the chosen app option and holds Save until the path is there", () => {
    const pending = withLinux(appWorkspace(), "custom", "");
    expect(appWorkspaceChoice(pending.linux)).toBe("custom");
    expect(validateWorkspaceTable(pending)).toBe("empty");

    const typing = withLinux(appWorkspace(), "custom", "  ");
    expect(validateWorkspaceTable(typing)).toBe("empty");

    const ready = withLinux(appWorkspace(), "custom", "/media/work");
    expect(validateWorkspaceTable(ready)).toBeNull();
  });

  it("counts as a change, so leaving asks before dropping it", () => {
    const saved = appWorkspace();
    expect(workspaceTablesEqual(withLinux(saved, "custom", ""), saved)).toBe(false);
    expect(workspaceTablesEqual(withLinux(saved, "unset", ""), saved)).toBe(true);
  });

  it("marks a vault row only while its path is empty", () => {
    expect(vaultFolderRow("")).toEqual({ place: "custom", path: "" });
    expect(vaultFolderRow("/media/notes")).toEqual({ place: "unset", path: "/media/notes" });
    expect(vaultFolderChosen(vaultFolderRow(""))).toBe(true);
    expect(vaultFolderChosen(vaultFolderRow("/media/notes"))).toBe(true);
    expect(vaultFolderChosen(vaultWorkspace().linux)).toBe(false);
  });

  it("reads a saved vault row back the same as the draft that wrote it", () => {
    const draft = { ...vaultWorkspace(), linux: vaultFolderRow("/media/notes ") };
    const saved = normalizeWorkspaceTable(vaultMountForDaemon(draft), "vault");
    expect(saved.linux).toEqual({ place: "unset", path: "/media/notes" });
    expect(workspaceTablesEqual(draft, saved)).toBe(true);
    expect(validateWorkspaceTable({ ...vaultWorkspace(), linux: vaultFolderRow("") })).toBe(
      "empty",
    );
  });

  it("sends the app place without the vault file-manager flags", () => {
    const draft = {
      ...withLinux(appWorkspace(), "beside", ""),
      app_file_manager_folder: "on" as const,
      custom_file_manager_folder: true,
    };
    const wire = appWorkspaceForDaemon(draft);
    expect(wire).not.toHaveProperty("app_file_manager_folder");
    expect(wire).not.toHaveProperty("custom_file_manager_folder");
    expect(wire.linux).toEqual({ place: "beside", path: "" });
    expect(wire.file_manager_folder).toBe(false);
    const readBack = normalizeWorkspaceTable(wire, "app");
    expect(appWorkspaceChoice(readBack.linux)).toBe("beside");
  });

  it("keeps a typed path whole until it is saved", () => {
    const draft = { ...vaultWorkspace(), linux: vaultFolderRow("/media/My ") };
    expect(draft.linux.path).toBe("/media/My ");
    expect(vaultMountForDaemon(draft).linux.path).toBe("/media/My");
  });
});
