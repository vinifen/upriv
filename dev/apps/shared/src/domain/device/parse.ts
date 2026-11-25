import { DEVICE_ID } from "./labels";
import type { DeviceInfo, DeviceRef, DeviceSystem, OsNames } from "./types";

const DEVICE_SYSTEMS = new Set<DeviceSystem>(["linux", "windows", "macos", "android", "ios"]);

export function parseDeviceSystem(value: unknown): DeviceSystem | null {
  return typeof value === "string" && DEVICE_SYSTEMS.has(value as DeviceSystem)
    ? (value as DeviceSystem)
    : null;
}

/** True for a phone: its folders are picked as grants, and it mounts no unlocked folder. */
export function isPhoneSystem(system: DeviceSystem): boolean {
  return system === "android" || system === "ios";
}

/** A device a record names, from its ID and its system; `null` when either is missing. */
export function parseDeviceRef(id: unknown, system: unknown): DeviceRef | null {
  const parsed = parseDeviceSystem(system);
  return typeof id === "string" && id && parsed ? { id, system: parsed } : null;
}

/** An OS name as the screen shows it: trimmed, `null` when nothing is left. */
function osName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `device_info` result, or `null` when it is not one. A missing OS name reads as none. */
export function parseDeviceInfo(raw: unknown): DeviceInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const system = parseDeviceSystem(body.system);
  const id = body.id === null || typeof body.id === "string" ? body.id : undefined;
  if (id === undefined || !system) return null;
  return { id, system, os: osName(body.os) };
}

/**
 * An `[os_names]` table. A line that is not a device ID with a name reads as
 * no line: a name only labels a device.
 */
export function parseOsNames(raw: unknown): OsNames {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const names: Record<string, string> = {};
  for (const [id, value] of Object.entries(raw)) {
    const name = osName(value);
    if (DEVICE_ID.test(id) && name) names[id] = name;
  }
  return names;
}
