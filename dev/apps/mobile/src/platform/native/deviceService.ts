import type { DeviceService } from "@upriv/shared";
import { rpcDeviceInfo } from "@/lib/rpc";

/** Native → `upriv-ffi` `device_info`. */
export const nativeDeviceService: DeviceService = {
  info: rpcDeviceInfo,
};
