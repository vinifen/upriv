import {
  LIVE_CLOSING_PIPELINE_STEP_COUNT,
  LIVE_OPENING_PIPELINE_STEP_COUNT,
  WORKSPACE_PATH_DEFAULT,
  borrowSessionRamPassword,
  isLifecyclePasswordPresent,
  isVaultPipelineError,
  resolveVaultMountPoint,
  type VaultLifecycleService,
} from "@upriv/shared";
import { rpcVaultClose, rpcVaultOpen } from "@/lib/rpc";
import { assertSafVaultPathRpcAvailable } from "./safVaultRpcGuard";

/** Session RAM only — never persist. */
const vaultPasswordInRam = new Map<string, string>();

/** Native → `upriv-ffi` `vault_open` / `vault_close`. */
export const nativeVaultLifecycleService: VaultLifecycleService = {
  hasPasswordInSession(vaultId) {
    return vaultPasswordInRam.has(vaultId);
  },

  setPasswordInSession(vaultId, password) {
    vaultPasswordInRam.set(vaultId, password);
  },

  clearPasswordInSession(vaultId) {
    vaultPasswordInRam.delete(vaultId);
  },

  openingStepCount: LIVE_OPENING_PIPELINE_STEP_COUNT,
  closingStepCount: LIVE_CLOSING_PIPELINE_STEP_COUNT,

  async runOpeningPipeline(vaultId, onStep) {
    assertSafVaultPathRpcAvailable();
    onStep(0);
    const password = borrowSessionRamPassword(vaultPasswordInRam, vaultId);
    await rpcVaultOpen(vaultId, password);
    // Hooks restore only when `shouldRetainSessionRamPassword` says so.
    onStep(1);
  },

  async runClosingPipeline(vaultId, onStep) {
    assertSafVaultPathRpcAvailable();
    onStep(0);
    const password = vaultPasswordInRam.get(vaultId);
    await rpcVaultClose(vaultId, password);
    onStep(1);
  },

  resolveWorkspacePath(displayName, options) {
    return (
      resolveVaultMountPoint(
        options?.globalWorkspacePath ?? "",
        options?.mountWorkspacePath ?? WORKSPACE_PATH_DEFAULT,
        displayName,
      ) ?? ""
    );
  },

  validateLifecyclePassword(password) {
    return isLifecyclePasswordPresent(password);
  },

  isPipelineError: isVaultPipelineError,

  pipelineErrorCode(error) {
    return error.code;
  },
};
