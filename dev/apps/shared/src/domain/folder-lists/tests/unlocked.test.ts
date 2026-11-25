import { describe, expect, it } from "vitest";
import {
  APP_UNLOCKED_LIST,
  appUnlockedFixedFolders,
  besideFolder,
  dataFolderBackupsFolder,
  encryptedFolderOn,
  encryptedFolderUnchosen,
  listDraftBlocks,
  NOTHING_SELECTED,
  selectionFolder,
  type AppUnlockedChoice,
  type AppUnlockedFolders,
  type DeviceGroups,
  type HereDevice,
  type VaultUnlockedFolder,
} from "..";

const HERE = "a".repeat(32);
const DESK: HereDevice = { id: HERE, system: "linux" };

function app(encrypted_vaults: boolean, selected?: "beside" | 1): AppUnlockedFolders {
  return {
    encrypted_vaults,
    devices: selected
      ? {
          [HERE]: {
            system: "linux",
            selected,
            next_number: 2,
            rows: [{ number: 1, name: "", path: "/mnt/ssd" }],
          },
        }
      : {},
  };
}

function vault(encrypted: VaultUnlockedFolder["encrypted"], ownRow = false): VaultUnlockedFolder {
  return {
    encrypted,
    devices: ownRow
      ? {
          [HERE]: {
            system: "linux",
            selected: 1,
            next_number: 2,
            rows: [{ number: 1, name: "", path: "/mnt/usb" }],
          },
        }
      : {},
  };
}

describe("encryptedFolderOn", () => {
  it("follows the app's switch unless the vault sets its own", () => {
    expect(encryptedFolderOn(app(true), null)).toBe(true);
    expect(encryptedFolderOn(app(false), vault("inherit"))).toBe(false);
    expect(encryptedFolderOn(app(false), vault("on"))).toBe(true);
    expect(encryptedFolderOn(app(true), vault("off"))).toBe(false);
  });
});

describe("encryptedFolderUnchosen", () => {
  it("holds while a folder is wanted and neither list chose one here", () => {
    expect(encryptedFolderUnchosen(app(true), null, DESK)).toBe(true);
    expect(encryptedFolderUnchosen(app(false), vault("on"), DESK)).toBe(true);
  });

  it("does not hold once a folder is chosen here", () => {
    expect(encryptedFolderUnchosen(app(true, "beside"), null, DESK)).toBe(false);
    expect(encryptedFolderUnchosen(app(true, 1), null, DESK)).toBe(false);
    expect(encryptedFolderUnchosen(app(false), vault("on", true), DESK)).toBe(false);
  });

  it("does not hold while no folder is wanted", () => {
    expect(encryptedFolderUnchosen(app(false), null, DESK)).toBe(false);
    expect(encryptedFolderUnchosen(app(true), vault("off"), DESK)).toBe(false);
  });

  it("never holds on a phone, or before the device is known", () => {
    expect(encryptedFolderUnchosen(app(true), null, { ...DESK, system: "android" })).toBe(false);
    expect(encryptedFolderUnchosen(app(true), null, null)).toBe(false);
  });
});

describe("the folder a choice names", () => {
  it("keeps the Data folder's backups in .upriv, per vault or for every vault", () => {
    expect(dataFolderBackupsFolder("linux", "/home/me/Upriv", "notes")).toBe(
      "/home/me/Upriv/.upriv/vaults/notes/backups",
    );
    expect(dataFolderBackupsFolder("windows", "D:\\Upriv\\", null)).toBe(
      "D:\\Upriv\\.upriv\\vaults",
    );
  });

  it("names a row's path, a fixed choice's folder, or nothing", () => {
    const group = {
      system: "linux" as const,
      selected: 1,
      next_number: 2,
      rows: [{ number: 1, name: "", path: " /mnt/usb " }],
    };
    const fixed = (choice: AppUnlockedChoice) =>
      choice === "beside" ? "/data/upriv-unlocked" : null;
    expect(selectionFolder<AppUnlockedChoice>(1, group, fixed)).toBe("/mnt/usb");
    expect(selectionFolder<AppUnlockedChoice>(2, group, fixed)).toBeNull();
    expect(selectionFolder<AppUnlockedChoice>("beside", group, fixed)).toBe("/data/upriv-unlocked");
    expect(selectionFolder<AppUnlockedChoice>(NOTHING_SELECTED, group, fixed)).toBeNull();
  });
});

describe("appUnlockedFixedFolders", () => {
  it("names the data folder and Beside the data folder, as the system writes paths", () => {
    expect(besideFolder("linux", "/home/me/Upriv/")).toBe("/home/me/Upriv/upriv-unlocked");
    expect(appUnlockedFixedFolders("windows", "D:\\Upriv")).toEqual([
      "D:\\Upriv",
      "D:\\Upriv\\upriv-unlocked",
    ]);
    expect(appUnlockedFixedFolders("linux", null)).toEqual([]);
  });

  it("holds Save for a new row that repeats one of them, as core refuses it", () => {
    const draft: DeviceGroups<AppUnlockedChoice> = {
      [HERE]: {
        system: "linux",
        selected: 1,
        next_number: 2,
        rows: [{ number: 1, name: "", path: "/home/me/Upriv" }],
      },
    };
    const fixed = appUnlockedFixedFolders("linux", "/home/me/Upriv");
    expect(listDraftBlocks({}, draft, APP_UNLOCKED_LIST, HERE, fixed)).toBe(true);
    expect(listDraftBlocks({}, draft, APP_UNLOCKED_LIST, HERE, [])).toBe(false);
  });
});
