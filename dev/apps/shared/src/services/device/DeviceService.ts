import type { DeviceInfo } from "../../domain/device";

/** This device as core knows it (`device_info`). */
export interface DeviceService {
  info(): Promise<DeviceInfo>;
}
