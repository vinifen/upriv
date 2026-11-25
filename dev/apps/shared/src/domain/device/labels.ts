import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";
import type { DeviceInfo, DeviceSystem, OsNames } from "./types";

const DEVICE_SYSTEM_KEYS = {
  linux: "device.system.linux",
  windows: "device.system.windows",
  macos: "device.system.macos",
  android: "device.system.android",
  ios: "device.system.ios",
} as const satisfies Record<DeviceSystem, I18nKey>;

/** How many characters of a device's ID its name shows. */
export const DEVICE_TAG_CHARS = 5;

/** A device ID: 32 lowercase hex characters. A record of a run with no ID holds something else. */
export const DEVICE_ID = /^[0-9a-f]{32}$/;

/** The name of a device's system on screen. */
export function deviceSystemI18nKey(system: DeviceSystem): I18nKey {
  return DEVICE_SYSTEM_KEYS[system];
}

/**
 * The names a window names devices by: a file's `[os_names]`, with this
 * device's own name as its OS gives it now.
 */
export function withHereOsName(names: OsNames, here: DeviceInfo | null): OsNames {
  return here?.id && here.os ? { ...names, [here.id]: here.os } : names;
}

/**
 * What a device runs, as the screen says it: the name its OS gave itself
 * when that names the system ("Windows 11 Pro"), that name with the system
 * when it does not ("Ubuntu 24.04.5 LTS (Linux)"), or the system alone when
 * the device left no name.
 */
function deviceSystemLabel(
  system: DeviceSystem,
  os: string | undefined,
  t: (key: I18nKey, params?: I18nParams) => string,
): string {
  const systemName = t(deviceSystemI18nKey(system));
  if (!os) return systemName;
  return os.toLowerCase().includes(systemName.toLowerCase())
    ? os
    : t("device.os_and_system", { os, system: systemName });
}

/**
 * A device as the screen names it: what it runs and the start of its ID, as
 * "Windows 11 Pro · 3f2a1". The same in every window, from the one name
 * each device wrote for itself. A device with no ID (a record a run without
 * one made) is named by its system alone.
 */
export function deviceName(
  id: string | null,
  system: DeviceSystem,
  osNames: OsNames,
  t: (key: I18nKey, params?: I18nParams) => string,
): string {
  if (!id || !DEVICE_ID.test(id)) {
    return t("device.name_unknown", { device: deviceSystemLabel(system, undefined, t) });
  }
  return t("device.name", {
    device: deviceSystemLabel(system, osNames[id], t),
    tag: id.slice(0, DEVICE_TAG_CHARS),
  });
}
