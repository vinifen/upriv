import type { I18nKey } from "../../i18n/catalog";
import type { I18nParams } from "../../i18n/types";
import type { DeviceSystem } from "./types";

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
const DEVICE_ID = /^[0-9a-f]{32}$/;

/** The name of a device's system on screen. */
export function deviceSystemI18nKey(system: DeviceSystem): I18nKey {
  return DEVICE_SYSTEM_KEYS[system];
}

/**
 * A device as the screen names it: its system and the start of its ID, as
 * "Linux · 3f2a1". Built each time from what the files already hold, never
 * stored, so it is the same in every window and never goes stale. A device
 * with no ID (a record a run without one made) is named by its system alone.
 */
export function deviceName(
  id: string | null,
  system: DeviceSystem,
  t: (key: I18nKey, params?: I18nParams) => string,
): string {
  const systemName = t(deviceSystemI18nKey(system));
  return id && DEVICE_ID.test(id)
    ? t("device.name", { system: systemName, tag: id.slice(0, DEVICE_TAG_CHARS) })
    : t("device.name_unknown", { system: systemName });
}
