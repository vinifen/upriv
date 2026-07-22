import type { VaultRootService } from "@upriv/shared";
import {
  rpcPickDirectory,
  rpcVaultRootInspectPath,
  rpcVaultRootDefaultRootStatus,
  rpcVaultRootReadAlias,
  rpcVaultRootResolve,
  rpcVaultRootSetupDefaultRoot,
  rpcVaultRootSetupPath,
  rpcVaultRootSuggestedCustomPath,
} from "@/lib/rpc";

/** Electron → upriv-daemon vault-root RPCs (+ shell folder picker). */
export const desktopVaultRootService: VaultRootService = {
  resolve(options) {
    return rpcVaultRootResolve(options);
  },

  setupDefaultRoot(options) {
    return rpcVaultRootSetupDefaultRoot(options);
  },

  setupAtPath(path, options) {
    return rpcVaultRootSetupPath(path, options);
  },

  readAlias() {
    return rpcVaultRootReadAlias();
  },

  defaultRootStatus() {
    return rpcVaultRootDefaultRootStatus();
  },

  inspectAtPath(path) {
    return rpcVaultRootInspectPath(path);
  },

  suggestedCustomRootPath() {
    return rpcVaultRootSuggestedCustomPath();
  },

  pickFolder(defaultPath, title) {
    return rpcPickDirectory(defaultPath, title);
  },
};
