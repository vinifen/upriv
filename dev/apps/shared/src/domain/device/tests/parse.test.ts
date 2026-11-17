import { describe, expect, it } from "vitest";
import { deviceName, isPhoneSystem, parseDeviceInfo, parseDeviceSystem } from "..";

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

describe("parseDeviceInfo", () => {
  it("reads this device as core reports it", () => {
    const id = "3f9c2a7d4e1b8c6f0a2d4e6f8a1b3c5d";
    expect(parseDeviceInfo({ id, system: "linux" })).toEqual({ id, system: "linux" });
    expect(parseDeviceInfo({ id: null, system: "android" })).toEqual({
      id: null,
      system: "android",
    });
  });

  it("refuses anything else", () => {
    expect(parseDeviceInfo(null)).toBeNull();
    expect(parseDeviceInfo({ id: 7, system: "linux" })).toBeNull();
    expect(parseDeviceInfo({ id: null, system: "beos" })).toBeNull();
    expect(parseDeviceInfo({ system: "linux" })).toBeNull();
  });
});

describe("deviceName", () => {
  it("names a device by its system and the first five characters of its ID", () => {
    expect(deviceName("3f9c2a7d4e1b8c6f0a2d4e6f8a1b3c5d", "linux", t)).toBe(
      'device.name {"system":"device.system.linux","tag":"3f9c2"}',
    );
  });

  it("names a device with no ID by its system alone", () => {
    expect(deviceName(null, "android", t)).toBe(
      'device.name_unknown {"system":"device.system.android"}',
    );
    expect(deviceName("run-0a1b2c", "windows", t)).toBe(
      'device.name_unknown {"system":"device.system.windows"}',
    );
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
