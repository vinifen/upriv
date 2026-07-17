import type { VaultRootService } from "@upriv/shared";
import {
  rpcPickDirectory,
  rpcVaultRootInspectPath,
  rpcVaultRootNearbyStatus,
  rpcVaultRootReadAlias,
  rpcVaultRootResolve,
  rpcVaultRootSetupNearby,
  rpcVaultRootSetupPath,
} from "@/lib/rpc";

/** Electron → upriv-daemon vault-root RPCs (+ shell folder picker). */
export const desktopVaultRootService: VaultRootService = {
  resolve(options) {
    return rpcVaultRootResolve(options);
  },

  setupNearby(options) {
    return rpcVaultRootSetupNearby(options);
  },

  setupAtPath(path, options) {
    return rpcVaultRootSetupPath(path, options);
  },

  readAlias() {
    return rpcVaultRootReadAlias();
  },

  nearbyStatus() {
    return rpcVaultRootNearbyStatus();
  },

  inspectAtPath(path) {
    return rpcVaultRootInspectPath(path);
  },

  pickFolder(defaultPath, title) {
    return rpcPickDirectory(defaultPath, title);
  },
};
