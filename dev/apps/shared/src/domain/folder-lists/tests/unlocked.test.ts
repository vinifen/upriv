import { describe, expect, it } from "vitest";
import {
  APP_UNLOCKED_LIST,
  appUnlockedFixedFolders,
  besideFolder,
  encryptedFolderOn,
  encryptedFolderUnchosen,
  listDraftBlocks,
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
