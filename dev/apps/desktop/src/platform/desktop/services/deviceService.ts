import type { DeviceService } from "@upriv/shared";
import { rpcDeviceInfo } from "@/lib/rpc";

/** Desktop → daemon `device_info`. */
export const desktopDeviceService: DeviceService = {
  info: rpcDeviceInfo,
};
