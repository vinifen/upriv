import { describe, expect, it } from "vitest";
import {
  deviceName,
  isPhoneSystem,
  parseDeviceInfo,
  parseDeviceSystem,
  parseOsNames,
  withHereOsName,
} from "..";

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

describe("parseDeviceInfo", () => {
  it("reads this device as core reports it", () => {
    const id = "3f9c2a7d4e1b8c6f0a2d4e6f8a1b3c5d";
    expect(parseDeviceInfo({ id, system: "linux", os: " Ubuntu 24.04.5 LTS " })).toEqual({
      id,
      system: "linux",
      os: "Ubuntu 24.04.5 LTS",
    });
    // An OS that gives no name, or a missing one, reads as none.
    expect(parseDeviceInfo({ id: null, system: "android", os: null })).toEqual({
      id: null,
      system: "android",
      os: null,
    });
    expect(parseDeviceInfo({ id, system: "linux" })?.os).toBeNull();
    expect(parseDeviceInfo({ id, system: "linux", os: 7 })?.os).toBeNull();
  });

  it("refuses anything else", () => {
    expect(parseDeviceInfo(null)).toBeNull();
    expect(parseDeviceInfo({ id: 7, system: "linux" })).toBeNull();
    expect(parseDeviceInfo({ id: null, system: "beos" })).toBeNull();
    expect(parseDeviceInfo({ system: "linux" })).toBeNull();
  });
});

describe("deviceName", () => {
  const id = "3f9c2a7d4e1b8c6f0a2d4e6f8a1b3c5d";
  // System names as the English copy spells them.
  const named = (key: string, params?: Record<string, string | number>) =>
    key.startsWith("device.system.") ? key.slice("device.system.".length) : t(key, params);

  it("names a device by the name its OS gave itself and the first five characters of its ID", () => {
    expect(deviceName(id, "windows", { [id]: "Windows 11 Pro" }, named)).toBe(
      'device.name {"device":"Windows 11 Pro","tag":"3f9c2"}',
    );
    // A name that leaves the system out gets it beside the name.
    expect(deviceName(id, "linux", { [id]: "Ubuntu 24.04.5 LTS" }, named)).toBe(
      `device.name ${JSON.stringify({
        device: named("device.os_and_system", { os: "Ubuntu 24.04.5 LTS", system: "linux" }),
        tag: "3f9c2",
      })}`,
    );
  });

  it("names a device that left no name by its system", () => {
    expect(deviceName(id, "linux", {}, t)).toBe(
      'device.name {"device":"device.system.linux","tag":"3f9c2"}',
    );
  });

  it("names a device with no ID by its system alone", () => {
    expect(deviceName(null, "android", {}, t)).toBe(
      'device.name_unknown {"device":"device.system.android"}',
    );
    expect(deviceName("run-0a1b2c", "windows", { "run-0a1b2c": "Windows 11 Pro" }, t)).toBe(
      'device.name_unknown {"device":"device.system.windows"}',
    );
  });
});

describe("OS names", () => {
  const id = "3f9c2a7d4e1b8c6f0a2d4e6f8a1b3c5d";
  const here = "a".repeat(32);

  it("keeps only device IDs with a name", () => {
    expect(
      parseOsNames({
        [id]: " Fedora Linux 41 ",
        "not-an-id": "Ubuntu",
        [here]: 7,
        ["b".repeat(32)]: " ",
      }),
    ).toEqual({ [id]: "Fedora Linux 41" });
    expect(parseOsNames(null)).toEqual({});
    expect(parseOsNames(["Ubuntu"])).toEqual({});
  });

  it("names this device by its OS as it runs now", () => {
    const file = { [id]: "Fedora Linux 41", [here]: "Ubuntu 22.04.4 LTS" };
    expect(withHereOsName(file, { id: here, system: "linux", os: "Ubuntu 24.04.5 LTS" })).toEqual({
      [id]: "Fedora Linux 41",
      [here]: "Ubuntu 24.04.5 LTS",
    });
    expect(withHereOsName(file, { id: here, system: "linux", os: null })).toBe(file);
    expect(withHereOsName(file, null)).toBe(file);
  });
});

describe("parseDeviceSystem", () => {
  it("knows the five systems, two of them phones", () => {
    for (const system of ["linux", "windows", "macos", "android", "ios"]) {
      expect(parseDeviceSystem(system)).toBe(system);
    }
    expect(parseDeviceSystem("Linux")).toBeNull();
    expect(isPhoneSystem("android")).toBe(true);
    expect(isPhoneSystem("windows")).toBe(false);
  });
});
