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
    device: { id: HERE, system: "linux", os: "Ubuntu 24.04.5 LTS" },
    osNames: { [HERE]: "Ubuntu 24.04.5 LTS" },
    root: { status: "found", rootPath: "/data", source: "row" },
    dataFolders: {
      osNames: {},
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
    dataFolderBytes: 3 * 1024 * 1024 * 1024,
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
    ...overrides,
  };
}

function fields(sections: ReturnType<typeof buildSystemInfoSections>) {
  return Object.fromEntries(
    sections.flatMap((section) => section.fields).map((field) => [field.id, field]),
  );
}

describe("buildSystemInfoSections", () => {
  it("names this device by what it runs and the start of its ID, and shows the whole hashed ID", () => {
    const known = buildSystemInfoSections(snapshot(), t).find(
      (section) => section.id === "this_device",
    );
    expect(known?.fields.map((field) => [field.id, field.value])).toEqual([
      [
        "device_name",
        t("device.name", {
          device: t("device.os_and_system", {
            os: "Ubuntu 24.04.5 LTS",
            system: "device.system.linux",
          }),
          tag: "aaaaa",
        }),
      ],
      ["device_system", "device.system.linux"],
      ["device_os", "Ubuntu 24.04.5 LTS"],
      ["device_id", HERE],
    ]);
    const unknown = buildSystemInfoSections(
      snapshot({ device: { id: null, system: "android", os: null } }),
      t,
    ).find((section) => section.id === "this_device");
    expect(unknown?.fields.map((field) => field.value)).toEqual([
      'device.name_unknown {"device":"device.system.android"}',
      "device.system.android",
      "modal.info.value.device_os.none",
      "modal.info.value.device_id.unknown",
    ]);
  });

  it("keeps the name this device wrote before through a run that could not read its OS", () => {
    const fieldsById = fields(
      buildSystemInfoSections(snapshot({ device: { id: HERE, system: "linux", os: null } }), t),
    );
    expect(fieldsById.device_name.value).toContain("Ubuntu 24.04.5 LTS");
    expect(fieldsById.device_os.value).toBe("modal.info.value.device_os.none");
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
      buildSystemInfoSections(snapshot({ device: { id: HERE, system: "android", os: null } }), t),
    );
    expect(phone.encrypted_vaults_folder).toBeUndefined();
    expect(phone.winfsp).toBeUndefined();
    const windows = fields(
      buildSystemInfoSections(snapshot({ device: { id: HERE, system: "windows", os: null } }), t),
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
    expect(byId.logs_path.value).toBe("/data/.upriv/logs");
    expect(byId.logs_path.openPath).toBe("/data/.upriv/logs");
    expect(byId.version.openPath).toBeUndefined();
  });

  it("shows each part core has not answered yet as loading, and the rest at once", () => {
    const byId = fields(
      buildSystemInfoSections(
        snapshot({ app: null, device: null, root: null, dataFolders: null }),
        t,
      ),
    );
    for (const id of [
      "version",
      "device_name",
      "data_folder_in_use",
      "root_status",
      "rows_here",
      "unlocked_folder_in_use",
      "app_home",
      "logs_path",
    ]) {
      expect(byId[id].loading).toBe(true);
    }
    expect(byId.vaults_total.loading).toBeUndefined();
    expect(byId.vaults_total.value).toBe("3");
    expect(byId.winfsp).toBeUndefined();
  });

  it("fills the version as soon as it lands, before the data folder answers", () => {
    const byId = fields(buildSystemInfoSections(snapshot({ root: null, dataFolders: null }), t));
    expect(byId.version.value).toBe("0.1.0-beta");
    expect(byId.version.loading).toBeUndefined();
    expect(byId.root_status.loading).toBe(true);
  });

  it("shows the size of the data folder in use, loading on its own while it is measured", () => {
    const sized = fields(buildSystemInfoSections(snapshot(), t));
    expect(sized.data_folder_size.value).toBe("3.00 GB");

    const measuring = fields(
      buildSystemInfoSections(snapshot({ dataFolderBytes: "measuring" }), t),
    );
    expect(measuring.data_folder_size.loading).toBe(true);
    expect(measuring.root_path.loading).toBeUndefined();
    expect(measuring.rows_here.loading).toBeUndefined();

    const failed = fields(buildSystemInfoSections(snapshot({ dataFolderBytes: null }), t));
    expect(failed.data_folder_size.value).toBe("—");
  });

  it("measures no data folder before Setup made one", () => {
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
    expect(byId.data_folder_size).toBeUndefined();
  });
});
