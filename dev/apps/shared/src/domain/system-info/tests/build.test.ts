import { describe, expect, it } from "vitest";
import type { InfoTranslate } from "../../info";
import { createDefaultAppSettings } from "../../app-settings";
import { appWorkspace } from "../../workspace";
import { buildSystemInfoSections } from "../build";
import type { SystemInfoSnapshot } from "../types";

const t: InfoTranslate = (key) => key;

function snapshot(overrides: Partial<SystemInfoSnapshot> = {}): SystemInfoSnapshot {
  const settings = createDefaultAppSettings();
  return {
    app: { version: "0.1.0-beta", distribution: "dev", versionOffline: true },
    root: { status: "found", rootPath: "/data", source: "default_root" },
    rootMode: "default_root",
    inventory: { vaultsTotal: 3, vaultsOpen: 1, groupsTotal: 2 },
    ui: settings.ui,
    logging: settings.logging,
    workspace: {
      ...appWorkspace(),
      linux: { place: "custom", path: "/data/chosen" },
    },
    workspaceSystem: "linux",
    lastOpenedVault: "notes",
    paths: { logsDir: "/data/.upriv/logs", appHome: "/data" },
    ...overrides,
  };
}

function fieldIds(sections: ReturnType<typeof buildSystemInfoSections>): string[] {
  return sections.flatMap((section) => section.fields.map((field) => field.id));
}

describe("buildSystemInfoSections", () => {
  it("always includes app, inventory, preferences, logging, workspace, and paths", () => {
    const sections = buildSystemInfoSections(snapshot(), t);
    expect(sections.map((section) => section.id)).toEqual([
      "app",
      "data_folder",
      "inventory",
      "preferences",
      "logging",
      "workspace",
      "paths",
    ]);
    expect(fieldIds(sections)).toEqual(
      expect.arrayContaining([
        "version",
        "root_status",
        "root_path",
        "vaults_total",
        "vaults_open",
        "groups_total",
        "locale",
        "theme",
        "search_query",
        "logging_enabled",
        "last_opened_vault",
        "always_show_hidden_vaults",
        "lifecycle_close_modal_on_submit",
        "lifecycle_open_file_manager_on_open",
        "file_manager_confirm_delete",
        "file_manager_dock_expanded",
        "file_manager_tree_split_percent",
        "app_home",
        "logs_path",
      ]),
    );
  });

  it("shows needs-setup fields instead of root_path", () => {
    const sections = buildSystemInfoSections(
      snapshot({
        root: {
          status: "needs_setup",
          aliasPath: "/home/.upriv-root",
          defaultRootAnchor: "/home",
          distribution: "dev",
        },
      }),
      t,
    );
    const ids = fieldIds(sections);
    expect(ids).toContain("alias_path");
    expect(ids).toContain("default_root_anchor");
    expect(ids).not.toContain("root_path");
    const anchor = sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "default_root_anchor");
    expect(anchor?.openPath).toBe("/home");
    const alias = sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "alias_path");
    expect(alias?.openPath).toBe("/home/.upriv-root");
  });

  it("omits the mount switch on a phone row", () => {
    const sections = buildSystemInfoSections(snapshot({ workspaceSystem: "android" }), t);
    expect(fieldIds(sections)).not.toContain("workspace_mount");
    expect(fieldIds(sections)).toContain("workspace_global_path");
  });

  it("renders empty search and workspace as a dash", () => {
    const settings = createDefaultAppSettings();
    const sections = buildSystemInfoSections(
      snapshot({ ui: { ...settings.ui, vault_list_search: "" }, workspace: appWorkspace() }),
      t,
    );
    const search = sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "search_query");
    expect(search?.value).toBe("—");
    const workspace = sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "workspace_global_path");
    expect(workspace?.value).toBe("—");
    expect(workspace?.openPath).toBeUndefined();
  });

  it("attaches open paths for absolute locations", () => {
    const sections = buildSystemInfoSections(snapshot(), t);
    const byId = Object.fromEntries(
      sections.flatMap((section) => section.fields).map((field) => [field.id, field.openPath]),
    );
    expect(byId.root_path).toBe("/data");
    expect(byId.workspace_global_path).toBe("/data/chosen/workspace");
    expect(byId.app_home).toBe("/data");
    expect(byId.logs_path).toBe("/data/.upriv/logs");
    expect(byId.version).toBeUndefined();
  });
});
