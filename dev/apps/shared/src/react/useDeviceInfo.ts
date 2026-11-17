import { useEffect, useState } from "react";
import type { DeviceInfo, HereDevice } from "../domain";
import type { DeviceService } from "../services";

/** One read per service: core computes this device's identity once per process. */
const reads = new WeakMap<DeviceService, Promise<DeviceInfo>>();

function readDevice(service: DeviceService): Promise<DeviceInfo> {
  let read = reads.get(service);
  if (!read) {
    read = service.info();
    reads.set(service, read);
    // A read that failed is asked again by the next caller.
    read.catch(() => reads.delete(service));
  }
  return read;
}

/** This device as core knows it; `null` until the first read answers. */
export function useDeviceInfo(service: DeviceService): DeviceInfo | null {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    readDevice(service).then(
      (device) => {
        if (!cancelled) setInfo(device);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [service]);
  return info;
}

/** The current device as a list edits it, or `null` while unknown: its lists cannot change. */
export function hereDevice(info: DeviceInfo | null): HereDevice | null {
  return info?.id ? { id: info.id, system: info.system } : null;
}
