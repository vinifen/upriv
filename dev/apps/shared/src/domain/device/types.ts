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
  /** The name this device's OS gives itself; `null` when it gives none. */
  os: string | null;
}

/**
 * The name each device's OS gave itself, by device ID: `[os_names]` of the
 * data folder's `settings.toml`, or of the data folder list. Each device
 * writes only its own line.
 */
export type OsNames = Readonly<Record<string, string>>;

/**
 * A device a record names: its ID (or the run that wrote it, while it had
 * none) and its system. The screen names it with `deviceName`.
 */
export interface DeviceRef {
  id: string;
  system: DeviceSystem;
}
