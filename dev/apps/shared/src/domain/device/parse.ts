import type { DeviceInfo, DeviceRef, DeviceSystem } from "./types";

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

/** `device_info` result, or `null` when it is not one. */
export function parseDeviceInfo(raw: unknown): DeviceInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const system = parseDeviceSystem(body.system);
  const id = body.id === null || typeof body.id === "string" ? body.id : undefined;
  if (id === undefined || !system) return null;
  return { id, system };
}
