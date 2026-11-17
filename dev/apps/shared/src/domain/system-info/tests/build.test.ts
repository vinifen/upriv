import { describe, expect, it } from "vitest";
import type { InfoTranslate } from "../../info";
import { createDefaultAppSettings } from "../../app-settings";
import { buildSystemInfoSections } from "../build";
import type { SystemInfoSnapshot } from "../types";

const t: InfoTranslate = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

const HERE = "a".repeat(32);

function snapshot(overrides: Partial<SystemInfoSnapshot> = {}): SystemInfoSnapshot {
  const settings = createDefaultAppSettings();
  return {
    app: { version: "0.1.0-beta", distribution: "dev", versionOffline: true },
    device: { id: HERE, system: "linux" },
    root: { status: "found", rootPath: "/data", source: "row" },
    dataFolders: {
      groups: {
        [HERE]: {
          system: "linux",
          selected: 1,
          next_number: 2,
          rows: [{ number: 1, name: "USB", path: "/data" }],
        },
      },
      defaultFolder: "/app",
      explicit: null,
    },
    inventory: { vaultsTotal: 3, vaultsOpen: 1, groupsTotal: 2 },
    ui: settings.ui,
    logging: settings.logging,
    unlockedFolders: {
      encrypted_vaults: true,
      devices: {
        [HERE]: {
          system: "linux",
          selected: "beside",
          next_number: 1,
          rows: [],
        },
      },
    },
    backups: settings.backups,
    lastOpenedVault: "notes",
    paths: { logsDir: "/data/.upriv/logs", logsOpenPath: "/data/.upriv/logs", appHome: "/app" },
    ...overrides,
  };
}

function fields(sections: ReturnType<typeof buildSystemInfoSections>) {
  return Object.fromEntries(
    sections.flatMap((section) => section.fields).map((field) => [field.id, field]),
  );
}

describe("buildSystemInfoSections", () => {
  it("names this device by its system and the start of its ID, and shows the whole hashed ID", () => {
    const known = buildSystemInfoSections(snapshot(), t).find(
      (section) => section.id === "this_device",
    );
    expect(known?.fields.map((field) => [field.id, field.value])).toEqual([
      ["device_name", 'device.name {"system":"device.system.linux","tag":"aaaaa"}'],
      ["device_system", "device.system.linux"],
      ["device_id", HERE],
    ]);
    const unknown = buildSystemInfoSections(
      snapshot({ device: { id: null, system: "android" } }),
      t,
    ).find((section) => section.id === "this_device");
    expect(unknown?.fields.map((field) => field.value)).toEqual([
      'device.name_unknown {"system":"device.system.android"}',
      "device.system.android",
      "modal.info.value.device_id.unknown",
    ]);
  });

  it("lists its sections in order", () => {
    expect(buildSystemInfoSections(snapshot(), t).map((section) => section.id)).toEqual([
      "app",
      "this_device",
      "data_folder",
      "inventory",
      "preferences",
      "logging",
      "folders",
      "paths",
    ]);
  });

  it("names the data folder in use and counts this device's rows", () => {
    const byId = fields(buildSystemInfoSections(snapshot(), t));
    expect(byId.data_folder_in_use.value).toBe("USB");
    expect(byId.root_path.openPath).toBe("/data");
    expect(byId.root_source.value).toBe("modal.info.value.root_source.row");
    expect(byId.rows_here.value).toBe(
      'modal.info.value.rows_here {"data":1,"unlocked":0,"backups":0}',
    );
  });

  it("says when the environment sets the data folder", () => {
    const byId = fields(
      buildSystemInfoSections(
        snapshot({ root: { status: "found", rootPath: "/env", source: "explicit" } }),
        t,
      ),
    );
    expect(byId.data_folder_in_use.value).toBe("modal.info.value.root_source.explicit");
  });

  it("names the unlocked and backup folders in use", () => {
    const byId = fields(buildSystemInfoSections(snapshot(), t));
    expect(byId.unlocked_folder_in_use.value).toBe("folder_list.choice.beside");
    expect(byId.encrypted_vaults_folder.value).toBe("modal.info.value.yes");
    expect(byId.backup_folder_in_use.value).toBe("folder_list.choice.data_folder");
  });

  it("leaves out the encrypted vaults switch and the WinFsp notice where they do not apply", () => {
    const phone = fields(
      buildSystemInfoSections(snapshot({ device: { id: HERE, system: "android" } }), t),
    );
    expect(phone.encrypted_vaults_folder).toBeUndefined();
    expect(phone.winfsp).toBeUndefined();
    const windows = fields(
      buildSystemInfoSections(snapshot({ device: { id: HERE, system: "windows" } }), t),
    );
    expect(windows.winfsp).toMatchObject({
      href: "https://github.com/winfsp/winfsp",
    });
  });

  it("shows Setup without a root path", () => {
    const byId = fields(
      buildSystemInfoSections(
        snapshot({
          root: {
            status: "needs_setup",
            defaultRootAnchor: "/app",
            distribution: "dev",
            ended: [],
          },
        }),
        t,
      ),
    );
    expect(byId.root_status.value).toBe("modal.info.value.root_status.needs_setup");
    expect(byId.root_path).toBeUndefined();
  });

  it("attaches open paths for absolute locations", () => {
    const byId = fields(buildSystemInfoSections(snapshot(), t));
    expect(byId.app_home.openPath).toBe("/app");
    expect(byId.logs_path.openPath).toBe("/data/.upriv/logs");
    expect(byId.version.openPath).toBeUndefined();
  });
});
