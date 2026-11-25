import { createContext, useContext, useMemo, type ReactNode } from "react";
import { withHereOsName, type DeviceInfo, type OsNames } from "../domain";

const DeviceNamesContext = createContext<OsNames>({});

/**
 * The OS names the windows below it name devices by: the data folder's
 * `[os_names]` under the app settings, the data folder list's own around
 * that list. Give it this device as core knows it, so its own name is the
 * one its OS gives now.
 */
export function DeviceNamesProvider({
  names,
  here,
  children,
}: {
  names: OsNames;
  here: DeviceInfo | null;
  children: ReactNode;
}) {
  const value = useMemo(() => withHereOsName(names, here), [names, here]);
  return <DeviceNamesContext.Provider value={value}>{children}</DeviceNamesContext.Provider>;
}

/** The OS names to name devices by: the nearest provider's. */
export function useOsNames(): OsNames {
  return useContext(DeviceNamesContext);
}
