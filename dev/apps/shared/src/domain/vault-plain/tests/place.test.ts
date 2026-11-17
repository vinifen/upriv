import { describe, expect, it } from "vitest";
import {
  plainPlaceProblem,
  type AppUnlockedChoice,
  type DeviceGroups,
  type HereDevice,
  type VaultUnlockedChoice,
} from "../..";

const HERE: HereDevice = { id: "a".repeat(32), system: "linux" };

const APP: DeviceGroups<AppUnlockedChoice> = {
  [HERE.id]: {
    system: "linux",
    selected: "none",
    next_number: 2,
    rows: [{ number: 1, name: "", path: "/mnt/ssd" }],
  },
};

const VAULT: DeviceGroups<VaultUnlockedChoice> = {
  [HERE.id]: {
    system: "linux",
    selected: "inherit",
    next_number: 2,
    rows: [{ number: 1, name: "", path: "/media/usb" }],
  },
};

function problem(choice: "app_folder" | "vault_folder", path: string) {
  return plainPlaceProblem({
    choice,
    path,
    here: HERE,
    appUnlocked: APP,
    vaultUnlocked: VAULT,
    dataFolder: "/home/me/Upriv",
  });
}

describe("plainPlaceProblem", () => {
  it("lets a new folder through on either list", () => {
    expect(problem("app_folder", "/home/me/Plain")).toBeNull();
    expect(problem("vault_folder", "/home/me/Plain")).toBeNull();
  });

  it("is empty while nothing is typed", () => {
    expect(problem("app_folder", "  ")).toBe("empty");
  });

  it("refuses what core refuses for that row", () => {
    expect(problem("vault_folder", "relative/path")).toBe("not_absolute");
    expect(problem("app_folder", "/home/me/Upriv/.upriv/vaults")).toBe("reserved");
  });

  it("refuses a folder already in that list, and only that list", () => {
    expect(problem("app_folder", "/mnt/ssd/")).toBe("duplicate");
    expect(problem("vault_folder", "/mnt/ssd")).toBeNull();
    expect(problem("vault_folder", "/media/usb")).toBe("duplicate");
  });

  it("refuses the data folder and Beside the data folder in the app's list", () => {
    expect(problem("app_folder", "/home/me/Upriv")).toBe("duplicate");
    expect(problem("app_folder", "/home/me/Upriv/upriv-unlocked")).toBe("duplicate");
    expect(problem("vault_folder", "/home/me/Upriv")).toBeNull();
  });
});
