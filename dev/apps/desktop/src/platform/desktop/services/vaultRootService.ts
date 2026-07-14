import type { VaultRootService } from "@upriv/shared";
import {
  rpcPickDirectory,
  rpcVaultRootDeactivateAlias,
  rpcVaultRootInspectPath,
  rpcVaultRootNearbyStatus,
  rpcVaultRootReadAlias,
  rpcVaultRootResolve,
  rpcVaultRootRewriteAlias,
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

  rewriteAlias(path) {
    return rpcVaultRootRewriteAlias(path);
  },

  deactivateAlias() {
    return rpcVaultRootDeactivateAlias();
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
