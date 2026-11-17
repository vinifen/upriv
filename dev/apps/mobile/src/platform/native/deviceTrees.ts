import { rpcDeviceTrees } from "@/lib/rpc";
import { mountTree } from "./safVaultRoot";

/** The trees this phone's rows name, as last mounted. */
const listed = new Set<string>();

/**
 * Mount every tree this phone's rows name (`device_trees`), so Rust reaches
 * each row at its tree's root. Binds only: a drive that is away fails on its
 * first use, as a folder of the list.
 */
export async function mountDeviceTrees(): Promise<void> {
  const trees = await rpcDeviceTrees();
  listed.clear();
  for (const uri of trees) {
    try {
      mountTree(uri);
      listed.add(uri);
    } catch {
      // A tree whose grant is gone fails as that row's folder.
    }
  }
}

/** True when a row of this phone names `uri`: its mount and grant stay. */
export function isDeviceTree(uri: string): boolean {
  return listed.has(uri.trim());
}
