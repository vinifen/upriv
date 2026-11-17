/** The system a device runs: core's `DeviceSystem`. */
export type DeviceSystem = "linux" | "windows" | "macos" | "android" | "ios";

/** `device_info`: this device as core knows it. */
export interface DeviceInfo {
  /**
   * The ID that names this device's group in every folder list, derived from
   * the OS machine ID (never the machine ID itself). `null` when neither the
   * OS nor the fallback file gives one for this run: the lists are then
   * neither used nor edited.
   */
  id: string | null;
  system: DeviceSystem;
}

/**
 * A device a record names: its ID (or the run that wrote it, while it had
 * none) and its system. The screen names it with `deviceName`.
 */
export interface DeviceRef {
  id: string;
  system: DeviceSystem;
}
